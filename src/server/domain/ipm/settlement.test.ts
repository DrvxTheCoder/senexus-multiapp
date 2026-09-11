import { describe, expect, it } from "vitest"

import {
  checkCeilings,
  contributionStanding,
  lineTotal,
  SettlementError,
  split,
  waitingPeriodElapsed,
} from "@/server/domain/ipm/settlement"

/**
 * The formula the plan verified against 356 settled vouchers. These tests pin
 * the rounding direction above all: it decides who absorbs the residual franc,
 * and it is a one-character edit away from being wrong on half of all bons.
 */

describe("split", () => {
  it("gives the institution the ceiling of the product", () => {
    expect(split(10_000, 0.8)).toEqual({
      totalAmount: 10_000,
      insurerShare: 8_000,
      memberShare: 2_000,
    })
  })

  it("absorbs the residual franc on an odd amount", () => {
    // 8 333.4 → the IPM pays 8 334, the member 1 666. Rounding the other way
    // would move that franc onto the member on roughly half of all vouchers.
    const result = split(10_417, 0.8)
    expect(result.insurerShare).toBe(8_334)
    expect(result.memberShare).toBe(2_083)
  })

  it("always sums back to the total", () => {
    for (const total of [1, 7, 99, 1_234, 10_417, 87_651]) {
      for (const rate of [0.5, 0.7, 0.8, 0.85, 0.9, 1]) {
        const result = split(total, rate)
        expect(result.insurerShare + result.memberShare).toBe(total)
      }
    }
  })

  it("never charges the member more than the arithmetic", () => {
    for (const total of [1, 3, 7, 33, 101, 4_567]) {
      for (const rate of [0.5, 0.7, 0.8, 0.9]) {
        const result = split(total, rate)
        expect(result.memberShare).toBeLessThanOrEqual(total * (1 - rate))
      }
    }
  })

  it("pays everything at 100 %", () => {
    expect(split(12_345, 1)).toMatchObject({
      insurerShare: 12_345,
      memberShare: 0,
    })
  })

  it("pays nothing at 0 %", () => {
    expect(split(12_345, 0)).toMatchObject({
      insurerShare: 0,
      memberShare: 12_345,
    })
  })

  it("handles a zero bill without inventing a share", () => {
    expect(split(0, 0.8)).toMatchObject({ insurerShare: 0, memberShare: 0 })
  })

  it("refuses a negative total", () => {
    expect(() => split(-1, 0.8)).toThrow(SettlementError)
  })

  it("refuses a rate above 1 — the institution cannot pay more than the bill", () => {
    expect(() => split(1_000, 1.2)).toThrow(SettlementError)
    expect(() => split(1_000, -0.1)).toThrow(SettlementError)
  })

  it("refuses a percentage passed where a fraction belongs", () => {
    // The classic mistake: 80 instead of 0.8. It must not silently pay 80×.
    expect(() => split(1_000, 80)).toThrow(SettlementError)
  })
})

describe("lineTotal", () => {
  it("sums quantity × unit price", () => {
    expect(
      lineTotal([
        { quantity: 2, unitPrice: 1_500 },
        { quantity: 1, unitPrice: 4_250 },
      ])
    ).toBe(7_250)
  })

  it("is zero for no lines", () => {
    expect(lineTotal([])).toBe(0)
  })

  it("rounds each line to the franc", () => {
    expect(lineTotal([{ quantity: 1.5, unitPrice: 1_001 }])).toBe(1_502)
  })
})

describe("checkCeilings", () => {
  const none = { perAct: null, monthly: null, annual: null }
  const fresh = { month: 0, year: 0 }

  it("passes when nothing is capped", () => {
    expect(checkCeilings(50_000, none, fresh)).toBeNull()
  })

  it("catches a per-act breach", () => {
    expect(checkCeilings(30_000, { ...none, perAct: 25_000 }, fresh)).toMatchObject({
      kind: "PER_ACT",
      ceiling: 25_000,
      remaining: 25_000,
    })
  })

  it("counts what is already consumed this month", () => {
    const breach = checkCeilings(
      10_000,
      { ...none, monthly: 30_000 },
      { month: 25_000, year: 25_000 }
    )
    expect(breach).toMatchObject({ kind: "MONTHLY", remaining: 5_000 })
  })

  it("allows a claim that exactly reaches the ceiling", () => {
    expect(
      checkCeilings(5_000, { ...none, monthly: 30_000 }, { month: 25_000, year: 0 })
    ).toBeNull()
  })

  it("reports zero remaining on an exhausted ceiling", () => {
    const breach = checkCeilings(
      1,
      { ...none, annual: 100_000 },
      { month: 0, year: 120_000 }
    )
    expect(breach).toMatchObject({ kind: "ANNUAL", remaining: 0 })
  })

  it("checks per-act before the periodic ceilings", () => {
    // The most specific refusal is the most useful one at the counter.
    const breach = checkCeilings(
      80_000,
      { perAct: 25_000, monthly: 30_000, annual: 40_000 },
      fresh
    )
    expect(breach?.kind).toBe("PER_ACT")
  })

  it("treats a null ceiling as unlimited, which is how 1e12 is imported", () => {
    expect(
      checkCeilings(999_999_999, none, { month: 999_999, year: 999_999 })
    ).toBeNull()
  })
})

describe("waitingPeriodElapsed", () => {
  const ON = new Date(2026, 8, 11)

  it("passes when there is no previous prise en charge", () => {
    expect(waitingPeriodElapsed(null, 730, ON)).toEqual({ elapsed: true })
  })

  it("passes when the category has no carence", () => {
    expect(waitingPeriodElapsed(new Date(2026, 8, 10), 0, ON)).toEqual({
      elapsed: true,
    })
  })

  it("refuses a second pair of glasses inside the two years", () => {
    const result = waitingPeriodElapsed(new Date(2025, 8, 11), 730, ON)
    expect(result.elapsed).toBe(false)
    if (!result.elapsed) {
      expect(result.nextEligibleOn).toEqual(new Date(2027, 8, 11))
    }
  })

  it("allows it once the delay has passed", () => {
    expect(
      waitingPeriodElapsed(new Date(2024, 8, 10), 730, ON).elapsed
    ).toBe(true)
  })

  it("treats the eligibility date itself as elapsed", () => {
    const last = new Date(2024, 8, 12)
    const eligible = new Date(last)
    eligible.setDate(eligible.getDate() + 730)
    expect(waitingPeriodElapsed(last, 730, eligible).elapsed).toBe(true)
  })
})

describe("contributionStanding", () => {
  const ON = new Date(2026, 8, 11)

  it("does not block when nothing is recorded", () => {
    // The ledger arrives in phase 3. Until then an unknown standing must not
    // refuse every bon on the day the module is switched on.
    expect(contributionStanding(null, 15, 90, ON)).toEqual({
      state: "CURRENT",
      daysBehind: 0,
    })
  })

  it("is current when paid up", () => {
    expect(contributionStanding(new Date(2026, 8, 1), 15, 90, ON).state).toBe(
      "CURRENT"
    )
  })

  it("warns past the reminder delay", () => {
    expect(contributionStanding(new Date(2026, 7, 1), 15, 90, ON).state).toBe(
      "REMINDER"
    )
  })

  it("suspends past the suspension delay", () => {
    const result = contributionStanding(new Date(2026, 3, 1), 15, 90, ON)
    expect(result.state).toBe("SUSPENDED")
    expect(result.daysBehind).toBeGreaterThan(90)
  })

  it("uses the employer's own delays, not a constant", () => {
    const behind = new Date(2026, 6, 1) // ~72 days
    expect(contributionStanding(behind, 15, 90, ON).state).toBe("REMINDER")
    expect(contributionStanding(behind, 5, 30, ON).state).toBe("SUSPENDED")
  })
})
