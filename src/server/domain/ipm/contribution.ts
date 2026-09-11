/**
 * Cotisation effective-datée — plan §4.8bis, §11 Q6 et Q12.
 *
 * The answer to "fixed amount, but support upgrades without losing track of the
 * previous cotisation" rules out a mutable column: an UPDATE erases exactly the
 * history being asked for. So a change closes the current row and opens a new
 * one, and a January voucher still prices against January's amount after a
 * March upgrade.
 *
 * Two invariants this file exists to keep:
 *
 *   - periods never overlap, so "the amount on date D" has one answer;
 *   - exactly one row is open (`validTo === null`) per member.
 *
 * Q12: one contribution per family. The amount covers the participant and their
 * ayants droit — it is not multiplied by the number of covered heads.
 */

export type ContributionPeriod = {
  id: string
  monthlyAmount: number
  employerAmount: number | null
  employeeAmount: number | null
  validFrom: Date
  validTo: Date | null
  planId: string | null
  reason: string | null
}

/** Day-precision comparison: cotisations change on a date, not at an instant. */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/**
 * The cotisation in force on `on`, or null if the member had none yet.
 *
 * `validFrom` is inclusive and `validTo` exclusive, so a row closed on the 1st
 * and its successor opened on the 1st produce one answer rather than two.
 */
export function contributionOn(
  periods: readonly ContributionPeriod[],
  on: Date
): ContributionPeriod | null {
  const day = startOfDay(on)
  const matches = periods.filter((period) => {
    if (startOfDay(period.validFrom) > day) return false
    if (period.validTo && startOfDay(period.validTo) <= day) return false
    return true
  })

  if (matches.length === 0) return null

  // More than one match means the history is broken. Return the latest so the
  // interface still renders, and let `findOverlaps` be what reports it.
  return matches.reduce((latest, period) =>
    period.validFrom > latest.validFrom ? period : latest
  )
}

/** The open row, if there is one. */
export function currentContribution(
  periods: readonly ContributionPeriod[]
): ContributionPeriod | null {
  return periods.find((period) => period.validTo === null) ?? null
}

/**
 * Pairs of periods that overlap. Should always be empty — surfaced rather than
 * assumed, the same way the member ledger will need a coherence check.
 */
export function findOverlaps(
  periods: readonly ContributionPeriod[]
): Array<[ContributionPeriod, ContributionPeriod]> {
  const sorted = [...periods].sort(
    (a, b) => a.validFrom.getTime() - b.validFrom.getTime()
  )
  const overlaps: Array<[ContributionPeriod, ContributionPeriod]> = []

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const current = sorted[i]
    const next = sorted[i + 1]
    if (!current.validTo || startOfDay(current.validTo) > startOfDay(next.validFrom)) {
      overlaps.push([current, next])
    }
  }

  return overlaps
}

export type SupersedeResult = {
  /** The row to close, and the date to close it on. */
  close: { id: string; validTo: Date } | null
  error: string | null
}

/**
 * What to do to the existing history before inserting a new period starting on
 * `validFrom`.
 *
 * Backdating behind the open period's own start is refused rather than
 * silently reordered: it would either create an overlap or erase a period that
 * has already priced vouchers.
 */
export function supersede(
  periods: readonly ContributionPeriod[],
  validFrom: Date
): SupersedeResult {
  const open = currentContribution(periods)
  if (!open) return { close: null, error: null }

  if (startOfDay(validFrom) <= startOfDay(open.validFrom)) {
    return {
      close: null,
      error:
        "La nouvelle cotisation doit prendre effet après le début de la cotisation en cours.",
    }
  }

  return { close: { id: open.id, validTo: validFrom }, error: null }
}
