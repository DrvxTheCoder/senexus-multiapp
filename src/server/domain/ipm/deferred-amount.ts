import {
  split,
  type Ceilings,
  type ConsumedSoFar,
  type Split,
} from "@/server/domain/ipm/settlement"
import {
  decideIssuance,
  type IssuanceDecision,
  type IssuanceFacts,
  type VoucherType,
} from "@/server/domain/ipm/issuance"

/**
 * Bon de pharmacie à montant différé.
 *
 * A pharmacy gives a receipt only once it has been paid, so a participant
 * cannot state the amount when the bon is issued. The bon is issued without
 * one (AWAITING_AMOUNT), the participant attaches the ordonnance, and the
 * pharmacist enters the global amount when they validate. Validation is the
 * moment the bon starts to count: plafonds, the participant's balance, the
 * provider's invoice.
 *
 * Three consequences, all decided here and nowhere else:
 *
 *   - **nothing is reserved while the bon waits.** No consumption, no ledger
 *     entry. Two bons waiting at once can therefore both validate; the second
 *     simply finds less plafond left. Reserving an unknown amount would mean
 *     reserving a guess;
 *   - **the plafond caps instead of refusing.** At the counter the medicine
 *     has already been handed over; refusing the bon then would leave the
 *     participant owing everything. So the IPM covers up to what is left under
 *     the plafond and the participant pays the rest;
 *   - **the taux is the one frozen at issue**, as for every bon. Only the
 *     plafonds are read at validation, because that is when the commitment
 *     is made.
 *
 * Pure: the caller loads the facts and writes the result.
 */

/** The only kind of bon whose amount may be entered after issue. */
export const DEFERRED_AMOUNT_TYPES: readonly VoucherType[] = ["PHARMACY"]

export class AmountPolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AmountPolicyError"
  }
}

/**
 * Whether a bon of this type must carry its amount at issue. Every type but
 * pharmacy does; the column being nullable does not make the amount optional.
 */
export function amountRequiredFor(type: VoucherType): boolean {
  return !DEFERRED_AMOUNT_TYPES.includes(type)
}

/** Refuses a missing amount on a type that requires one. */
export function assertAmountPolicy(type: VoucherType, totalAmount: number | null): void {
  if (totalAmount === null && amountRequiredFor(type)) {
    throw new AmountPolicyError(
      "Le montant est obligatoire pour ce type de bon : seul un bon de pharmacie peut être émis sans montant."
    )
  }
}

/** The ceiling on an amount anybody may type: a typo, not a prescription. */
export const MAX_DEFERRED_AMOUNT = 100_000_000

/**
 * A global amount as a pharmacist types it. Whole francs — FCFA has no
 * subunit — strictly positive, and below an absurd ceiling.
 */
export function isValidAmount(amount: unknown): amount is number {
  return (
    typeof amount === "number" &&
    Number.isInteger(amount) &&
    amount > 0 &&
    amount <= MAX_DEFERRED_AMOUNT
  )
}

/* ==========================================================================
 * Émission
 * ========================================================================== */

/**
 * Eligibility only: the participant (or ayant droit) is covered, the category
 * has a taux, the provider is active and agréé, the carence has run. There is
 * no amount, so no split and no plafond test against one — with one
 * exception: a plafond already **exhausted** refuses, because a bon the IPM
 * would cover at zero is no prise en charge at all, and the participant should
 * learn that at home rather than at the counter.
 */
export function decideDeferredIssuance(facts: IssuanceFacts): IssuanceDecision {
  const decision = decideIssuance({ ...facts, totalAmount: 0 })
  if (!decision.allowed) return decision

  if (remainingEnvelope(facts.ceilings, facts.consumed) === 0) {
    return {
      allowed: false,
      refusals: [
        {
          code: "CEILING_REACHED",
          message:
            "Plafond épuisé : plus aucune prise en charge n'est disponible dans cette catégorie.",
          detail: { remaining: 0 },
        },
      ],
      warnings: decision.warnings,
    }
  }
  return decision
}

/* ==========================================================================
 * L'enveloppe
 * ========================================================================== */

/**
 * What is left under the plafonds for the IPM share, or null when none
 * applies. The tightest of the three: the per-act plafond as it stands, and
 * the monthly and annual ones less what the beneficiary already consumed in
 * the category. Never negative — a plafond already overrun leaves zero, not a
 * debt for the next bon to repay.
 *
 * Fixed amounts set by the IPM (formule, employeur, plafond particulier). The
 * participant's cotisations do not enter into it.
 */
export function remainingEnvelope(
  ceilings: Ceilings,
  consumed: ConsumedSoFar
): number | null {
  const candidates: number[] = []
  if (ceilings.perAct !== null) candidates.push(ceilings.perAct)
  if (ceilings.monthly !== null) candidates.push(ceilings.monthly - consumed.month)
  if (ceilings.annual !== null) candidates.push(ceilings.annual - consumed.year)
  if (candidates.length === 0) return null
  return Math.max(0, Math.floor(Math.min(...candidates)))
}

export type DeferredSplit = Split & {
  /** True when the plafond, not the taux, set the IPM share. */
  capped: boolean
  /** What the taux alone would have given — shown when the bon was capped. */
  uncappedInsurerShare: number
  /** The envelope it was measured against; null when unlimited. */
  remaining: number | null
}

/**
 * The split of a pharmacy amount: the taux first, through the same `split`
 * every bon uses (so the IPM keeps absorbing the odd franc), then the
 * envelope. When the taux asks for more than is left, the IPM pays what is
 * left and the participant pays the difference.
 */
export function deferredSplit(
  amount: number,
  rate: number,
  remaining: number | null
): DeferredSplit {
  const base = split(amount, rate)
  if (remaining !== null && base.insurerShare > remaining) {
    return {
      totalAmount: amount,
      insurerShare: remaining,
      memberShare: amount - remaining,
      capped: true,
      uncappedInsurerShare: base.insurerShare,
      remaining,
    }
  }
  return {
    ...base,
    capped: false,
    uncappedInsurerShare: base.insurerShare,
    remaining,
  }
}

export type ValidationFlag = "CEILING_CAPPED" | "AMOUNT_ABOVE_THRESHOLD"

/**
 * What a gestionnaire should look at. A flag never blocks: the bon validates
 * and counts either way.
 */
export function validationFlags(
  result: Pick<DeferredSplit, "totalAmount" | "capped">,
  reviewThreshold: number | null
): ValidationFlag[] {
  const flags: ValidationFlag[] = []
  if (result.capped) flags.push("CEILING_CAPPED")
  if (reviewThreshold !== null && result.totalAmount > reviewThreshold) {
    flags.push("AMOUNT_ABOVE_THRESHOLD")
  }
  return flags
}

/* ==========================================================================
 * Qui peut faire quoi, et quand
 * ========================================================================== */

export type AmountRefusal =
  | "NOT_DEFERRED"
  | "WRONG_PROVIDER"
  | "ALREADY_VALIDATED"
  | "EXPIRED"
  | "CANCELLED"
  | "NOT_VALIDATED"
  | "INVOICE_LOCKED"

export const AMOUNT_REFUSAL_MESSAGES: Record<AmountRefusal, string> = {
  NOT_DEFERRED: "Ce bon n'est pas un bon de pharmacie à montant différé.",
  WRONG_PROVIDER: "Ce bon n'est pas adressé à votre établissement.",
  ALREADY_VALIDATED: "Ce bon a déjà été validé.",
  EXPIRED: "Ce bon a expiré : il ne peut plus être validé.",
  CANCELLED: "Ce bon a été annulé.",
  NOT_VALIDATED: "Ce bon n'a pas encore de montant validé.",
  INVOICE_LOCKED:
    "Ce bon figure sur une facture déjà approuvée ou réglée : il ne peut plus être modifié.",
}

export type VoucherAmountState = {
  status: string
  deferredAmount: boolean
  providerId: string
  expiryDate: Date
  validationKey: string | null
  validatedByProviderAccountId: string | null
  /** Status of the provider invoice the bon is on, if any. */
  invoiceStatus: string | null
}

const VALIDATED = ["SETTLED", "INVOICED"]
const CLOSED = ["CANCELLED", "REJECTED"]
/** An invoice past these can no longer change under anybody's feet. */
const LOCKED_INVOICE = ["APPROVED", "PAID"]

export type ProviderValidationDecision =
  | { kind: "validate" }
  /** Same key, same account: answer what was written the first time. */
  | { kind: "replay" }
  | { kind: "refuse"; code: AmountRefusal }

/**
 * The pharmacy's validation. The provider check comes first, so a pharmacy
 * that scans somebody else's bon learns nothing about its state.
 *
 * An AWAITING_AMOUNT bon past its expiry is refused as EXPIRED even if the
 * expiry job has not caught up with it yet: the date decides, not the job.
 */
export function decideProviderValidation(
  state: VoucherAmountState,
  caller: { providerId: string; providerAccountId: string; key: string; now: Date }
): ProviderValidationDecision {
  if (!state.deferredAmount) return { kind: "refuse", code: "NOT_DEFERRED" }
  if (state.providerId !== caller.providerId) {
    return { kind: "refuse", code: "WRONG_PROVIDER" }
  }
  if (VALIDATED.includes(state.status)) {
    return state.validationKey === caller.key &&
      state.validatedByProviderAccountId === caller.providerAccountId
      ? { kind: "replay" }
      : { kind: "refuse", code: "ALREADY_VALIDATED" }
  }
  if (CLOSED.includes(state.status)) return { kind: "refuse", code: "CANCELLED" }
  if (state.status === "EXPIRED") return { kind: "refuse", code: "EXPIRED" }
  if (state.status !== "AWAITING_AMOUNT") {
    return { kind: "refuse", code: "ALREADY_VALIDATED" }
  }
  if (state.expiryDate < caller.now) return { kind: "refuse", code: "EXPIRED" }
  return { kind: "validate" }
}

/**
 * The gestionnaire entering the amount on the pharmacy's behalf — for a
 * pharmacy that will not use the portal. Not bound to the provider and not
 * stopped by the expiry: an expired bon whose medicine was in fact dispensed
 * is exactly the case this exists for.
 */
export function decideBackOfficeValidation(
  state: VoucherAmountState
): { kind: "validate" } | { kind: "refuse"; code: AmountRefusal } {
  if (!state.deferredAmount) return { kind: "refuse", code: "NOT_DEFERRED" }
  if (VALIDATED.includes(state.status)) {
    return { kind: "refuse", code: "ALREADY_VALIDATED" }
  }
  if (CLOSED.includes(state.status)) return { kind: "refuse", code: "CANCELLED" }
  if (state.status === "AWAITING_AMOUNT" || state.status === "EXPIRED") {
    return { kind: "validate" }
  }
  return { kind: "refuse", code: "ALREADY_VALIDATED" }
}

/** Changing the amount of a bon already validated. */
export function decideAdjustment(
  state: VoucherAmountState
): { kind: "adjust" } | { kind: "refuse"; code: AmountRefusal } {
  if (!state.deferredAmount) return { kind: "refuse", code: "NOT_DEFERRED" }
  if (CLOSED.includes(state.status)) return { kind: "refuse", code: "CANCELLED" }
  if (!VALIDATED.includes(state.status)) {
    return { kind: "refuse", code: "NOT_VALIDATED" }
  }
  if (state.invoiceStatus && LOCKED_INVOICE.includes(state.invoiceStatus)) {
    return { kind: "refuse", code: "INVOICE_LOCKED" }
  }
  return { kind: "adjust" }
}

/** Annulation by the IPM, at any stage short of an approved invoice. */
export function decideVoid(
  state: VoucherAmountState
): { kind: "void" } | { kind: "refuse"; code: AmountRefusal } {
  if (!state.deferredAmount) return { kind: "refuse", code: "NOT_DEFERRED" }
  if (CLOSED.includes(state.status)) return { kind: "refuse", code: "CANCELLED" }
  if (state.invoiceStatus && LOCKED_INVOICE.includes(state.invoiceStatus)) {
    return { kind: "refuse", code: "INVOICE_LOCKED" }
  }
  return { kind: "void" }
}

/** What a participant may still withdraw: anything nobody has acted on. */
export function participantMayCancel(status: string): boolean {
  return ["ISSUED", "PENDING_REVIEW", "AWAITING_AMOUNT"].includes(status)
}

/**
 * The status to show: a bon still waiting past its deadline reads EXPIRED
 * whether or not the expiry job has written it yet.
 */
export function effectiveStatus(status: string, expiryDate: Date, now: Date): string {
  return status === "AWAITING_AMOUNT" && expiryDate < now ? "EXPIRED" : status
}

/** Whether a bon counts — plafonds, balance, invoice. Read off the row. */
export function counts(state: { status: string; totalAmount: number | null }): boolean {
  return VALIDATED.includes(state.status) && state.totalAmount !== null
}

/* ==========================================================================
 * Dates
 * ========================================================================== */

export const DEFAULT_VALIDATION_DAYS = 7

/** The last moment a pharmacy may validate: `days` after issue. */
export function validationDeadline(issuedAt: Date, days: number): Date {
  return new Date(issuedAt.getTime() + days * 86_400_000)
}

/** `YYYY-MM` → the month's bounds, UTC (Dakar is UTC+0 all year). */
export function monthBounds(month: string): { from: Date; to: Date } | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month)
  if (!match) return null
  const year = Number(match[1])
  const index = Number(match[2]) - 1
  return {
    from: new Date(Date.UTC(year, index, 1)),
    to: new Date(Date.UTC(year, index + 1, 1)),
  }
}

export function monthOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
}

/* ==========================================================================
 * Le registre
 * ========================================================================== */

export type LedgerCorrection =
  | { type: "CONSUMPTION"; debit: number }
  | { type: "ADJUSTMENT"; debit: number }
  | { type: "ADJUSTMENT"; credit: number }
  | { type: "REVERSAL"; credit: number }

/**
 * The one entry that brings what the register holds for a bon to what the bon
 * now says. The register is write-only, so a change is never an edit: the
 * first posting is a CONSUMPTION, a later change of amount an ADJUSTMENT for
 * the difference, and a bon that stops counting a REVERSAL of everything
 * still posted.
 *
 * `posted` is the net already in the register for this bon (debits less
 * credits); `target` is what it should be. Amounts are whole francs, so the
 * comparison is exact.
 */
export function ledgerCorrection(posted: number, target: number): LedgerCorrection | null {
  const delta = target - posted
  if (delta === 0) return null
  if (posted === 0) {
    return { type: "CONSUMPTION", debit: delta }
  }
  if (target === 0) return { type: "REVERSAL", credit: posted }
  return delta > 0
    ? { type: "ADJUSTMENT", debit: delta }
    : { type: "ADJUSTMENT", credit: -delta }
}
