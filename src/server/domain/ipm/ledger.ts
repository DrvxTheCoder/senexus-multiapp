/**
 * Registre participant — plan §4.8bis, et la réponse à §11 Q9, Q10, Q11, Q13.
 *
 * A write-only register. Nothing is ever updated or deleted: a correction is
 * an ADJUSTMENT or a REVERSAL. That is the only way to get a financial trail
 * that can be defended, and the only way to stop a balance changing
 * retroactively with no explanation.
 *
 * Everything here is pure. The balance is a fold over entries, so the same
 * function answers "what is the balance today", "what was it in March" and
 * "does the cached value still agree with the register".
 */

export type LedgerType =
  | "OPENING"
  | "CONTRIBUTION"
  | "CONSUMPTION"
  | "ADJUSTMENT"
  | "REVERSAL"

export type LedgerEntry = {
  id: string
  periodYear: number
  periodMonth: number
  type: LedgerType
  credit: number
  debit: number
  createdAt: Date
}

/**
 * §11 Q9 — what a prise en charge debits.
 *
 * "Is the balance debited by the IPM share alone, or the whole voucher?" The
 * answer was the IPM share: it is the only figure that commits the
 * institution, and the ticket modérateur is the member's own money, which
 * never passed through the IPM's hands. Debiting the total would make every
 * balance overstate what the institution actually carries.
 *
 * Kept as a named setting rather than a hard-coded choice, because the plan
 * asks for it to be configurable — but the default is the answer given.
 */
export type ConsumptionBasis = "INSURER_SHARE" | "TOTAL_AMOUNT"

export const DEFAULT_CONSUMPTION_BASIS: ConsumptionBasis = "INSURER_SHARE"

export function consumptionDebit(
  basis: ConsumptionBasis,
  totalAmount: number,
  insurerShare: number
): number {
  return basis === "TOTAL_AMOUNT" ? totalAmount : insurerShare
}

/**
 * §11 Q10 — annual or perpetual.
 *
 * Both modes exist. `ANNUAL` restarts each exercice from the closing balance
 * of the previous one as a fresh OPENING; `PERPETUAL` never restarts. The
 * difference is not cosmetic: under ANNUAL a member's consumption history
 * stops offsetting their cotisations after twelve months.
 */
export type BalanceMode = "PERPETUAL" | "ANNUAL"

export const DEFAULT_BALANCE_MODE: BalanceMode = "PERPETUAL"

/* ==========================================================================
 * Le solde
 * ========================================================================== */

/**
 * Folds a register into a balance.
 *
 * Credits raise it (cotisations), debits lower it (prises en charge), so a
 * **positive** balance means the participant has contributed more than they
 * have consumed. That sign convention is stated here because it is the one
 * thing every reader of a statement has to know, and getting it backwards
 * inverts every figure on the direction's report.
 */
export function balanceOf(entries: readonly LedgerEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.credit - entry.debit, 0)
}

/** The balance as it stood at the end of a given month. */
export function balanceAt(
  entries: readonly LedgerEntry[],
  year: number,
  month: number
): number {
  return balanceOf(
    entries.filter(
      (entry) =>
        entry.periodYear < year ||
        (entry.periodYear === year && entry.periodMonth <= month)
    )
  )
}

/**
 * Recomputes `balanceAfter` for a whole register, in order.
 *
 * The stored running balance is a cache. This is what rebuilds it, and what a
 * coherence check compares against — a cache nobody can rebuild is a
 * liability, not an optimisation.
 */
export function withRunningBalance<T extends LedgerEntry>(
  entries: readonly T[]
): (T & { balanceAfter: number })[] {
  const ordered = [...entries].sort(
    (a, b) =>
      a.periodYear - b.periodYear ||
      a.periodMonth - b.periodMonth ||
      a.createdAt.getTime() - b.createdAt.getTime()
  )

  let running = 0
  return ordered.map((entry) => {
    running += entry.credit - entry.debit
    return { ...entry, balanceAfter: running }
  })
}

/* ==========================================================================
 * Solde d'ouverture — §11 Q11
 * ========================================================================== */

export type OpeningState =
  | { status: "SET"; amount: number }
  /** No OPENING entry. The balance is computable but **incomplete**. */
  | { status: "MISSING" }

/**
 * Whether a member's register has been opened.
 *
 * §9 is explicit that a register opened without a solde initial makes every
 * balance computed after the switchover wrong. Q11 — whether that figure comes
 * from replaying the history or from a validated cut-off — is not answered, so
 * nothing here invents one.
 *
 * What this does instead is make the absence **visible**: a member with no
 * OPENING entry is reported as incomplete rather than silently treated as
 * starting from zero, because a confident wrong number is worse than a
 * flagged unknown. The figure itself is supplied by the institution, once,
 * through an audited action.
 */
export function openingState(entries: readonly LedgerEntry[]): OpeningState {
  const opening = entries.find((entry) => entry.type === "OPENING")
  if (!opening) return { status: "MISSING" }
  return { status: "SET", amount: opening.credit - opening.debit }
}

/* ==========================================================================
 * Cohérence
 * ========================================================================== */

export type LedgerIncoherence =
  | { kind: "CACHE_STALE"; cached: number; computed: number }
  | { kind: "RUNNING_BALANCE"; entryId: string; stored: number; computed: number }
  | { kind: "MULTIPLE_OPENINGS"; count: number }
  | { kind: "BOTH_SIDES"; entryId: string }

/**
 * Everything that can be wrong with a register, listed rather than assumed
 * away.
 *
 * This is the counterpart to storing a cached balance: the plan asks for a
 * recompute command and a coherence check, and a check nobody runs is not a
 * check. The statement screen surfaces whatever this returns.
 */
export function findIncoherences(
  entries: readonly (LedgerEntry & { balanceAfter: number })[],
  cachedBalance: number | null
): LedgerIncoherence[] {
  const problems: LedgerIncoherence[] = []

  const openings = entries.filter((entry) => entry.type === "OPENING")
  if (openings.length > 1) {
    problems.push({ kind: "MULTIPLE_OPENINGS", count: openings.length })
  }

  for (const entry of entries) {
    // An entry is a credit or a debit, never both: the two sides exist so the
    // direction of a movement is unambiguous, and filling in both destroys it.
    if (entry.credit > 0 && entry.debit > 0) {
      problems.push({ kind: "BOTH_SIDES", entryId: entry.id })
    }
  }

  const rebuilt = withRunningBalance(entries)
  for (const entry of rebuilt) {
    const stored = entries.find((candidate) => candidate.id === entry.id)
    if (stored && Math.abs(stored.balanceAfter - entry.balanceAfter) > 0.005) {
      problems.push({
        kind: "RUNNING_BALANCE",
        entryId: entry.id,
        stored: stored.balanceAfter,
        computed: entry.balanceAfter,
      })
    }
  }

  const computed = balanceOf(entries)
  if (cachedBalance !== null && Math.abs(cachedBalance - computed) > 0.005) {
    problems.push({ kind: "CACHE_STALE", cached: cachedBalance, computed })
  }

  return problems
}

/* ==========================================================================
 * Réaffiliation — §11 Q13
 * ========================================================================== */

/**
 * What happens to the balance of a participant who is radiated and later
 * re-affiliated: **it resets**.
 *
 * The answer given was that the balance starts again. Expressed as a pair of
 * entries rather than a deletion, so the old register stays readable and the
 * reset is something somebody did on a date: a REVERSAL closing the previous
 * balance to zero, then a fresh OPENING at zero.
 */
export function reaffiliationEntries(
  closingBalance: number,
  on: Date
): { type: LedgerType; credit: number; debit: number; note: string }[] {
  const entries: { type: LedgerType; credit: number; debit: number; note: string }[] =
    []

  if (closingBalance !== 0) {
    entries.push({
      type: "REVERSAL",
      credit: closingBalance < 0 ? -closingBalance : 0,
      debit: closingBalance > 0 ? closingBalance : 0,
      note: "Clôture du solde à la radiation précédente",
    })
  }

  entries.push({
    type: "OPENING",
    credit: 0,
    debit: 0,
    note: `Réaffiliation du ${on.toLocaleDateString("fr-FR")} — solde repris à zéro`,
  })

  return entries
}
