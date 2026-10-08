import "server-only"

import { randomBytes } from "node:crypto"

import type { IpmReviewFlag, Prisma } from "@prisma/client"

import { ActionError } from "@/server/actions/define-action"
import {
  amountRequiredFor,
  decideDeferredIssuance,
  validationDeadline,
} from "@/server/domain/ipm/deferred-amount"
import {
  decideIssuance,
  expiryFor,
  formatVoucherNumber,
  type IssuanceDecision,
  type Refusal,
  type VoucherType,
} from "@/server/domain/ipm/issuance"
import { lineTotal } from "@/server/domain/ipm/settlement"
import { nextVoucherSequence } from "@/server/domain/ipm/sequence"
import {
  firmCode,
  issueToken,
  verificationSecret,
} from "@/server/domain/ipm/verification-token"
import {
  beneficiaryRef,
  gatherIssuanceFacts,
  type IssuanceContext,
} from "@/server/queries/ipm/vouchers"

/**
 * Bons — the write path, shared by the back office and the portal.
 *
 * The back-office actions (`issueVoucher`, `cancelVoucher`) and the portal API
 * both write bons, and the rules for doing so must live in one place: a
 * plafond checked by one entry point and not the other is a plafond that can
 * be walked around. So the steps that make a bon what it is — facts, decision,
 * sequence, voucher, lines, consumption — are here, and each caller adds only
 * what is genuinely its own:
 *
 *   - **who is acting** (`Actor`): a User from a session, or a PortalAccount
 *     from a bearer token. It decides `origin` and which "issued by" column is
 *     written, nothing else;
 *   - **what to do with an allowed decision** (`admit`): the back office
 *     refuses to proceed past a warning the operator has not acknowledged; the
 *     portal cannot acknowledge anything, so it holds the bon for review
 *     instead. That difference is policy, and policy stays with the caller;
 *   - **the audit trail**, which needs a User and is therefore the caller's.
 *
 * Everything here runs inside the caller's transaction and never opens one.
 */

type Tx = Prisma.TransactionClient

export type Actor =
  | { kind: "user"; userId: string }
  | { kind: "portal"; portalAccountId: string }

export type WriteScope = { firmId: string; actor: Actor }

/** A participant, provider or service type that does not resolve in the firm. */
export class VoucherInputNotFoundError extends ActionError {
  constructor() {
    super("Participant, prestataire ou prestation introuvable.")
    this.name = "VoucherInputNotFoundError"
  }
}

/** `decideIssuance` refused. Carries the refusals, not only their text. */
export class IssuanceRefusedError extends ActionError {
  readonly refusals: Refusal[]

  constructor(refusals: Refusal[]) {
    const messages = refusals.map((refusal) => refusal.message)
    super(messages.join(" "), { _: messages })
    this.name = "IssuanceRefusedError"
    this.refusals = refusals
  }
}

export type AllowedDecision = Extract<IssuanceDecision, { allowed: true }>

/** What the caller decides once the rules have allowed the bon. */
export type Admission = {
  status: "ISSUED" | "PENDING_REVIEW" | "AWAITING_AMOUNT"
  reviewFlags: IpmReviewFlag[]
}

export type VoucherLineInput = {
  label: string
  quantity: number
  unitPrice: number
  medicalActId?: string | null
}

export type CreateVoucherInput = {
  type: VoucherType
  memberId: string
  dependentId: string | null
  providerId: string
  serviceTypeId: string
  issueDate: Date
  /** Empty for a bon issued without an amount (`deferred`). */
  lines: VoucherLineInput[]
  /**
   * A bon de pharmacie issued without an amount: the ordonnance stands in for
   * the receipt, and the pharmacy enters the amount when it validates. Only
   * for a type `amountRequiredFor` lets go without one.
   */
  deferred?: {
    prescriptionUrl: string
    prescriptionHash: string
    /** Days the pharmacy has to validate (IpmPortalSettings). */
    validationDays: number
  }
  /**
   * Called with the decision once it is known to be allowed, before anything
   * is written. Throws to stop, or says which status and flags to write.
   */
  admit: (args: {
    tx: Tx
    decision: AllowedDecision
    context: IssuanceContext
    /** Null for a deferred bon. */
    totalAmount: number | null
  }) => Promise<Admission>
  /** Portal-only columns. Ignored for a User actor. */
  portal?: {
    /** Null for a bon de pharmacie, which has no receipt to scan or type. */
    entryMode: "SCAN" | "MANUAL" | null
    receiptUrl: string | null
    receiptHash: string | null
    ocrTotal: number | null
    clientRequestId: string
  }
}

export type CreatedVoucher = {
  voucher: { id: string; number: string }
  status: Admission["status"]
  reviewFlags: IpmReviewFlag[]
  decision: AllowedDecision
  context: IssuanceContext
  totalAmount: number | null
}

/**
 * The QR of a bon de pharmacie à montant différé. Unlike the bearer token the
 * other bons carry, it names **this bon**: the pharmacist scans it to find the
 * bon they are validating. Random and opaque — 144 bits, nothing derivable
 * from the participant — and rotated to a dead token when the bon closes.
 */
export function newBonToken(): string {
  return `BP.${randomBytes(18).toString("base64url")}`
}

/**
 * Émission.
 *
 * Decided here, inside the transaction that writes. A preview the caller saw
 * may be seconds old, and a plafond can be consumed in that time by somebody
 * else's bon — the decision that counts is this one.
 *
 * Consumption is recorded at creation, for PENDING_REVIEW as much as for
 * ISSUED. The commitment is what a plafond has to account for: a bon in
 * circulation — or waiting for a signature — is money already promised, and
 * leaving it uncounted is how several pending bons add up past a ceiling the
 * moment they are all approved.
 */
export async function createVoucher(
  tx: Tx,
  scope: WriteScope,
  input: CreateVoucherInput
): Promise<CreatedVoucher> {
  const { firmId, actor } = scope
  const deferred = input.deferred ?? null
  if (deferred && amountRequiredFor(input.type)) {
    throw new ActionError(
      "Seul un bon de pharmacie peut être émis sans montant."
    )
  }
  const totalAmount = deferred
    ? null
    : lineTotal(
        input.lines.map((line) => ({
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        }))
      )

  const context = await gatherIssuanceFacts(
    { firmId },
    {
      memberId: input.memberId,
      dependentId: input.dependentId,
      providerId: input.providerId,
      serviceTypeId: input.serviceTypeId,
      totalAmount: totalAmount ?? 0,
      on: input.issueDate,
    },
    tx
  )
  if (!context) throw new VoucherInputNotFoundError()

  const decision = deferred
    ? decideDeferredIssuance(context.facts)
    : decideIssuance(context.facts)
  // What is never possible, for anyone, is proceeding past a refusal.
  if (!decision.allowed) throw new IssuanceRefusedError(decision.refusals)

  const admission = await input.admit({ tx, decision, context, totalAmount })

  const sequence = await nextVoucherSequence(tx, firmId, input.type)
  const number = formatVoucherNumber(input.type, sequence)
  const portal = actor.kind === "portal" ? input.portal : undefined

  const voucher = await tx.ipmVoucher.create({
    data: {
      firmId,
      number,
      type: input.type,
      memberId: input.memberId,
      dependentId: input.dependentId,
      beneficiaryType: context.beneficiaryType,
      beneficiaryName: context.beneficiaryName,
      providerId: input.providerId,
      serviceTypeId: input.serviceTypeId,
      categoryId: context.categoryId,
      issueDate: input.issueDate,
      expiryDate: deferred
        ? validationDeadline(input.issueDate, deferred.validationDays)
        : expiryFor(input.type, input.issueDate),
      status: admission.status,
      // A deferred bon carries no amount and commits nothing until validated.
      totalAmount,
      insurerShare: deferred ? 0 : decision.split.insurerShare,
      memberShare: deferred ? 0 : decision.split.memberShare,
      // Frozen. A later edit to a barème must not reprice a bon already in
      // somebody's hand.
      appliedRate: context.facts.rate!,
      rateSource: context.rateSource ?? "PLAN",
      qrToken: deferred
        ? newBonToken()
        : issueToken(
            {
              kind: "member",
              firmCode: firmCode(firmId),
              matricule: context.memberMatricule,
            },
            verificationSecret()
          ),
      issuedById: actor.kind === "user" ? actor.userId : null,
      origin: actor.kind === "portal" ? "PORTAL" : "BACKOFFICE",
      issuedByPortalAccountId:
        actor.kind === "portal" ? actor.portalAccountId : null,
      reviewFlags: admission.reviewFlags,
      ...(portal
        ? {
            entryMode: portal.entryMode,
            receiptUrl: portal.receiptUrl,
            receiptHash: portal.receiptHash,
            ocrTotal: portal.ocrTotal,
            clientRequestId: portal.clientRequestId,
          }
        : {}),
      ...(deferred
        ? {
            deferredAmount: true,
            prescriptionUrl: deferred.prescriptionUrl,
            prescriptionHash: deferred.prescriptionHash,
          }
        : {}),
    },
    select: { id: true, number: true },
  })

  // Nothing is counted for a deferred bon until it is validated: no line, no
  // consumption. See `server/ipm/voucher-amount.ts`.
  if (deferred || totalAmount === null) {
    return {
      voucher,
      status: admission.status,
      reviewFlags: admission.reviewFlags,
      decision,
      context,
      totalAmount,
    }
  }

  await tx.ipmVoucherLine.createMany({
    data: input.lines.map((line) => ({
      firmId,
      voucherId: voucher.id,
      medicalActId: line.medicalActId ?? null,
      label: line.label,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      amount: Math.round(line.quantity * line.unitPrice),
    })),
  })

  await tx.ipmConsumption.create({
    data: {
      firmId,
      beneficiaryRef: beneficiaryRef(input.memberId, input.dependentId),
      memberId: input.memberId,
      categoryId: context.categoryId,
      periodYear: input.issueDate.getFullYear(),
      periodMonth: input.issueDate.getMonth() + 1,
      voucherId: voucher.id,
      amount: totalAmount,
      insurerShare: decision.split.insurerShare,
    },
  })

  return {
    voucher,
    status: admission.status,
    reviewFlags: admission.reviewFlags,
    decision,
    context,
    totalAmount,
  }
}

/* ==========================================================================
 * Annulation, refus
 * ========================================================================== */

export type ClosedVoucher = {
  id: string
  number: string
  /** Status before the change. */
  previousStatus: string
  insurerShare: number
  memberId: string
  issuedByPortalAccountId: string | null
}

/**
 * The QR token a closed bon is rotated to: already expired, so a photographed
 * or printed copy stops resolving. The matricule is deliberately not the
 * bearer's — this token exists to fail, and it should carry nothing if it
 * leaks.
 */
export function deadToken(firmId: string): string {
  return issueToken(
    {
      kind: "member",
      firmCode: firmCode(firmId),
      matricule: "00000",
      expiresAt: 1,
    },
    verificationSecret()
  )
}

async function loadForClose(tx: Tx, firmId: string, voucherId: string) {
  const voucher = await tx.ipmVoucher.findFirst({
    where: { id: voucherId, firmId },
    select: {
      id: true,
      number: true,
      status: true,
      insurerShare: true,
      memberId: true,
      origin: true,
      issuedByPortalAccountId: true,
      deferredAmount: true,
    },
  })
  if (!voucher) throw new ActionError("Bon introuvable.")
  return voucher
}

/**
 * Takes a bon out of circulation: the status and its reason, a dead token, and
 * the consumption released — a closed bon must not keep holding space under a
 * plafond. The voucher row itself stays.
 */
async function release(
  tx: Tx,
  firmId: string,
  voucher: Awaited<ReturnType<typeof loadForClose>>,
  data: Prisma.IpmVoucherUncheckedUpdateManyInput
): Promise<ClosedVoucher> {
  // Conditional on the status just read: a gestionnaire approving while the
  // participant cancels must not have the second write silently undo the
  // first. Whoever loses is told, and nothing is written for them.
  const { count } = await tx.ipmVoucher.updateMany({
    where: { id: voucher.id, status: voucher.status },
    data: { ...data, qrToken: deadToken(firmId) },
  })
  if (count === 0) {
    throw new ActionError("Ce bon vient d'être modifié. Rechargez la page.")
  }
  await tx.ipmConsumption.deleteMany({ where: { voucherId: voucher.id } })

  return {
    id: voucher.id,
    number: voucher.number,
    previousStatus: voucher.status,
    insurerShare: Number(voucher.insurerShare),
    memberId: voucher.memberId,
    issuedByPortalAccountId: voucher.issuedByPortalAccountId,
  }
}

/**
 * Annulation, by either actor. Which statuses a *participant* may cancel is
 * narrower than this and is checked by the portal before calling.
 */
export async function cancelVoucherCore(
  tx: Tx,
  scope: WriteScope,
  input: { voucherId: string; reason: string }
): Promise<ClosedVoucher> {
  const voucher = await loadForClose(tx, scope.firmId, input.voucherId)

  if (voucher.status === "CANCELLED") {
    throw new ActionError("Ce bon est déjà annulé.")
  }
  if (voucher.status === "REJECTED") {
    throw new ActionError("Ce bon a été refusé : il ne peut pas être annulé.")
  }
  if (voucher.status === "INVOICED") {
    throw new ActionError(
      "Ce bon est rattaché à une facture prestataire : il ne peut plus être annulé."
    )
  }
  // A validated bon de pharmacie has posted to the register and may sit on an
  // invoice; releasing only its consumption here would leave both behind.
  // Its annulation goes through `voidDeferredVoucher`, which undoes all three.
  if (voucher.deferredAmount && voucher.status === "SETTLED") {
    throw new ActionError(
      "Ce bon de pharmacie est validé : annulez-le depuis ses actions IPM, qui reprennent aussi le solde et la facture."
    )
  }

  return release(tx, scope.firmId, voucher, {
    status: "CANCELLED",
    cancelledAt: new Date(),
    cancelReason: input.reason,
  })
}

/**
 * Refus à la validation — a portal bon held for review that the gestionnaire
 * turns down. Same release as a cancellation; the reason goes to
 * `reviewReason`, which is what the participant is shown.
 */
export async function rejectVoucherCore(
  tx: Tx,
  scope: { firmId: string; reviewerId: string },
  input: { voucherId: string; reason: string }
): Promise<ClosedVoucher> {
  const voucher = await loadForClose(tx, scope.firmId, input.voucherId)
  if (voucher.origin !== "PORTAL" || voucher.status !== "PENDING_REVIEW") {
    throw new ActionError("Ce bon n'est plus en attente de validation.")
  }

  return release(tx, scope.firmId, voucher, {
    status: "REJECTED",
    reviewReason: input.reason,
    reviewedAt: new Date(),
    reviewedById: scope.reviewerId,
  })
}
