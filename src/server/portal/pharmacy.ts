import "server-only"

import type { IpmReviewFlag, Prisma } from "@prisma/client"
import { z } from "zod"

import { db } from "@/lib/db"
import {
  amountRequiredFor,
  DEFAULT_VALIDATION_DAYS,
  decideDeferredIssuance,
  remainingEnvelope,
} from "@/server/domain/ipm/deferred-amount"
import { createVoucher, VoucherInputNotFoundError } from "@/server/ipm/voucher-writes"
import type { PortalPrincipal } from "@/server/portal/auth"
import type {
  PharmacyIssueResponse,
  PharmacyPreviewResponse,
} from "@/server/portal/contract"
import { PortalError } from "@/server/portal/http"
import { notFound, resolveBooking } from "@/server/portal/vouchers"
import { gatherIssuanceFacts } from "@/server/queries/ipm/vouchers"

/**
 * Bon de pharmacie à montant différé — the participant's side.
 *
 * The participant names who it is for, the pharmacy, and attaches the
 * ordonnance. There is no amount: the pharmacy only gives a receipt once paid,
 * so it enters the amount itself when it validates (`server/ipm/voucher-amount`).
 *
 * The eligibility checks are the issuance checks every bon runs — same facts,
 * same refusals — minus the ones that need an amount. A warning (cotisations
 * late, convention lapsed) does **not** hold the bon here as it holds a
 * receipt bon: the pharmacist must be able to validate it at the counter, so
 * the bon is issued and flagged ISSUANCE_WARNING for the gestionnaire.
 */

type Tx = Prisma.TransactionClient

/** Statuses during which an ordonnance is "in use". */
const LIVE = ["AWAITING_AMOUNT", "PENDING_REVIEW", "ISSUED", "PRESENTED", "SETTLED", "INVOICED"] as const

export const pharmacyRequestSchema = z.object({
  beneficiaryRef: z
    .string()
    .regex(/^(member|dependent):[A-Za-z0-9_-]{1,64}$/, "Bénéficiaire invalide."),
  category: z.enum(["PHARMACY", "OPTICAL", "GUARANTEE", "HOSPITALIZATION"]),
  providerId: z.string().min(1, "Choisissez une pharmacie.").max(64),
})

export const pharmacyIssueSchema = pharmacyRequestSchema.extend({
  clientRequestId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/, "Identifiant de requête invalide.")
    .optional(),
})

export type PharmacyRequest = z.infer<typeof pharmacyRequestSchema>

/**
 * `member:<id>` must be the caller's own participant; `dependent:<id>` is
 * checked against the family by `gatherIssuanceFacts`, which does not resolve
 * an ayant droit of another family.
 */
export function beneficiaryOf(
  principal: PortalPrincipal,
  ref: string
): { dependentId: string | null } {
  const [kind, id] = ref.split(":") as ["member" | "dependent", string]
  if (kind === "member") {
    if (id !== principal.memberId) throw notFound()
    return { dependentId: null }
  }
  return { dependentId: id }
}

function requireDeferredCategory(category: PharmacyRequest["category"]): "PHARMACY" {
  if (amountRequiredFor(category)) {
    throw new PortalError(
      422,
      "CATEGORY_NOT_DEFERRED",
      "Seul un bon de pharmacie s'émet sans montant. Pour les autres, joignez le reçu."
    )
  }
  return "PHARMACY"
}

async function validationDays(client: Tx | typeof db, firmId: string): Promise<number> {
  const settings = await client.ipmPortalSettings.findUnique({
    where: { firmId },
    select: { pharmacyValidationDays: true },
  })
  return settings?.pharmacyValidationDays ?? DEFAULT_VALIDATION_DAYS
}

/** Eligibility, nothing written. */
export async function previewPharmacyVoucher(
  principal: PortalPrincipal,
  input: PharmacyRequest,
  on: Date = new Date()
): Promise<PharmacyPreviewResponse> {
  const type = requireDeferredCategory(input.category)
  const { dependentId } = beneficiaryOf(principal, input.beneficiaryRef)
  // Also the check that the provider is one this type may go to: a pharmacy.
  const { serviceTypeId } = await resolveBooking(db, principal.firmId, type, input.providerId)

  const [context, days] = await Promise.all([
    gatherIssuanceFacts(
      { firmId: principal.firmId },
      {
        memberId: principal.memberId,
        dependentId,
        providerId: input.providerId,
        serviceTypeId,
        totalAmount: 0,
        on,
      }
    ),
    validationDays(db, principal.firmId),
  ])
  if (!context) throw notFound()

  const decision = decideDeferredIssuance(context.facts)
  return {
    allowed: decision.allowed,
    refusals: decision.allowed ? [] : decision.refusals.map((r) => r.message),
    warnings: decision.warnings.map((w) => w.message),
    rate: context.facts.rate,
    remainingCeiling: remainingEnvelope(context.facts.ceilings, context.facts.consumed),
    validationDays: days,
  }
}

/** The bon already written for this idempotency key by this account, if any. */
export async function existingPharmacyRequest(
  client: Tx | typeof db,
  principal: PortalPrincipal,
  clientRequestId: string | undefined
): Promise<PharmacyIssueResponse | null> {
  if (!clientRequestId) return null
  const existing = await client.ipmVoucher.findUnique({
    where: { firmId_clientRequestId: { firmId: principal.firmId, clientRequestId } },
    select: {
      id: true,
      number: true,
      qrToken: true,
      status: true,
      expiryDate: true,
      deferredAmount: true,
      issuedByPortalAccountId: true,
    },
  })
  if (!existing) return null
  if (existing.issuedByPortalAccountId !== principal.portalAccountId || !existing.deferredAmount) {
    throw new PortalError(
      409,
      "REQUEST_ID_CONFLICT",
      "Cette demande a déjà été utilisée. Recommencez la saisie."
    )
  }
  return {
    voucherId: existing.id,
    number: existing.number,
    qrToken: existing.qrToken,
    status: "AWAITING_AMOUNT",
    expiresAt: existing.expiryDate.toISOString(),
  }
}

export async function issuePharmacyVoucher(
  tx: Tx,
  principal: PortalPrincipal,
  input: z.infer<typeof pharmacyIssueSchema>,
  prescription: { url: string; hash: string },
  on: Date = new Date()
): Promise<PharmacyIssueResponse> {
  const type = requireDeferredCategory(input.category)
  const { dependentId } = beneficiaryOf(principal, input.beneficiaryRef)

  try {
    const { serviceTypeId } = await resolveBooking(tx, principal.firmId, type, input.providerId)
    const days = await validationDays(tx, principal.firmId)

    const created = await createVoucher(
      tx,
      {
        firmId: principal.firmId,
        actor: { kind: "portal", portalAccountId: principal.portalAccountId },
      },
      {
        type,
        memberId: principal.memberId,
        dependentId,
        providerId: input.providerId,
        serviceTypeId,
        issueDate: on,
        lines: [],
        deferred: {
          prescriptionUrl: prescription.url,
          prescriptionHash: prescription.hash,
          validationDays: days,
        },
        admit: async ({ tx, decision }) => {
          const flags: IpmReviewFlag[] = []
          if (decision.warnings.length > 0) flags.push("ISSUANCE_WARNING")
          const reused = await tx.ipmVoucher.count({
            where: {
              firmId: principal.firmId,
              prescriptionHash: prescription.hash,
              status: { in: [...LIVE] },
            },
          })
          if (reused > 0) flags.push("PRESCRIPTION_REUSED")
          return { status: "AWAITING_AMOUNT", reviewFlags: flags }
        },
        portal: {
          entryMode: null,
          receiptUrl: null,
          receiptHash: null,
          ocrTotal: null,
          // The unique index wants a value; a request with no key gets a
          // random one, which simply never matches a retry.
          clientRequestId: input.clientRequestId ?? `auto-${crypto.randomUUID()}`,
        },
      }
    )

    const row = await tx.ipmVoucher.findUniqueOrThrow({
      where: { id: created.voucher.id },
      select: { qrToken: true, expiryDate: true },
    })
    return {
      voucherId: created.voucher.id,
      number: created.voucher.number,
      qrToken: row.qrToken,
      status: "AWAITING_AMOUNT",
      expiresAt: row.expiryDate.toISOString(),
    }
  } catch (error) {
    if (error instanceof VoucherInputNotFoundError) throw notFound()
    throw error
  }
}
