import { describe, expect, it } from "vitest"

import {
  CATEGORY_CODES,
  categoryForServiceCode,
  DUPLICATE_LABEL_CODES,
  FLYER_PLANS,
  isExplicitlyCategorised,
  MISSING_SERVICE_CODES,
} from "@/server/domain/ipm/referentiel"

describe("categoryForServiceCode", () => {
  it("places the codes the plan names explicitly", () => {
    expect(categoryForServiceCode(0)).toBe("CONSULTATION")
    expect(categoryForServiceCode(43)).toBe("CONSULTATION")
    expect(categoryForServiceCode(6)).toBe("PHARMACIE")
    expect(categoryForServiceCode(22)).toBe("PHARMACIE")
    expect(categoryForServiceCode(4)).toBe("OPTIQUE")
    expect(categoryForServiceCode(13)).toBe("OPTIQUE")
  })

  it("places all seven hospitalisation codes", () => {
    for (const code of [3, 8, 16, 24, 31, 33, 48]) {
      expect(categoryForServiceCode(code)).toBe("HOSPITALISATION")
    }
  })

  it("defaults everything else to soins", () => {
    for (const code of [1, 2, 5, 7, 20, 39, 40, 49]) {
      expect(categoryForServiceCode(code)).toBe("SOINS")
    }
  })

  it("distinguishes a real classification from the default", () => {
    expect(isExplicitlyCategorised(8)).toBe(true)
    expect(isExplicitlyCategorised(7)).toBe(false)
    // So the import can report how many rows took the default rather than
    // burying them in a total.
    expect(categoryForServiceCode(7)).toBe("SOINS")
  })

  it("assigns no code to two categories", () => {
    for (let code = 0; code <= 49; code += 1) {
      const matches = CATEGORY_CODES.filter(
        (category) => categoryForServiceCode(code) === category
      )
      expect(matches).toHaveLength(1)
    }
  })

  it("still answers for the codes the export is known to mangle", () => {
    // 25 is absent and 39/40 share a label. Neither may throw: the import is
    // tolerant by design.
    for (const code of [...MISSING_SERVICE_CODES, ...DUPLICATE_LABEL_CODES]) {
      expect(() => categoryForServiceCode(code)).not.toThrow()
    }
  })
})

describe("FLYER_PLANS", () => {
  it("carries the four formules at the flyer's prices", () => {
    expect(FLYER_PLANS.map((plan) => plan.code)).toEqual([
      "TAWFEIKH",
      "XEWEUL",
      "TERANGA",
      "NOFLAY",
    ])
    expect(FLYER_PLANS.map((plan) => plan.monthlyPrice)).toEqual([
      35_000, 25_000, 20_000, 12_000,
    ])
  })

  it("prices Tawfeikh at 100/90/80", () => {
    expect(FLYER_PLANS[0].rates).toEqual({
      CONSULTATION: 100,
      SOINS: 90,
      PHARMACIE: 80,
    })
  })

  it("guesses no rate for optique or hospitalisation", () => {
    // Their barème is one of the 23 non-exportable pages awaiting manual
    // re-entry. A seeded guess would be indistinguishable from a real rate.
    for (const plan of FLYER_PLANS) {
      expect(plan.rates).not.toHaveProperty("OPTIQUE")
      expect(plan.rates).not.toHaveProperty("HOSPITALISATION")
    }
  })

  it("is ordered from the most generous to the least", () => {
    const prices = FLYER_PLANS.map((plan) => plan.monthlyPrice)
    expect([...prices].sort((a, b) => b - a)).toEqual(prices)
  })
})
