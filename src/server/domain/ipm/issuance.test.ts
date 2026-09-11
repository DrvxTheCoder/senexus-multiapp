import { describe, expect, it } from "vitest"

import {
  decideIssuance,
  expiryFor,
  formatVoucherNumber,
  LEGACY_MAXIMA,
  parseVoucherNumber,
  VOUCHER_PREFIX,
  type IssuanceFacts,
  type RefusalCode,
} from "@/server/domain/ipm/issuance"

const ON = new Date(2026, 8, 11)

function facts(overrides: Partial<IssuanceFacts> = {}): IssuanceFacts {
  return {
    on: ON,
    memberStatus: "ACTIVE",
    dependent: null,
    reminderDelayDays: 15,
    suspensionDelayDays: 90,
    contributionsPaidThrough: new Date(2026, 8, 1),
    provider: { accredited: true, status: "ACTIVE", hasLiveAgreement: true },
    rate: 0.8,
    totalAmount: 10_000,
    ceilings: { perAct: null, monthly: null, annual: null },
    consumed: { month: 0, year: 0 },
    waitingPeriodDays: 0,
    lastIssuedInCategory: null,
    ...overrides,
  }
}

const codes = (decision: ReturnType<typeof decideIssuance>): RefusalCode[] =>
  decision.allowed ? [] : decision.refusals.map((refusal) => refusal.code)

describe("decideIssuance — the happy path", () => {
  it("allows a clean bon and computes the split", () => {
    const decision = decideIssuance(facts())
    expect(decision.allowed).toBe(true)
    if (decision.allowed) {
      expect(decision.split).toMatchObject({
        insurerShare: 8_000,
        memberShare: 2_000,
      })
      expect(decision.warnings).toEqual([])
    }
  })
})

describe("decideIssuance — participant", () => {
  it("refuses a radiated participant", () => {
    expect(codes(decideIssuance(facts({ memberStatus: "TERMINATED" })))).toContain(
      "MEMBER_TERMINATED"
    )
  })

  it("refuses a suspended participant, and says which", () => {
    const decision = decideIssuance(facts({ memberStatus: "SUSPENDED" }))
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) {
      expect(decision.refusals[0].message).toContain("suspendu")
    }
  })

  it("refuses an affiliation that has not taken effect", () => {
    expect(codes(decideIssuance(facts({ memberStatus: "PENDING" })))).toContain(
      "MEMBER_NOT_ACTIVE"
    )
  })
})

describe("decideIssuance — ayant droit", () => {
  const dependent = {
    memberStatus: "ACTIVE" as const,
    relation: "CHILD" as const,
    dependentStatus: "ACTIVE" as const,
    coverageStart: new Date(2020, 0, 1),
    coverageEnd: null,
    birthDate: new Date(2015, 0, 1),
    ageMajority: 21,
  }

  it("allows a covered child", () => {
    expect(decideIssuance(facts({ dependent })).allowed).toBe(true)
  })

  it("refuses a child past the age of majority, in words", () => {
    const decision = decideIssuance(
      facts({ dependent: { ...dependent, birthDate: new Date(2000, 0, 1) } })
    )
    expect(codes(decision)).toContain("DEPENDENT_NOT_COVERED")
    if (!decision.allowed) {
      expect(decision.refusals[0].message).toContain("âge")
    }
  })
})

describe("decideIssuance — cotisations", () => {
  it("refuses past the suspension delay and says how far behind", () => {
    const decision = decideIssuance(
      facts({ contributionsPaidThrough: new Date(2026, 2, 1) })
    )
    expect(codes(decision)).toContain("CONTRIBUTIONS_SUSPENDED")
    if (!decision.allowed) {
      const refusal = decision.refusals.find(
        (entry) => entry.code === "CONTRIBUTIONS_SUSPENDED"
      )
      expect(refusal?.detail?.daysBehind).toBeGreaterThan(90)
    }
  })

  it("warns but allows inside the suspension delay", () => {
    const decision = decideIssuance(
      facts({ contributionsPaidThrough: new Date(2026, 7, 1) })
    )
    expect(decision.allowed).toBe(true)
    if (decision.allowed) {
      expect(decision.warnings.map((w) => w.code)).toContain("CONTRIBUTIONS_LATE")
    }
  })

  it("does not refuse when the standing is unknown", () => {
    // The ledger is phase 3. An unknown standing must not block every bon on
    // the day the module is switched on.
    expect(
      decideIssuance(facts({ contributionsPaidThrough: null })).allowed
    ).toBe(true)
  })
})

describe("decideIssuance — prestataire", () => {
  it("refuses a provider that is not agréé", () => {
    expect(
      codes(
        decideIssuance(
          facts({
            provider: { accredited: false, status: "ACTIVE", hasLiveAgreement: true },
          })
        )
      )
    ).toContain("PROVIDER_NOT_ACCREDITED")
  })

  it("refuses an inactive provider", () => {
    expect(
      codes(
        decideIssuance(
          facts({
            provider: { accredited: true, status: "SUSPENDED", hasLiveAgreement: true },
          })
        )
      )
    ).toContain("PROVIDER_INACTIVE")
  })

  it("only warns when an agréé provider has no convention on file", () => {
    // All 101 legacy providers have no agreement dates. Refusing on that alone
    // would block every bon on day one.
    const decision = decideIssuance(
      facts({
        provider: { accredited: true, status: "ACTIVE", hasLiveAgreement: false },
      })
    )
    expect(decision.allowed).toBe(true)
    if (decision.allowed) {
      expect(decision.warnings.map((w) => w.code)).toContain("AGREEMENT_EXPIRED")
    }
  })
})

describe("decideIssuance — barème, carence, plafonds", () => {
  it("refuses when no barème covers the category", () => {
    expect(codes(decideIssuance(facts({ rate: null })))).toContain("NO_RATE")
  })

  it("computes nothing when there is no rate", () => {
    const decision = decideIssuance(facts({ rate: null }))
    expect(decision.allowed).toBe(false)
  })

  it("refuses inside the carence and gives the eligible date", () => {
    const decision = decideIssuance(
      facts({
        waitingPeriodDays: 730,
        lastIssuedInCategory: new Date(2025, 8, 11),
      })
    )
    expect(codes(decision)).toContain("WAITING_PERIOD")
    if (!decision.allowed) {
      const refusal = decision.refusals.find((r) => r.code === "WAITING_PERIOD")
      expect(refusal?.detail?.nextEligibleOn).toEqual(new Date(2027, 8, 11))
      expect(refusal?.message).toContain("11/09/2027")
    }
  })

  it("refuses over a ceiling and says what is left", () => {
    const decision = decideIssuance(
      facts({
        totalAmount: 100_000,
        ceilings: { perAct: null, monthly: null, annual: 50_000 },
        consumed: { month: 0, year: 30_000 },
      })
    )
    expect(codes(decision)).toContain("CEILING_REACHED")
    if (!decision.allowed) {
      const refusal = decision.refusals.find((r) => r.code === "CEILING_REACHED")
      expect(refusal?.detail?.remaining).toBe(20_000)
      // fr-FR groups with a narrow no-break space (U+202F), not U+0020, so
      // the assertion normalises whitespace rather than hard-coding either.
      expect(refusal?.message.replace(/\s/g, " ")).toContain("20 000 FCFA")
    }
  })

  it("says «épuisé» rather than «il reste 0»", () => {
    const decision = decideIssuance(
      facts({
        ceilings: { perAct: null, monthly: null, annual: 50_000 },
        consumed: { month: 0, year: 50_000 },
      })
    )
    if (!decision.allowed) {
      const refusal = decision.refusals.find((r) => r.code === "CEILING_REACHED")
      expect(refusal?.message).toContain("épuisé")
    }
  })
})

describe("decideIssuance — every reason, not the first", () => {
  it("reports all the refusals in one pass", () => {
    // Otherwise the counter iterates: fix the cotisation, resubmit, discover
    // the carence, fix that, discover the plafond.
    const decision = decideIssuance(
      facts({
        memberStatus: "SUSPENDED",
        contributionsPaidThrough: new Date(2025, 0, 1),
        provider: { accredited: false, status: "TERMINATED", hasLiveAgreement: false },
        waitingPeriodDays: 730,
        lastIssuedInCategory: new Date(2026, 0, 1),
      })
    )

    const found = codes(decision)
    expect(found).toContain("MEMBER_NOT_ACTIVE")
    expect(found).toContain("CONTRIBUTIONS_SUSPENDED")
    expect(found).toContain("PROVIDER_INACTIVE")
    expect(found).toContain("PROVIDER_NOT_ACCREDITED")
    expect(found).toContain("WAITING_PERIOD")
    expect(found.length).toBeGreaterThanOrEqual(5)
  })

  it("gives every refusal a message somebody can act on", () => {
    const decision = decideIssuance(
      facts({ memberStatus: "TERMINATED", rate: null })
    )
    if (!decision.allowed) {
      for (const refusal of decision.refusals) {
        expect(refusal.message.length).toBeGreaterThan(10)
      }
    }
  })
})

describe("voucher numbering", () => {
  it("uses the legacy prefixes", () => {
    expect(VOUCHER_PREFIX).toEqual({
      PHARMACY: "BPI",
      OPTICAL: "BCI",
      GUARANTEE: "LGI",
      HOSPITALIZATION: "LHI",
    })
  })

  it("formats six digits", () => {
    expect(formatVoucherNumber("PHARMACY", 5_431)).toBe("BPI005431")
    expect(formatVoucherNumber("GUARANTEE", 9_311)).toBe("LGI009311")
  })

  it("round-trips", () => {
    for (const type of ["PHARMACY", "OPTICAL", "GUARANTEE", "HOSPITALIZATION"] as const) {
      const formatted = formatVoucherNumber(type, 1_234)
      expect(parseVoucherNumber(formatted)).toEqual({ type, sequence: 1_234 })
    }
  })

  it("rejects anything that is not a voucher number", () => {
    for (const junk of ["", "BPI", "XXX000001", "BPI12345", "BPI0000001"]) {
      expect(parseVoucherNumber(junk)).toBeNull()
    }
  })

  it("starts each series above the documents already in circulation", () => {
    // BPI005430 and LGI009310 exist on paper. Reusing either number would put
    // two different documents into the world with the same reference.
    expect(LEGACY_MAXIMA.PHARMACY).toBe(5_430)
    expect(LEGACY_MAXIMA.GUARANTEE).toBe(9_310)
  })
})

describe("expiry", () => {
  it("gives a prescription a month", () => {
    expect(expiryFor("PHARMACY", new Date(2026, 0, 1))).toEqual(
      new Date(2026, 0, 31)
    )
  })

  it("gives a scheduled episode longer than a prescription", () => {
    const issue = new Date(2026, 0, 1)
    expect(expiryFor("HOSPITALIZATION", issue).getTime()).toBeGreaterThan(
      expiryFor("PHARMACY", issue).getTime()
    )
  })
})
