import "server-only"

import type { IpmReviewFlag, Prisma } from "@prisma/client"
import { z } from "zod"

import { db } from "@/lib/db"
import { ActionError } from "@/server/actions/define-action"
import { participantMayCancel } from "@/server/domain/ipm/deferred-amount"
import { decideIssuance } from "@/server/domain/ipm/issuance"
import {
  decideReview,
  toReviewSettings,
  type ReviewDecision,
} from "@/server/domain/ipm/portal-review"
import { lineTotal } from "@/server/domain/ipm/settlement"
import {
  cancelVoucherCore,
  createVoucher,
  VoucherInputNotFoundError,
  type Admission,
  type AllowedDecision,
  type ClosedVoucher,
  type VoucherLineInput,
} from "@/server/ipm/voucher-writes"
import type { PortalPrincipal } from "@/server/portal/auth"
import type { PreviewResponse } from "@/server/portal/contract"
import { PortalError } from "@/server/portal/http"
import {
  gatherIssuanceFacts,
  type IssuanceContext,
} from "@/server/queries/ipm/vouchers"

/**
 * Bons émis depuis le portail — the portal's own rules, on top of the shared
 * write path in `server/ipm/voucher-writes.ts`.
 *
 * What is the portal's and not the back office's:
 *
 *   - **a participant cannot "confirm anyway".** An operator may proceed past
 *     a warning and the act is audited; a participant is not in a position to
 *     judge a late cotisation or an expired convention, so any warning holds
 *     the bon for a gestionnaire (`ISSUANCE_WARNING`);
 *   - **the review policy** (`decideReview`): above the threshold the bon
 *     waits, and anything odd about it is flagged either way;
 *   - **a total without lines** is accepted, as one global line;
 *   - **the prestation comes from the bon's type**, through the IPM's
 *     `IpmPortalBooking` rows — a participant picks "pharmacie", not a
 *     WebLamps code — and the provider must hold one of the specialties that
 *     booking allows.
 *
 * Refusals are the same refusals the back office gets, from the same code.
 */

type Tx = Prisma.TransactionClient

/** Statuses that count as a bon the family actually has. */
const LIVE = ["PENDING_REVIEW", "ISSUED", "PRESENTED", "SETTLED", "INVOICED"] as const

export const GLOBAL_LINE_LABEL = "Montant global du reçu"

const amount = z.coerce.number().finite().min(0).max(100_000_000)

export const voucherDraftSchema = z.object({
  type: z.enum(["PHARMACY", "OPTICAL", "GUARANTEE", "HOSPITALIZATION"]),
  dependentId: z.string().min(1).nullable().default(null),
  providerId: z.string().min(1, "Choisissez un prestataire."),
  entryMode: z.enum(["SCAN", "MANUAL"]).default("MANUAL"),
  lines: z
    .array(
      z.object({
        label: z.string().trim().max(160),
        quantity: z.coerce.number().finite().min(0).max(9999),
        unitPrice: amount,
      })
    )
    .max(50)
    .default([]),
  total: amount.nullable().default(null),
  receiptHash: z
    .string()
    .regex(/^[0-9a-f]{16}$/i, "Empreinte du reçu invalide.")
    .nullable()
    .default(null),
  ocrTotal: amount.nullable().default(null),
  clientRequestId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/, "Identifiant de requête invalide."),
})

export type ParsedDraft = z.infer<typeof voucherDraftSchema>

/** The preview may be asked before the idempotency key exists. */
export const previewDraftSchema = voucherDraftSchema.extend({
  clientRequestId: voucherDraftSchema.shape.clientRequestId.optional(),
})

/**
 * The lines a draft becomes. Priced lines when there are any — the total is
 * then their sum, never a figure typed beside them; otherwise the receipt
 * total, as a single line, so settlement and the bon PDF see the same shape
 * they always do.
 */
export function draftLines(
  draft: Pick<ParsedDraft, "lines" | "total">
): VoucherLineInput[] {
  const priced = draft.lines.filter(
    (line) => line.label.trim() && line.quantity > 0 && line.unitPrice > 0
  )
  if (priced.length > 0) {
    return priced.map((line) => ({
      label: line.label.trim(),
      quantity: line.quantity,
      unitPrice: Math.round(line.unitPrice),
    }))
  }

  const total = Math.round(draft.total ?? 0)
  if (total <= 0) {
    throw new PortalError(422, "AMOUNT_REQUIRED", "Indiquez le montant du reçu.")
  }
  return [{ label: GLOBAL_LINE_LABEL, quantity: 1, unitPrice: total }]
}

/**
 * The prestation a bon of this type books against, for this IPM, and the
 * check that the chosen provider may receive it. Read from the database every
 * time: the mapping is configuration, and the one that counts is the current
 * one, not whatever the portal cached in its snapshot.
 */
export async function resolveBooking(
  client: Tx | typeof db,
  firmId: string,
  type: ParsedDraft["type"],
  providerId: string
): Promise<{ serviceTypeId: string }> {
  const [booking, provider] = await Promise.all([
    client.ipmPortalBooking.findUnique({
      where: { firmId_type: { firmId, type } },
      select: { serviceTypeId: true, specialties: { select: { id: true } } },
    }),
    client.ipmProvider.findFirst({
      where: { id: providerId, firmId },
      select: { specialtyId: true },
    }),
  ])

  if (!booking) {
    throw new PortalError(
      422,
      "TYPE_UNAVAILABLE",
      "Ce type de bon n'est pas proposé sur le portail. Adressez-vous à votre IPM."
    )
  }
  // An unknown provider is left to the issuance path, which answers 404.
  if (
    provider &&
    booking.specialties.length > 0 &&
    !booking.specialties.some((s) => s.id === provider.specialtyId)
  ) {
    throw new PortalError(
      422,
      "PROVIDER_NOT_ELIGIBLE",
      "Ce prestataire ne peut pas recevoir ce type de bon."
    )
  }
  return { serviceTypeId: booking.serviceTypeId }
}

function dayBounds(on: Date): { gte: Date; lt: Date } {
  const start = new Date(on.getFullYear(), on.getMonth(), on.getDate())
  return { gte: start, lt: new Date(start.getTime() + 86_400_000) }
}

/** The facts `decideReview` needs, read in the caller's transaction. */
async function reviewFor(
  client: Tx | typeof db,
  args: {
    firmId: string
    memberId: string
    dependentId: string | null
    providerId: string
    context: IssuanceContext
    totalAmount: number
    receiptHash: string | null
    ocrTotal: number | null
    on: Date
  }
): Promise<ReviewDecision> {
  const [settings, sameCategory, sameDay, hashes] = await Promise.all([
    client.ipmPortalSettings.findUnique({ where: { firmId: args.firmId } }),
    client.ipmVoucher.findMany({
      where: {
        firmId: args.firmId,
        memberId: args.memberId,
        categoryId: args.context.categoryId,
        status: { in: [...LIVE] },
      },
      select: { totalAmount: true },
    }),
    client.ipmVoucher.count({
      where: {
        firmId: args.firmId,
        memberId: args.memberId,
        dependentId: args.dependentId,
        providerId: args.providerId,
        status: { in: [...LIVE] },
        issueDate: dayBounds(args.on),
      },
    }),
    // Firm-wide: a receipt reused by *another* family is the case that
    // matters most. Recent ones are enough to catch a reuse.
    args.receiptHash
      ? client.ipmVoucher.findMany({
          where: { firmId: args.firmId, receiptHash: { not: null } },
          orderBy: { createdAt: "desc" },
          take: 5000,
          select: { receiptHash: true },
        })
      : Promise.resolve([]),
  ])

  return decideReview({
    totalAmount: args.totalAmount,
    ceilingMonthly: args.context.facts.ceilings.monthly,
    settings: toReviewSettings(settings),
    previousTotals: sameCategory.map((v) => Number(v.totalAmount)),
    sameDayDuplicate: sameDay > 0,
    receiptHash: args.receiptHash,
    previousReceiptHashes: hashes
      .map((v) => v.receiptHash)
      .filter((hash): hash is string => Boolean(hash)),
    ocrTotal: args.ocrTotal,
  })
}

/** Warnings and review, combined into one admission. */
function admission(decision: AllowedDecision, review: ReviewDecision): Admission {
  const flags: IpmReviewFlag[] = [...review.flags]
  if (decision.warnings.length > 0) flags.push("ISSUANCE_WARNING")
  return {
    status: review.hold || decision.warnings.length > 0 ? "PENDING_REVIEW" : "ISSUED",
    reviewFlags: flags,
  }
}

/* ==========================================================================
 * Preview
 * ========================================================================== */

/** Same facts, same decisions, nothing written. */
export async function previewPortalVoucher(
  principal: PortalPrincipal,
  draft: z.infer<typeof previewDraftSchema>,
  on: Date = new Date()
): Promise<PreviewResponse> {
  const lines = draftLines(draft)
  const totalAmount = lineTotal(lines)
  const { serviceTypeId } = await resolveBooking(
    db,
    principal.firmId,
    draft.type,
    draft.providerId
  )

  const context = await gatherIssuanceFacts(
    { firmId: principal.firmId },
    {
      memberId: principal.memberId,
      dependentId: draft.dependentId,
      providerId: draft.providerId,
      serviceTypeId,
      totalAmount,
      on,
    }
  )
  if (!context) throw notFound()

  const decision = decideIssuance(context.facts)
  if (!decision.allowed) {
    return {
      allowed: false,
      refusals: decision.refusals.map((r) => r.message),
      warnings: decision.warnings.map((w) => w.message),
      totalAmount,
      split: null,
      wouldHold: false,
      flags: [],
      threshold: null,
    }
  }

  const review = await reviewFor(db, {
    firmId: principal.firmId,
    memberId: principal.memberId,
    dependentId: draft.dependentId,
    providerId: draft.providerId,
    context,
    totalAmount,
    receiptHash: draft.receiptHash,
    ocrTotal: draft.ocrTotal,
    on,
  })
  const admitted = admission(decision, review)

  return {
    allowed: true,
    refusals: [],
    warnings: decision.warnings.map((w) => w.message),
    totalAmount,
    split: decision.split,
    wouldHold: admitted.status === "PENDING_REVIEW",
    flags: admitted.reviewFlags,
    threshold: review.threshold,
  }
}

/* ==========================================================================
 * Émission
 * ========================================================================== */

export function notFound(): PortalError {
  return new PortalError(
    404,
    "NOT_FOUND",
    "Bénéficiaire, prestataire ou prestation introuvable."
  )
}

/** The bon already written for this idempotency key, if any. */
export async function existingForRequest(
  client: Tx | typeof db,
  principal: PortalPrincipal,
  clientRequestId: string
): Promise<{ id: string } | null> {
  const existing = await client.ipmVoucher.findUnique({
    where: {
      firmId_clientRequestId: { firmId: principal.firmId, clientRequestId },
    },
    select: { id: true, issuedByPortalAccountId: true },
  })
  if (!existing) return null
  // Another account's key: answering with its bon would leak it.
  if (existing.issuedByPortalAccountId !== principal.portalAccountId) {
    throw new PortalError(
      409,
      "REQUEST_ID_CONFLICT",
      "Cette demande a déjà été utilisée. Recommencez la saisie."
    )
  }
  return { id: existing.id }
}

export async function issuePortalVoucher(
  tx: Tx,
  principal: PortalPrincipal,
  draft: ParsedDraft,
  /** Null when the participant skipped the photo. */
  receiptUrl: string | null,
  on: Date = new Date()
): Promise<{ id: string }> {
  try {
    // Inside the transaction, so the mapping used is the one committed now.
    const { serviceTypeId } = await resolveBooking(
      tx,
      principal.firmId,
      draft.type,
      draft.providerId
    )
    const created = await createVoucher(
      tx,
      {
        firmId: principal.firmId,
        actor: { kind: "portal", portalAccountId: principal.portalAccountId },
      },
      {
        type: draft.type,
        memberId: principal.memberId,
        dependentId: draft.dependentId,
        providerId: draft.providerId,
        serviceTypeId,
        issueDate: on,
        lines: draftLines(draft),
        admit: async ({ tx, decision, context, totalAmount }) =>
          admission(
            decision,
            await reviewFor(tx, {
              firmId: principal.firmId,
              memberId: principal.memberId,
              dependentId: draft.dependentId,
              providerId: draft.providerId,
              context,
              // Never null here: a bon with a receipt is issued with lines.
              totalAmount: totalAmount ?? 0,
              receiptHash: draft.receiptHash,
              ocrTotal: draft.ocrTotal,
              on,
            })
          ),
        portal: {
          entryMode: draft.entryMode,
          receiptUrl,
          receiptHash: draft.receiptHash,
          ocrTotal: draft.ocrTotal,
          clientRequestId: draft.clientRequestId,
        },
      }
    )
    return { id: created.voucher.id }
  } catch (error) {
    if (error instanceof VoucherInputNotFoundError) throw notFound()
    throw error
  }
}

/* ==========================================================================
 * Annulation
 * ========================================================================== */

/**
 * The participant may cancel their own bon while nobody has acted on it yet —
 * issued, still pending, or a bon de pharmacie still waiting for its amount.
 * The family check comes first, so a bon of another family is a 403 whatever
 * its state.
 */
export async function cancelPortalVoucher(
  tx: Tx,
  principal: PortalPrincipal,
  voucherId: string,
  reason: string
): Promise<ClosedVoucher> {
  const voucher = await tx.ipmVoucher.findFirst({
    where: { id: voucherId, firmId: principal.firmId },
    select: { memberId: true, status: true },
  })
  if (!voucher) throw new PortalError(404, "NOT_FOUND", "Bon introuvable.")
  if (voucher.memberId !== principal.memberId) {
    throw new PortalError(403, "FORBIDDEN", "Ce bon n'appartient pas à votre famille.")
  }
  if (!participantMayCancel(voucher.status)) {
    throw new PortalError(
      409,
      "NOT_CANCELLABLE",
      "Ce bon a déjà été utilisé ou clôturé : il ne peut plus être annulé."
    )
  }

  try {
    return await cancelVoucherCore(
      tx,
      {
        firmId: principal.firmId,
        actor: { kind: "portal", portalAccountId: principal.portalAccountId },
      },
      { voucherId, reason }
    )
  } catch (error) {
    if (error instanceof ActionError) {
      throw new PortalError(409, "NOT_CANCELLABLE", error.message)
    }
    throw error
  }
}
