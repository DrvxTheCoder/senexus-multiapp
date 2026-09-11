import { describe, expect, it } from "vitest"

import {
  contributionOn,
  currentContribution,
  findOverlaps,
  supersede,
  type ContributionPeriod,
} from "@/server/domain/ipm/contribution"

/**
 * The property that matters: a voucher priced in January must still resolve to
 * January's amount after a March upgrade. A mutable column cannot do that, and
 * these tests are what stops one from being reintroduced as a "simplification".
 */

function period(
  overrides: Partial<ContributionPeriod> & { id: string }
): ContributionPeriod {
  return {
    monthlyAmount: 20_000,
    employerAmount: null,
    employeeAmount: null,
    validFrom: new Date(2026, 0, 1),
    validTo: null,
    planId: null,
    reason: null,
    ...overrides,
  }
}

const JANUARY = period({
  id: "jan",
  monthlyAmount: 20_000,
  validFrom: new Date(2026, 0, 1),
  validTo: new Date(2026, 2, 1),
})

const MARCH = period({
  id: "mar",
  monthlyAmount: 35_000,
  validFrom: new Date(2026, 2, 1),
  validTo: null,
})

const HISTORY = [JANUARY, MARCH]

describe("contributionOn", () => {
  it("prices a January voucher against January, after a March upgrade", () => {
    expect(contributionOn(HISTORY, new Date(2026, 0, 15))?.monthlyAmount).toBe(
      20_000
    )
  })

  it("prices a March voucher against March", () => {
    expect(contributionOn(HISTORY, new Date(2026, 2, 15))?.monthlyAmount).toBe(
      35_000
    )
  })

  it("treats validFrom as inclusive and validTo as exclusive", () => {
    // The changeover day belongs to the new period, not to both.
    expect(contributionOn(HISTORY, new Date(2026, 2, 1))?.id).toBe("mar")
    expect(contributionOn(HISTORY, new Date(2026, 1, 28))?.id).toBe("jan")
  })

  it("ignores the time of day", () => {
    expect(contributionOn(HISTORY, new Date(2026, 2, 1, 23, 59))?.id).toBe("mar")
  })

  it("returns null before the member had any cotisation", () => {
    expect(contributionOn(HISTORY, new Date(2025, 11, 31))).toBeNull()
  })

  it("returns null for a member with no history at all", () => {
    expect(contributionOn([], new Date())).toBeNull()
  })
})

describe("currentContribution", () => {
  it("is the open period", () => {
    expect(currentContribution(HISTORY)?.id).toBe("mar")
  })

  it("is null when every period is closed", () => {
    expect(currentContribution([JANUARY])).toBeNull()
  })
})

describe("supersede", () => {
  it("closes the open period on the new start date", () => {
    const result = supersede([MARCH], new Date(2026, 5, 1))
    expect(result.error).toBeNull()
    expect(result.close).toEqual({ id: "mar", validTo: new Date(2026, 5, 1) })
  })

  it("has nothing to close for a member's first cotisation", () => {
    expect(supersede([], new Date(2026, 0, 1))).toEqual({
      close: null,
      error: null,
    })
  })

  it("refuses to backdate behind the open period's own start", () => {
    // Allowing it would either overlap or erase a period that has already
    // priced vouchers.
    const result = supersede([MARCH], new Date(2026, 1, 1))
    expect(result.close).toBeNull()
    expect(result.error).not.toBeNull()
  })

  it("refuses a new period starting the same day as the open one", () => {
    expect(supersede([MARCH], new Date(2026, 2, 1)).error).not.toBeNull()
  })
})

describe("findOverlaps", () => {
  it("finds nothing in a well-formed history", () => {
    expect(findOverlaps(HISTORY)).toEqual([])
  })

  it("reports a period left open behind a later one", () => {
    const broken = [period({ id: "open", validTo: null }), MARCH]
    expect(findOverlaps(broken)).toHaveLength(1)
  })

  it("reports a period closed after its successor starts", () => {
    const broken = [
      period({ id: "a", validFrom: new Date(2026, 0, 1), validTo: new Date(2026, 5, 1) }),
      period({ id: "b", validFrom: new Date(2026, 2, 1), validTo: null }),
    ]
    expect(findOverlaps(broken)).toHaveLength(1)
  })

  it("accepts two periods that meet exactly", () => {
    expect(findOverlaps([JANUARY, MARCH])).toEqual([])
  })
})
