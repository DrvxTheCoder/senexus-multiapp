import { describe, expect, it } from "vitest"

import {
  formatRate,
  fromPercent,
  RateNotFoundError,
  resolveRate,
  toPercent,
  tryResolveRate,
  type RateRow,
} from "@/server/domain/ipm/rates"

/**
 * The resolution order decides what the institution pays. These tests pin it,
 * and pin the one behaviour that is easy to "fix" into a bug: a miss must
 * throw, never fall back to a default.
 */

const PHARMACIE = "cat-pharmacie"
const OPTIQUE = "cat-optique"

function rate(overrides: Partial<RateRow> = {}): RateRow {
  return {
    categoryId: PHARMACIE,
    beneficiaryType: "ALL",
    rate: 0.8,
    ceilingPerAct: null,
    ceilingMonthly: null,
    ceilingAnnual: null,
    waitingPeriodDays: 0,
    ...overrides,
  }
}

const base = {
  categoryId: PHARMACIE,
  categoryCode: "PHARMACIE",
  beneficiaryType: "CHILD" as const,
}

describe("resolveRate — order of priority", () => {
  it("prefers the employer dérogation for the exact beneficiary type", () => {
    const resolved = resolveRate({
      ...base,
      employerRates: [
        rate({ beneficiaryType: "CHILD", rate: 0.5 }),
        rate({ beneficiaryType: "ALL", rate: 0.6 }),
      ],
      planRates: [rate({ beneficiaryType: "CHILD", rate: 0.9 })],
    })

    expect(resolved.rate).toBe(0.5)
    expect(resolved.source).toBe("EMPLOYER")
    expect(resolved.matchedOn).toBe("CHILD")
  })

  it("falls back to the employer catch-all before touching the formule", () => {
    const resolved = resolveRate({
      ...base,
      employerRates: [rate({ beneficiaryType: "ALL", rate: 0.7 })],
      planRates: [rate({ beneficiaryType: "CHILD", rate: 0.9 })],
    })

    expect(resolved.rate).toBe(0.7)
    expect(resolved.source).toBe("EMPLOYER")
    expect(resolved.matchedOn).toBe("ALL")
  })

  it("uses the formule when the employer has no dérogation", () => {
    const resolved = resolveRate({
      ...base,
      employerRates: [],
      planRates: [rate({ beneficiaryType: "CHILD", rate: 0.9 })],
    })

    expect(resolved.rate).toBe(0.9)
    expect(resolved.source).toBe("PLAN")
  })

  it("ignores rates belonging to another category", () => {
    expect(() =>
      resolveRate({
        ...base,
        employerRates: [rate({ categoryId: OPTIQUE, rate: 0.5 })],
        planRates: [rate({ categoryId: OPTIQUE, rate: 0.9 })],
      })
    ).toThrow(RateNotFoundError)
  })
})

describe("resolveRate — a miss is an error, never a default", () => {
  it("throws rather than returning zero", () => {
    expect(() =>
      resolveRate({ ...base, employerRates: [], planRates: [] })
    ).toThrow(RateNotFoundError)
  })

  it("names the category and the beneficiary in the error", () => {
    try {
      resolveRate({ ...base, employerRates: [], planRates: [] })
      expect.unreachable("resolveRate should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(RateNotFoundError)
      const refusal = error as RateNotFoundError
      expect(refusal.categoryCode).toBe("PHARMACIE")
      expect(refusal.beneficiaryType).toBe("CHILD")
      expect(refusal.message).toContain("PHARMACIE")
    }
  })

  it("tryResolveRate returns null instead, for screens that show non couvert", () => {
    expect(
      tryResolveRate({ ...base, employerRates: [], planRates: [] })
    ).toBeNull()
  })
})

describe("resolveRate — carence", () => {
  it("keeps the formule's carence when the employer rate leaves it unset", () => {
    const resolved = resolveRate({
      ...base,
      employerRates: [
        rate({ beneficiaryType: "ALL", rate: 0.5, waitingPeriodDays: null }),
      ],
      planRates: [rate({ beneficiaryType: "ALL", waitingPeriodDays: 730 })],
    })

    // Not 0: an absent dérogation value means "unchanged", and a zero carence
    // would admit a second pair of glasses the day after the first.
    expect(resolved.waitingPeriodDays).toBe(730)
    expect(resolved.rate).toBe(0.5)
  })

  it("lets an employer override the carence explicitly, including to zero", () => {
    const resolved = resolveRate({
      ...base,
      employerRates: [
        rate({ beneficiaryType: "ALL", rate: 0.5, waitingPeriodDays: 0 }),
      ],
      planRates: [rate({ beneficiaryType: "ALL", waitingPeriodDays: 730 })],
    })

    expect(resolved.waitingPeriodDays).toBe(0)
  })

  it("is zero when neither side says anything", () => {
    const resolved = resolveRate({
      ...base,
      employerRates: [],
      planRates: [rate({ beneficiaryType: "ALL", waitingPeriodDays: null })],
    })

    expect(resolved.waitingPeriodDays).toBe(0)
  })
})

describe("percentage conversion", () => {
  it("round-trips the flyer's rates", () => {
    for (const percent of [100, 90, 85, 80, 70, 50]) {
      expect(toPercent(fromPercent(percent))).toBe(percent)
    }
  })

  it("stores a fraction, never a percentage", () => {
    expect(fromPercent(90)).toBe(0.9)
    expect(fromPercent(82.5)).toBe(0.825)
  })

  it("renders whole percentages without a decimal point", () => {
    expect(formatRate(0.8)).toBe("80 %")
    expect(formatRate(1)).toBe("100 %")
    expect(formatRate(0.825)).toBe("82.5 %")
  })
})

describe("resolveRate — ceilings, field by field", () => {
  const plan = rate({
    beneficiaryType: "ALL",
    ceilingPerAct: 50_000,
    ceilingMonthly: 200_000,
    ceilingAnnual: 1_500_000,
  })

  it("takes every ceiling from the formule when nothing overrides it", () => {
    const resolved = resolveRate({ ...base, employerRates: [], planRates: [plan] })
    expect(resolved.ceilingMonthly).toBe(200_000)
    expect(resolved.ceilingSource).toEqual({ perAct: "PLAN", monthly: "PLAN", annual: "PLAN" })
  })

  it("lets an employer override one ceiling and inherit the others", () => {
    const resolved = resolveRate({
      ...base,
      employerRates: [rate({ rate: 0.7, ceilingMonthly: 300_000 })],
      planRates: [plan],
    })
    // The taux is the employer's whole row; the ceilings are not.
    expect(resolved.rate).toBe(0.7)
    expect(resolved.source).toBe("EMPLOYER")
    expect(resolved.ceilingMonthly).toBe(300_000)
    expect(resolved.ceilingPerAct).toBe(50_000)
    expect(resolved.ceilingAnnual).toBe(1_500_000)
    expect(resolved.ceilingSource).toEqual({ perAct: "PLAN", monthly: "EMPLOYER", annual: "PLAN" })
  })

  it("treats a null employer ceiling as inherit, not as no ceiling", () => {
    const resolved = resolveRate({
      ...base,
      employerRates: [rate({ rate: 0.7 })],
      planRates: [plan],
    })
    expect(resolved.ceilingMonthly).toBe(200_000)
    expect(resolved.ceilingSource.monthly).toBe("PLAN")
  })

  it("prefers the employer's exact type, then its catch-all, per field", () => {
    const resolved = resolveRate({
      ...base,
      employerRates: [
        rate({ beneficiaryType: "CHILD", ceilingPerAct: 10_000 }),
        rate({ beneficiaryType: "ALL", ceilingPerAct: 20_000, ceilingAnnual: 900_000 }),
      ],
      planRates: [plan],
    })
    expect(resolved.ceilingPerAct).toBe(10_000)
    expect(resolved.ceilingAnnual).toBe(900_000)
    expect(resolved.ceilingMonthly).toBe(200_000)
  })

  it("puts the participant's plafond above both, field by field", () => {
    const resolved = resolveRate({
      ...base,
      employerRates: [rate({ ceilingMonthly: 300_000 })],
      planRates: [plan],
      memberCeilings: [
        { categoryId: PHARMACIE, ceilingPerAct: null, ceilingMonthly: 450_000, ceilingAnnual: null },
      ],
    })
    expect(resolved.ceilingMonthly).toBe(450_000)
    expect(resolved.ceilingAnnual).toBe(1_500_000)
    expect(resolved.ceilingSource).toEqual({ perAct: "PLAN", monthly: "MEMBER", annual: "PLAN" })
  })

  it("never gives a participant a taux, only ceilings", () => {
    const resolved = resolveRate({
      ...base,
      employerRates: [],
      planRates: [plan],
      memberCeilings: [
        { categoryId: PHARMACIE, ceilingPerAct: 1, ceilingMonthly: 1, ceilingAnnual: 1 },
      ],
    })
    expect(resolved.rate).toBe(0.8)
    expect(resolved.source).toBe("PLAN")
  })

  it("ignores a participant's plafond in another category", () => {
    const resolved = resolveRate({
      ...base,
      employerRates: [],
      planRates: [plan],
      memberCeilings: [
        { categoryId: OPTIQUE, ceilingPerAct: null, ceilingMonthly: 1, ceilingAnnual: null },
      ],
    })
    expect(resolved.ceilingMonthly).toBe(200_000)
  })

  it("does not cover a category through a participant plafond alone", () => {
    expect(
      tryResolveRate({
        ...base,
        employerRates: [],
        planRates: [],
        memberCeilings: [
          { categoryId: PHARMACIE, ceilingPerAct: null, ceilingMonthly: 1, ceilingAnnual: null },
        ],
      })
    ).toBeNull()
  })

  it("leaves a ceiling null, with no source, when no level sets it", () => {
    const resolved = resolveRate({ ...base, employerRates: [], planRates: [rate()] })
    expect(resolved.ceilingAnnual).toBeNull()
    expect(resolved.ceilingSource.annual).toBeNull()
  })
})
