import { describe, expect, it } from "vitest"

import {
  ageOn,
  beneficiaryTypeFor,
  isDependentCovered,
  LEGACY_RELATION_CODES,
  majorityDate,
  relationFromLegacyCode,
  type DependentCoverageInput,
} from "@/server/domain/ipm/coverage"

const ON = new Date(2026, 8, 11) // 11 September 2026

function dependent(
  overrides: Partial<DependentCoverageInput> = {}
): DependentCoverageInput {
  return {
    memberStatus: "ACTIVE",
    relation: "CHILD",
    dependentStatus: "ACTIVE",
    coverageStart: new Date(2020, 0, 1),
    coverageEnd: null,
    birthDate: new Date(2015, 0, 1),
    ageMajority: 21,
    ...overrides,
  }
}

describe("ageOn", () => {
  it("counts completed years", () => {
    expect(ageOn(new Date(2000, 8, 11), ON)).toBe(26)
  })

  it("does not count a birthday that has not happened yet this year", () => {
    expect(ageOn(new Date(2000, 8, 12), ON)).toBe(25)
  })

  it("counts the birthday itself", () => {
    expect(ageOn(new Date(2005, 8, 11), ON)).toBe(21)
  })

  it("is exact across a leap year rather than dividing by 365.25", () => {
    // Born 29 February; on 28 February the birthday has not arrived.
    expect(ageOn(new Date(2004, 1, 29), new Date(2026, 1, 28))).toBe(21)
    expect(ageOn(new Date(2004, 1, 29), new Date(2026, 2, 1))).toBe(22)
  })
})

describe("isDependentCovered", () => {
  it("covers an active child under the age of majority", () => {
    expect(isDependentCovered(dependent(), ON).covered).toBe(true)
  })

  it("refuses when the participant is not active", () => {
    const result = isDependentCovered(
      dependent({ memberStatus: "SUSPENDED" }),
      ON
    )
    expect(result).toMatchObject({ covered: false, reason: "MEMBER_NOT_ACTIVE" })
  })

  it("refuses before the coverage window opens", () => {
    const result = isDependentCovered(
      dependent({ coverageStart: new Date(2027, 0, 1) }),
      ON
    )
    expect(result).toMatchObject({ covered: false, reason: "COVERAGE_NOT_STARTED" })
  })

  it("refuses after it closes", () => {
    const result = isDependentCovered(
      dependent({ coverageEnd: new Date(2026, 0, 1) }),
      ON
    )
    expect(result).toMatchObject({ covered: false, reason: "COVERAGE_ENDED" })
  })

  it("ages a child out at the employer's majority, not a hard-coded 21", () => {
    const born = new Date(2004, 0, 1) // 22 on the test date
    expect(
      isDependentCovered(dependent({ birthDate: born, ageMajority: 21 }), ON)
    ).toMatchObject({ covered: false, reason: "AGE_LIMIT_REACHED" })

    // The same child, under an employer whose agreement says 22... is still out
    // at 22, but a 21-year-old would be covered:
    const justUnder = new Date(2005, 0, 1)
    expect(
      isDependentCovered(
        dependent({ birthDate: justUnder, ageMajority: 21 }),
        ON
      ).covered
    ).toBe(false)
    expect(
      isDependentCovered(
        dependent({ birthDate: justUnder, ageMajority: 22 }),
        ON
      ).covered
    ).toBe(true)
  })

  it("applies the age limit to children only", () => {
    const old = new Date(1950, 0, 1)
    expect(
      isDependentCovered(
        dependent({ relation: "ASCENDANT", birthDate: old }),
        ON
      ).covered
    ).toBe(true)
    expect(
      isDependentCovered(
        dependent({ relation: "SPOUSE_F", birthDate: old }),
        ON
      ).covered
    ).toBe(true)
  })

  it("does not age out a child whose birth date is missing", () => {
    // The legacy export has gaps. Refusing cover on an absent field would deny
    // a real person at the counter; the import reports them instead.
    expect(
      isDependentCovered(dependent({ birthDate: null }), ON).covered
    ).toBe(true)
  })

  it("carries a readable reason with every refusal", () => {
    const result = isDependentCovered(
      dependent({ dependentStatus: "TERMINATED" }),
      ON
    )
    expect(result.covered).toBe(false)
    if (!result.covered) expect(result.message.length).toBeGreaterThan(0)
  })
})

describe("majorityDate", () => {
  it("is the child's birthday at the majority age", () => {
    expect(majorityDate("CHILD", new Date(2015, 5, 20), 21)).toEqual(
      new Date(2036, 5, 20)
    )
  })

  it("does not apply to anyone else", () => {
    expect(majorityDate("SPOUSE_F", new Date(1990, 0, 1), 21)).toBeNull()
    expect(majorityDate("CHILD", null, 21)).toBeNull()
  })
})

describe("legacy codebenef mapping", () => {
  it("round-trips every relation", () => {
    for (const [relation, code] of Object.entries(LEGACY_RELATION_CODES)) {
      expect(relationFromLegacyCode(code)).toBe(relation)
    }
  })

  it("returns null for a code that is not a dependent", () => {
    // 1 is the participant themselves, not an ayant droit.
    expect(relationFromLegacyCode(1)).toBeNull()
    expect(relationFromLegacyCode(99)).toBeNull()
  })

  it("maps a relation onto the beneficiary type a barème matches", () => {
    expect(beneficiaryTypeFor("CHILD")).toBe("CHILD")
    expect(beneficiaryTypeFor("SPOUSE_F")).toBe("SPOUSE_F")
  })
})
