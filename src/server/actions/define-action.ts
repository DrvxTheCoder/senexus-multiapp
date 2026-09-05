import "server-only"

import { revalidatePath } from "next/cache"
import type { FirmRole, Prisma } from "@prisma/client"
import { z } from "zod"

import { db } from "@/lib/db"
import type { ActionResult, FieldErrors } from "@/lib/forms/action-result"
import {
  getSession,
  requireFirmAccess,
  requireHoldingAccess,
  requireModule,
  type FirmContext,
} from "@/server/auth/require-firm-access"
import { isAccessError, UnauthorizedError } from "@/server/errors"

/**
 * One wrapper every mutation goes through.
 *
 * The legacy application applied authorisation by copy-paste, checked roles in
 * some routes and not others, and wrote audit rows *outside* the transaction
 * they described — so a failed write could still leave an audit trail claiming
 * it happened. Rather than repeat that discipline by hand across ~30 actions,
 * it is enforced structurally here:
 *
 *   1. input is parsed, and a failure comes back as per-field messages;
 *   2. authorisation runs before the handler, from the caller's session, never
 *      from an id supplied by the client;
 *   3. the handler runs inside a transaction and is handed an `audit()` bound
 *      to that same transaction, so the trail commits or rolls back with it;
 *   4. paths are revalidated only after it commits.
 *
 * Three entry points, because the three access levels need different context:
 * `firmAction` (inside one firm), `holdingAction` (the admin console) and
 * `sessionAction` (a user acting on their own account).
 */

/** Thrown by a handler to fail with a message the user should read. */
export class ActionError extends Error {
  readonly fieldErrors?: FieldErrors

  constructor(message: string, fieldErrors?: FieldErrors) {
    super(message)
    this.name = "ActionError"
    this.fieldErrors = fieldErrors
  }
}

type Tx = Prisma.TransactionClient

export type AuditFn = (entry: {
  action: string
  entity: string
  entityId: string
  metadata?: Prisma.InputJsonValue
}) => Promise<void>

type Revalidate<TInput> =
  | string
  | string[]
  | ((input: TInput) => string | string[] | null)

type Common<TInput> = {
  /** Paths to revalidate after the transaction commits. */
  revalidate?: Revalidate<TInput>
}

function toResult(error: unknown): ActionResult<never> {
  if (error instanceof ActionError) {
    return { ok: false, message: error.message, fieldErrors: error.fieldErrors }
  }

  if (isAccessError(error)) {
    return { ok: false, message: error.message, status: error.status }
  }

  if (error instanceof z.ZodError) {
    return {
      ok: false,
      message: "Certains champs sont invalides.",
      fieldErrors: flattenZod(error),
    }
  }

  // Anything else is a bug, not a user error. Log it and say so plainly rather
  // than leaking a stack trace or a Prisma message into the interface.
  console.error("Unhandled action failure", error)
  return {
    ok: false,
    message: "Une erreur inattendue est survenue. Réessayez.",
  }
}

function flattenZod(error: z.ZodError): FieldErrors {
  const fieldErrors: FieldErrors = {}
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_"
    ;(fieldErrors[key] ??= []).push(issue.message)
  }
  return fieldErrors
}

async function runRevalidate<TInput>(
  revalidate: Revalidate<TInput> | undefined,
  input: TInput
): Promise<void> {
  if (!revalidate) return
  const resolved =
    typeof revalidate === "function" ? revalidate(input) : revalidate
  if (!resolved) return
  for (const path of Array.isArray(resolved) ? resolved : [resolved]) {
    revalidatePath(path)
  }
}

function auditFor(tx: Tx, firmId: string | null, actorId: string): AuditFn {
  return async (entry) => {
    await tx.auditLog.create({
      data: {
        firmId,
        actorId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        metadata: entry.metadata,
      },
    })
  }
}

/* ==========================================================================
 * Firm-scoped actions
 * ========================================================================== */

/**
 * The firm is identified by a **slug in the validated input**, never by an id
 * from the client: `requireFirmAccess` resolves it against the caller's own
 * memberships, so a crafted request cannot act on a firm the caller cannot see.
 */
export function firmAction<TSchema extends z.ZodType, TOut>(config: {
  input: TSchema
  /** Field on the parsed input holding the firm slug. Defaults to `firmSlug`. */
  firmSlugField?: keyof z.infer<TSchema> & string
  minimumRole?: FirmRole
  /** Module that must be enabled for the firm, e.g. "hr". */
  module?: string
  handler: (args: {
    input: z.infer<TSchema>
    ctx: FirmContext
    tx: Tx
    audit: AuditFn
  }) => Promise<TOut>
} & Common<z.infer<TSchema>>) {
  return async (raw: unknown): Promise<ActionResult<TOut>> => {
    try {
      const input = config.input.parse(raw) as z.infer<TSchema>
      const slugField = config.firmSlugField ?? "firmSlug"
      const slug = (input as Record<string, unknown>)[slugField]

      if (typeof slug !== "string") {
        throw new ActionError("Entreprise non identifiée.")
      }

      const ctx = await requireFirmAccess(slug, config.minimumRole)
      if (config.module) requireModule(ctx, config.module)

      const data = await db.$transaction(async (tx) =>
        config.handler({
          input,
          ctx,
          tx,
          audit: auditFor(tx, ctx.firmId, ctx.userId),
        })
      )

      await runRevalidate(config.revalidate, input)
      return { ok: true, data }
    } catch (error) {
      return toResult(error)
    }
  }
}

/* ==========================================================================
 * Holding-scoped actions (the administration console)
 * ========================================================================== */

/**
 * `requireHoldingAccess` reproduces the legacy rule deliberately: being OWNER
 * or ADMIN of *any* firm grants the cross-tenant console. What it adds is the
 * check itself — the legacy `/api/firms` and `/api/users` routes verified only
 * that a session existed, so any signed-in user could create firms, delete
 * users or reset passwords.
 */
export function holdingAction<TSchema extends z.ZodType, TOut>(config: {
  input: TSchema
  handler: (args: {
    input: z.infer<TSchema>
    userId: string
    holdingIds: string[]
    tx: Tx
    audit: AuditFn
  }) => Promise<TOut>
} & Common<z.infer<TSchema>>) {
  return async (raw: unknown): Promise<ActionResult<TOut>> => {
    try {
      const input = config.input.parse(raw) as z.infer<TSchema>
      const holdingIds = await requireHoldingAccess()
      const session = await getSession()
      const userId = session?.user?.id

      if (!userId) throw new UnauthorizedError()

      const data = await db.$transaction(async (tx) =>
        config.handler({
          input,
          userId,
          holdingIds,
          tx,
          audit: auditFor(tx, null, userId),
        })
      )

      await runRevalidate(config.revalidate, input)
      return { ok: true, data }
    } catch (error) {
      return toResult(error)
    }
  }
}

/* ==========================================================================
 * Session actions (a user acting on their own account)
 * ========================================================================== */

export function sessionAction<TSchema extends z.ZodType, TOut>(config: {
  input: TSchema
  handler: (args: {
    input: z.infer<TSchema>
    userId: string
    tx: Tx
    audit: AuditFn
  }) => Promise<TOut>
} & Common<z.infer<TSchema>>) {
  return async (raw: unknown): Promise<ActionResult<TOut>> => {
    try {
      const input = config.input.parse(raw) as z.infer<TSchema>
      const session = await getSession()
      const userId = session?.user?.id

      if (!userId) throw new UnauthorizedError()

      const data = await db.$transaction(async (tx) =>
        config.handler({
          input,
          userId,
          tx,
          audit: auditFor(tx, null, userId),
        })
      )

      await runRevalidate(config.revalidate, input)
      return { ok: true, data }
    } catch (error) {
      return toResult(error)
    }
  }
}
