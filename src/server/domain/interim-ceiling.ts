import "server-only"

import type { ContractType } from "@prisma/client"

/**
 * §6 — the 730-day interim ceiling.
 *
 * Senegalese labour law caps cumulative interim employment at 730 days **per
 * employer**. Beyond it the relationship is requalifiable as a CDI.
 *
 * This file is the only place the rule is expressed. The legacy application
 * computed it as calendar time since `Employee.hireDate`, which ignored
 * contract history, contract type and every gap between contracts; that is
 * abandoned. See docs/OPEN_QUESTIONS.md Q2 and Q3 for the decisions encoded
 * here, each of which is one edit away from being changed.
 */

export const INTERIM_CEILING_DAYS = 730

/** The band at which the meter turns ochre. 85% of the ceiling. */
export const INTERIM_WARNING_DAYS = Math.round(INTERIM_CEILING_DAYS * 0.85)

/**
 * Only interim employment accumulates against the ceiling (Q3). Everything
 * else renders "non applicable" rather than a zeroed meter, because a zero
 * reads as "plenty of room left" — a different and misleading claim.
 */
export const CEILING_CONTRACT_TYPES: readonly ContractType[] = ["INTERIM"]

export function countsTowardCeiling(type: ContractType): boolean {
  return CEILING_CONTRACT_TYPES.includes(type)
}

export type CeilingPeriod = {
  startDate: Date
  endDate: Date | null
  type: ContractType
}

export type CeilingResult = {
  /** False for CDI, CDD, STAGE, PRESTATION: render "non applicable". */
  applicable: boolean
  /** Days already worked. What the InterimMeter displays. */
  usedDays: number
  /** Days worked plus contracted runway. What the renewal pre-flight tests. */
  projectedDays: number
  /** Ceiling minus usedDays, floored at zero. */
  remainingDays: number
  /** Ceiling minus projectedDays. Negative when a renewal would breach. */
  projectedRemainingDays: number
  tone: "brand" | "signal" | "alert"
}

const DAY = 86_400_000

function toUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

/**
 * Total distinct days covered by a set of periods.
 *
 * Overlapping contracts are counted **once** (Q2): a naive sum of spans would
 * inflate the total and block renewals that are in fact lawful. Gaps between
 * contracts contribute nothing.
 *
 * Both bounds are inclusive, because a contract running from the 1st to the
 * 1st is one worked day, not zero.
 */
export function unionDays(
  periods: { start: Date; end: Date }[]
): number {
  if (periods.length === 0) return 0

  const ranges = periods
    .map(({ start, end }) => ({ start: toUtcDay(start), end: toUtcDay(end) }))
    .filter((range) => range.end >= range.start)
    .sort((a, b) => a.start - b.start)

  if (ranges.length === 0) return 0

  let total = 0
  let currentStart = ranges[0].start
  let currentEnd = ranges[0].end

  for (let i = 1; i < ranges.length; i += 1) {
    const range = ranges[i]
    // Adjacent days (end + 1 === next start) merge into one run rather than
    // being double counted at the boundary.
    if (range.start <= currentEnd + DAY) {
      currentEnd = Math.max(currentEnd, range.end)
    } else {
      total += (currentEnd - currentStart) / DAY + 1
      currentStart = range.start
      currentEnd = range.end
    }
  }

  total += (currentEnd - currentStart) / DAY + 1
  return total
}

/**
 * Computes the ceiling position for one employee, from that employee's
 * contracts **within a single firm**. The caller is responsible for having
 * scoped the periods to one `firmId`: the ceiling is per employer, and days
 * worked for another group firm do not count (§6).
 *
 * `currentType` decides applicability — an employee currently on a CDI is not
 * subject to the ceiling even if they were interim in the past.
 */
export function computeCeiling(
  periods: CeilingPeriod[],
  currentType: ContractType | null,
  now: Date = new Date()
): CeilingResult {
  const applicable = currentType !== null && countsTowardCeiling(currentType)

  if (!applicable) {
    return {
      applicable: false,
      usedDays: 0,
      projectedDays: 0,
      remainingDays: INTERIM_CEILING_DAYS,
      projectedRemainingDays: INTERIM_CEILING_DAYS,
      tone: "brand",
    }
  }

  const counted = periods.filter((period) => countsTowardCeiling(period.type))

  // An open-ended interim contract should not exist, but the column is
  // nullable, so treat a missing end as "still running".
  const elapsed = counted
    .map((period) => ({
      start: period.startDate,
      end: period.endDate && period.endDate < now ? period.endDate : now,
    }))
    .filter((range) => range.start <= range.end)

  const contracted = counted.map((period) => ({
    start: period.startDate,
    end: period.endDate ?? now,
  }))

  const usedDays = unionDays(elapsed)
  const projectedDays = Math.max(usedDays, unionDays(contracted))

  return {
    applicable: true,
    usedDays,
    projectedDays,
    remainingDays: Math.max(0, INTERIM_CEILING_DAYS - usedDays),
    projectedRemainingDays: INTERIM_CEILING_DAYS - projectedDays,
    tone: toneFor(usedDays),
  }
}

export function toneFor(usedDays: number): "brand" | "signal" | "alert" {
  if (usedDays >= INTERIM_CEILING_DAYS) return "alert"
  if (usedDays >= INTERIM_WARNING_DAYS) return "signal"
  return "brand"
}

/**
 * Whether a proposed renewal would cross the ceiling — the pre-flight check
 * §6 requires before a bulk renewal executes. Answered from `projectedDays`,
 * not `usedDays`: a renewal is judged on where it would land, not where the
 * employee stands today.
 */
export function renewalWouldBreach(
  ceiling: CeilingResult,
  additionalDays: number
): boolean {
  if (!ceiling.applicable) return false
  return ceiling.projectedDays + additionalDays > INTERIM_CEILING_DAYS
}
