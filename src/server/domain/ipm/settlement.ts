/**
 * Moteur de règlement — plan §5.
 *
 * One formula, verified against 356 settled vouchers in the legacy data with
 * no exception:
 *
 *   insurerShare = ceil(totalAmount × rate)
 *   memberShare  = totalAmount − insurerShare
 *
 * The rounding direction is not cosmetic. `ceil` means the **IPM absorbs the
 * residual franc** on an odd amount, and the participant never pays a franc
 * more than the arithmetic says. Rounding the other way would shift that franc
 * onto the member on roughly half of all vouchers, which is both wrong and the
 * kind of wrong nobody notices until somebody totals a year of tickets.
 *
 * FCFA has no subunit, so every amount here is a whole number of francs.
 */

export type Split = {
  totalAmount: number
  insurerShare: number
  memberShare: number
}

export class SettlementError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SettlementError"
  }
}

/**
 * Splits an amount between the institution and the member.
 *
 * Refuses a negative total and a rate outside [0, 1] rather than producing a
 * number: a negative share is not a settlement, and a rate above 1 would have
 * the institution paying more than the bill.
 */
export function split(totalAmount: number, rate: number): Split {
  if (!Number.isFinite(totalAmount) || totalAmount < 0) {
    throw new SettlementError("Le montant total doit être positif.")
  }
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new SettlementError("Le taux doit être compris entre 0 et 1.")
  }

  const insurerShare = Math.ceil(totalAmount * rate)
  return {
    totalAmount,
    insurerShare,
    memberShare: totalAmount - insurerShare,
  }
}

/** Sum of the lines. The voucher total is never entered by hand. */
export function lineTotal(
  lines: readonly { quantity: number; unitPrice: number }[]
): number {
  return lines.reduce(
    (sum, line) => sum + Math.round(line.quantity * line.unitPrice),
    0
  )
}

/* ==========================================================================
 * Plafonds
 * ========================================================================== */

export type Ceilings = {
  perAct: number | null
  monthly: number | null
  annual: number | null
}

export type ConsumedSoFar = {
  /** Insurer share already consumed this calendar month, same category. */
  month: number
  /** Insurer share already consumed this calendar year, same category. */
  year: number
}

export type CeilingBreach = {
  kind: "PER_ACT" | "MONTHLY" | "ANNUAL"
  ceiling: number
  /** What the institution would have paid, had the ceiling not applied. */
  requested: number
  /** What is actually left under the ceiling. Zero when it is exhausted. */
  remaining: number
}

/**
 * Whether a proposed insurer share fits under the ceilings.
 *
 * Ceilings apply to the **insurer's share**, not the invoice total: they cap
 * what the institution commits, which is the figure §11 Q9 settled as the one
 * that matters. A null ceiling is unlimited — and that is also how the legacy
 * `seuil_conso` values of 1e8 to 1e12 are imported, since a threshold nobody
 * can reach is not a threshold.
 */
export function checkCeilings(
  insurerShare: number,
  ceilings: Ceilings,
  consumed: ConsumedSoFar
): CeilingBreach | null {
  if (ceilings.perAct !== null && insurerShare > ceilings.perAct) {
    return {
      kind: "PER_ACT",
      ceiling: ceilings.perAct,
      requested: insurerShare,
      remaining: ceilings.perAct,
    }
  }

  if (
    ceilings.monthly !== null &&
    consumed.month + insurerShare > ceilings.monthly
  ) {
    return {
      kind: "MONTHLY",
      ceiling: ceilings.monthly,
      requested: insurerShare,
      remaining: Math.max(0, ceilings.monthly - consumed.month),
    }
  }

  if (
    ceilings.annual !== null &&
    consumed.year + insurerShare > ceilings.annual
  ) {
    return {
      kind: "ANNUAL",
      ceiling: ceilings.annual,
      requested: insurerShare,
      remaining: Math.max(0, ceilings.annual - consumed.year),
    }
  }

  return null
}

export const CEILING_LABELS: Record<CeilingBreach["kind"], string> = {
  PER_ACT: "plafond par acte",
  MONTHLY: "plafond mensuel",
  ANNUAL: "plafond annuel",
}

/* ==========================================================================
 * Carence
 * ========================================================================== */

/**
 * Whether the waiting period between two prises en charge in the same category
 * has elapsed.
 *
 * `delai_suspension_optique = 730` is the one real instance: two years between
 * two pairs of glasses. It is a **frequency** rule, not an amount rule — which
 * is why it is checked separately from the ceilings and not folded into them.
 */
export function waitingPeriodElapsed(
  lastIssuedAt: Date | null,
  waitingPeriodDays: number,
  on: Date
): { elapsed: true } | { elapsed: false; nextEligibleOn: Date } {
  if (!lastIssuedAt || waitingPeriodDays <= 0) return { elapsed: true }

  const nextEligibleOn = new Date(lastIssuedAt)
  nextEligibleOn.setDate(nextEligibleOn.getDate() + waitingPeriodDays)

  return on >= nextEligibleOn ? { elapsed: true } : { elapsed: false, nextEligibleOn }
}

/* ==========================================================================
 * Cotisations à jour
 * ========================================================================== */

/**
 * Whether contributions are far enough behind to block issuance.
 *
 * `suspensionDelayDays` comes from the employer's agreement (90 by default).
 * Beyond it, issuance is refused; the reminder threshold is earlier and only
 * warns. Both are the employer's parameters rather than a constant, because
 * the agreements differ.
 */
export function contributionStanding(
  lastPaidThrough: Date | null,
  reminderDelayDays: number,
  suspensionDelayDays: number,
  on: Date
): { state: "CURRENT" | "REMINDER" | "SUSPENDED"; daysBehind: number } {
  if (!lastPaidThrough) {
    // Nothing recorded is not the same as nothing owed. Phase 3 fills this in
    // from the ledger; until then an unknown standing must not block a bon,
    // or the module would refuse every voucher on the day it is switched on.
    return { state: "CURRENT", daysBehind: 0 }
  }

  const daysBehind = Math.floor(
    (on.getTime() - lastPaidThrough.getTime()) / 86_400_000
  )

  if (daysBehind > suspensionDelayDays) return { state: "SUSPENDED", daysBehind }
  if (daysBehind > reminderDelayDays) return { state: "REMINDER", daysBehind }
  return { state: "CURRENT", daysBehind: Math.max(0, daysBehind) }
}
