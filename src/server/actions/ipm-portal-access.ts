"use server"

import {
  grantPortalAccessSchema,
  portalAccountSchema,
} from "@/lib/forms/ipm-schemas"
import { ActionError, firmAction } from "@/server/actions/define-action"
import {
  grantPortalAccess,
  type PortalGrantResult,
} from "@/server/ipm/portal-access"
import { portalTokenSecret } from "@/server/portal/auth"
import { PortalError } from "@/server/portal/http"
import {
  ACCESS_CODE_TTL_MS,
  hashAccessCode,
  newAccessCode,
} from "@/server/portal/token"
import { memberWhere } from "@/server/queries/ipm/members"

/**
 * Accès au portail, from the back office.
 *
 *   - **Ouvrir** — in bulk from the list, or for one participant from the
 *     fiche. The bulk form reports who was skipped and why; the fiche's form
 *     fails with that reason instead, since there is only one participant;
 *   - **Suspendre** — INVITED or ACTIVE → LOCKED. The portal refuses a LOCKED
 *     account on its next request (`requirePortalAccount`), so this takes
 *     effect at once, without waiting for a token to expire;
 *   - **Rétablir** — LOCKED → ACTIVE if the participant had already logged in,
 *     INVITED otherwise;
 *   - **Code d'accès** — a one-time code for a participant who cannot receive
 *     the SMS one, given to them by phone or at the desk. Shown once, here;
 *     only its HMAC is kept. See `openSession`.
 *
 * The account is never deleted here: its bons and notifications hang off it.
 */

const MODULE = "ipm"

/** The most a single run may open; well above the IPM's ~300 participants. */
const MAX_GRANT = 2000

const revalidate = (input: { firmSlug: string; memberId?: string }) => [
  `/${input.firmSlug}/ipm/participants`,
  ...(input.memberId
    ? [`/${input.firmSlug}/ipm/participants/${input.memberId}`]
    : []),
]

export const grantPortalAccessBulk = firmAction({
  input: grantPortalAccessSchema,
  minimumRole: "MANAGER",
  module: MODULE,
  revalidate,
  handler: async ({ input, ctx, tx, audit }): Promise<PortalGrantResult> => {
    const exclude = new Set(input.excludeIds)
    const ids = input.matching
      ? (
          await tx.member.findMany({
            where: memberWhere(input.matching, ctx),
            select: { id: true },
            take: MAX_GRANT + exclude.size + 1,
          })
        )
          .map((row) => row.id)
          .filter((id) => !exclude.has(id))
      : (input.memberIds ?? [])

    if (ids.length === 0)
      throw new ActionError("Aucun participant sélectionné.")
    if (ids.length > MAX_GRANT) {
      throw new ActionError(
        `Plus de ${MAX_GRANT} participants sélectionnés : affinez les filtres.`
      )
    }

    const result = await grantPortalAccess(tx, ctx.firmId, ids)

    for (const entry of result.granted) {
      await audit({
        action: "GRANT_PORTAL_ACCESS",
        entity: "IPM_MEMBER",
        entityId: entry.memberId,
        metadata: { matricule: entry.matricule, bulk: true },
      })
    }

    return result
  },
})

export const grantPortalAccessOne = firmAction({
  input: portalAccountSchema,
  minimumRole: "MANAGER",
  module: MODULE,
  revalidate,
  handler: async ({ input, ctx, tx, audit }) => {
    const result = await grantPortalAccess(tx, ctx.firmId, [input.memberId])
    const [granted] = result.granted
    if (!granted) {
      throw new ActionError(
        result.skipped[0]?.detail ?? "Participant introuvable."
      )
    }

    await audit({
      action: "GRANT_PORTAL_ACCESS",
      entity: "IPM_MEMBER",
      entityId: granted.memberId,
      metadata: { matricule: granted.matricule },
    })

    return { memberId: granted.memberId }
  },
})

export const suspendPortalAccess = firmAction({
  input: portalAccountSchema,
  minimumRole: "MANAGER",
  module: MODULE,
  revalidate,
  handler: async ({ input, ctx, tx, audit }) => {
    const { count } = await tx.portalAccount.updateMany({
      where: {
        firmId: ctx.firmId,
        memberId: input.memberId,
        status: { in: ["INVITED", "ACTIVE"] },
      },
      data: { status: "LOCKED" },
    })
    if (count === 0) {
      throw new ActionError("Ce participant n'a pas d'accès ouvert au portail.")
    }

    await audit({
      action: "SUSPEND_PORTAL_ACCESS",
      entity: "IPM_MEMBER",
      entityId: input.memberId,
    })

    return { memberId: input.memberId }
  },
})

export const restorePortalAccess = firmAction({
  input: portalAccountSchema,
  minimumRole: "MANAGER",
  module: MODULE,
  revalidate,
  handler: async ({ input, ctx, tx, audit }) => {
    const account = await tx.portalAccount.findFirst({
      where: { firmId: ctx.firmId, memberId: input.memberId, status: "LOCKED" },
      select: { id: true, activatedAt: true },
    })
    if (!account)
      throw new ActionError("Ce participant n'a pas d'accès suspendu.")

    await tx.portalAccount.update({
      where: { id: account.id },
      data: { status: account.activatedAt ? "ACTIVE" : "INVITED" },
    })

    await audit({
      action: "RESTORE_PORTAL_ACCESS",
      entity: "IPM_MEMBER",
      entityId: input.memberId,
    })

    return { memberId: input.memberId }
  },
})

export const issuePortalAccessCode = firmAction({
  input: portalAccountSchema,
  minimumRole: "MANAGER",
  module: MODULE,
  revalidate,
  handler: async ({ input, ctx, tx, audit }) => {
    const account = await tx.portalAccount.findFirst({
      where: { firmId: ctx.firmId, memberId: input.memberId },
      select: { id: true, status: true, phone: true },
    })
    if (!account) {
      throw new ActionError(
        "Ouvrez d'abord l'accès au portail de ce participant."
      )
    }
    if (account.status === "LOCKED") {
      throw new ActionError("L'accès est suspendu : rétablissez-le d'abord.")
    }

    let secret: string
    try {
      secret = portalTokenSecret()
    } catch (error) {
      if (error instanceof PortalError) throw new ActionError(error.message)
      throw error
    }

    // A new code replaces the previous one, and answers any pending request.
    const code = newAccessCode()
    const expiresAt = new Date(Date.now() + ACCESS_CODE_TTL_MS)
    await tx.portalAccount.update({
      where: { id: account.id },
      data: {
        accessCodeHash: hashAccessCode(account.id, code, secret),
        accessCodeExpiresAt: expiresAt,
        accessRequestedAt: null,
      },
    })

    // Never the code itself: the audit log is read by more people than this.
    await audit({
      action: "ISSUE_PORTAL_ACCESS_CODE",
      entity: "IPM_MEMBER",
      entityId: input.memberId,
      metadata: { expiresAt: expiresAt.toISOString() },
    })

    return { code, phone: account.phone, expiresAt }
  },
})
