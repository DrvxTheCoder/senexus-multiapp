import { describe, expect, it } from "vitest"

import {
  INTERIM_CEILING_DAYS,
  computeCeiling,
  renewalWouldBreach,
  unionDays,
} from "@/server/domain/interim-ceiling"

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const NOW = d("2026-09-04")

describe("unionDays", () => {
  it("counts both bounds, so a one-day contract is one day", () => {
    expect(unionDays([{ start: d("2026-01-01"), end: d("2026-01-01") }])).toBe(1)
  })

  it("counts a plain span inclusively", () => {
    expect(unionDays([{ start: d("2026-01-01"), end: d("2026-01-31") }])).toBe(31)
  })

  it("counts overlapping contracts once, not twice", () => {
    // Two 31-day contracts overlapping by 16 days: 46 distinct days, not 62.
    const days = unionDays([
      { start: d("2026-01-01"), end: d("2026-01-31") },
      { start: d("2026-01-16"), end: d("2026-02-15") },
    ])
    expect(days).toBe(46)
  })

  it("merges adjacent contracts without double counting the boundary", () => {
    // Jan (31) then Feb 1 onwards: renewals are typically back to back.
    const days = unionDays([
      { start: d("2026-01-01"), end: d("2026-01-31") },
      { start: d("2026-02-01"), end: d("2026-02-28") },
    ])
    expect(days).toBe(59)
  })

  it("excludes gaps between contracts", () => {
    const days = unionDays([
      { start: d("2026-01-01"), end: d("2026-01-31") },
      { start: d("2026-03-01"), end: d("2026-03-31") },
    ])
    expect(days).toBe(62)
  })

  it("is order independent", () => {
    const periods = [
      { start: d("2026-03-01"), end: d("2026-03-31") },
      { start: d("2026-01-01"), end: d("2026-01-31") },
    ]
    expect(unionDays(periods)).toBe(unionDays([...periods].reverse()))
  })

  it("returns zero for no periods", () => {
    expect(unionDays([])).toBe(0)
  })
})

describe("computeCeiling", () => {
  it("does not apply to a CDI, and says so rather than reporting zero", () => {
    const result = computeCeiling(
      [{ startDate: d("2023-01-01"), endDate: d("2025-01-01"), type: "INTERIM" }],
      "CDI",
      NOW
    )
    expect(result.applicable).toBe(false)
    expect(result.remainingDays).toBe(INTERIM_CEILING_DAYS)
  })

  it.each(["CDD", "STAGE", "PRESTATION"] as const)(
    "does not apply to %s either",
    (type) => {
      expect(computeCeiling([], type, NOW).applicable).toBe(false)
    }
  )

  it("counts only interim periods, ignoring other contract types", () => {
    const result = computeCeiling(
      [
        { startDate: d("2026-01-01"), endDate: d("2026-01-31"), type: "INTERIM" },
        { startDate: d("2026-02-01"), endDate: d("2026-02-28"), type: "CDD" },
      ],
      "INTERIM",
      NOW
    )
    expect(result.usedDays).toBe(31)
  })

  it("separates days worked from days contracted", () => {
    // Started 100 days ago, runs 100 days into the future.
    const start = new Date(NOW.getTime() - 99 * 86_400_000)
    const end = new Date(NOW.getTime() + 100 * 86_400_000)
    const result = computeCeiling(
      [{ startDate: start, endDate: end, type: "INTERIM" }],
      "INTERIM",
      NOW
    )
    expect(result.usedDays).toBe(100)
    expect(result.projectedDays).toBe(200)
    expect(result.remainingDays).toBe(INTERIM_CEILING_DAYS - 100)
  })

  it("shifts tone at 85% and again at the ceiling", () => {
    const ceilingAt = (days: number) =>
      computeCeiling(
        [
          {
            startDate: new Date(NOW.getTime() - (days - 1) * 86_400_000),
            endDate: NOW,
            type: "INTERIM",
          },
        ],
        "INTERIM",
        NOW
      )

    expect(ceilingAt(400).tone).toBe("brand")
    expect(ceilingAt(400).usedDays).toBe(400)
    expect(ceilingAt(621).tone).toBe("signal")
    expect(ceilingAt(730).tone).toBe("alert")
  })

  it("floors remaining days at zero for an employee already over the ceiling", () => {
    const result = computeCeiling(
      [{ startDate: d("2024-01-01"), endDate: NOW, type: "INTERIM" }],
      "INTERIM",
      NOW
    )
    expect(result.usedDays).toBeGreaterThan(INTERIM_CEILING_DAYS)
    expect(result.remainingDays).toBe(0)
  })
})

describe("renewalWouldBreach", () => {
  const ceilingAt = (used: number, projected: number) => ({
    applicable: true,
    usedDays: used,
    projectedDays: projected,
    remainingDays: INTERIM_CEILING_DAYS - used,
    projectedRemainingDays: INTERIM_CEILING_DAYS - projected,
    tone: "brand" as const,
  })

  it("judges the renewal on where it would land, not where the employee stands", () => {
    // 600 days worked, but already contracted to 700. A 90-day renewal breaches
    // even though 600 + 90 is under the ceiling.
    expect(renewalWouldBreach(ceilingAt(600, 700), 90)).toBe(true)
  })

  it("allows a renewal that stays inside the ceiling", () => {
    expect(renewalWouldBreach(ceilingAt(600, 640), 90)).toBe(false)
  })

  it("treats exactly the ceiling as allowed and one day past it as a breach", () => {
    expect(renewalWouldBreach(ceilingAt(600, 640), 90)).toBe(false)
    expect(renewalWouldBreach(ceilingAt(600, 640), 91)).toBe(true)
  })

  it("never blocks a contract type the ceiling does not govern", () => {
    const notApplicable = { ...ceilingAt(0, 0), applicable: false }
    expect(renewalWouldBreach(notApplicable, 10_000)).toBe(false)
  })
})

/**
 * The case that exposed the Contrats tab defect.
 *
 * Omar Mendy's record showed 999 j on its rows and 889 j in its header, both
 * labelled "cumulés". The rows summed whole contract spans naively; the header
 * unions elapsed ranges. These pin the two ways the naive sum was wrong, so
 * nothing reintroduces it.
 */
describe("a naive sum of spans is not the legal cumulation", () => {
  const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`)
  const span = (start: string, end: string) =>
    Math.round((day(end).getTime() - day(start).getTime()) / 86_400_000) + 1

  // Four back-to-back interim contracts: each end is the next one's start.
  const periods = [
    { startDate: day("2024-04-03"), endDate: day("2024-11-21"), type: "INTERIM" as const },
    { startDate: day("2024-11-21"), endDate: day("2025-06-25"), type: "INTERIM" as const },
    { startDate: day("2025-06-25"), endDate: day("2026-01-19"), type: "INTERIM" as const },
    { startDate: day("2026-01-19"), endDate: day("2026-12-24"), type: "INTERIM" as const },
  ]

  const naiveSum = periods.reduce(
    (total, period) =>
      total +
      span(
        period.startDate.toISOString().slice(0, 10),
        period.endDate.toISOString().slice(0, 10)
      ),
    0
  )

  it("double-counts the day shared by two adjacent contracts", () => {
    // Every contract fully in the past: the only difference left is the three
    // boundary days the naive sum counts twice.
    const after = day("2027-01-01")
    const ceiling = computeCeiling(periods, "INTERIM", after)

    expect(naiveSum - ceiling.usedDays).toBe(3)
  })

  it("counts days not yet worked, which the legal figure does not", () => {
    // Mid-way through the last contract.
    const today = day("2026-09-08")
    const ceiling = computeCeiling(periods, "INTERIM", today)

    expect(ceiling.usedDays).toBeLessThan(ceiling.projectedDays)
    // 107 days still to run on the final contract, plus the 3 boundary days.
    expect(naiveSum - ceiling.usedDays).toBe(110)
  })

  it("still reports the ceiling as breached, which is what matters", () => {
    const ceiling = computeCeiling(periods, "INTERIM", day("2026-09-08"))
    expect(ceiling.usedDays).toBeGreaterThan(INTERIM_CEILING_DAYS)
    expect(ceiling.tone).toBe("alert")
    expect(ceiling.remainingDays).toBe(0)
  })
})
