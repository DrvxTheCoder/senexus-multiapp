import { describe, expect, it } from "vitest"

import {
  amountRequiredFor,
  AmountPolicyError,
  assertAmountPolicy,
  counts,
  decideDeferredIssuance,
  decideAdjustment,
  decideBackOfficeValidation,
  decideProviderValidation,
  decideVoid,
  effectiveStatus,
  deferredSplit,
  isValidAmount,
  ledgerCorrection,
  monthBounds,
  monthOf,
  participantMayCancel,
  remainingEnvelope,
  validationDeadline,
  validationFlags,
  type VoucherAmountState,
} from "@/server/domain/ipm/deferred-amount"
import type { IssuanceFacts } from "@/server/domain/ipm/issuance"

const NONE = { perAct: null, monthly: null, annual: null }
const ZERO = { month: 0, year: 0 }

describe("amount policy", () => {
  it("lets only a pharmacy bon go without an amount", () => {
    expect(amountRequiredFor("PHARMACY")).toBe(false)
    expect(amountRequiredFor("OPTICAL")).toBe(true)
    expect(amountRequiredFor("GUARANTEE")).toBe(true)
    expect(amountRequiredFor("HOSPITALIZATION")).toBe(true)
  })

  it("refuses a null amount on any other type", () => {
    expect(() => assertAmountPolicy("OPTICAL", null)).toThrow(AmountPolicyError)
    expect(() => assertAmountPolicy("PHARMACY", null)).not.toThrow()
    expect(() => assertAmountPolicy("OPTICAL", 1_000)).not.toThrow()
  })

  it("accepts whole positive francs only", () => {
    expect(isValidAmount(1)).toBe(true)
    expect(isValidAmount(12_500)).toBe(true)
    expect(isValidAmount(0)).toBe(false)
    expect(isValidAmount(-5)).toBe(false)
    expect(isValidAmount(10.5)).toBe(false)
    expect(isValidAmount(Number.NaN)).toBe(false)
    expect(isValidAmount(Number.POSITIVE_INFINITY)).toBe(false)
    expect(isValidAmount("1000")).toBe(false)
    expect(isValidAmount(100_000_001)).toBe(false)
  })
})

describe("remainingEnvelope", () => {
  it("is unlimited when no plafond applies", () => {
    expect(remainingEnvelope(NONE, ZERO)).toBeNull()
  })

  it("takes the tightest of the three", () => {
    expect(
      remainingEnvelope(
        { perAct: 50_000, monthly: 100_000, annual: 1_000_000 },
        { month: 70_000, year: 200_000 }
      )
    ).toBe(30_000)
    expect(
      remainingEnvelope(
        { perAct: 20_000, monthly: 100_000, annual: null },
        { month: 10_000, year: 0 }
      )
    ).toBe(20_000)
    expect(
      remainingEnvelope(
        { perAct: null, monthly: null, annual: 300_000 },
        { month: 0, year: 290_000 }
      )
    ).toBe(10_000)
  })

  it("is zero, never negative, once a plafond is exhausted or overrun", () => {
    expect(
      remainingEnvelope({ perAct: null, monthly: 50_000, annual: null }, { month: 50_000, year: 0 })
    ).toBe(0)
    expect(
      remainingEnvelope({ perAct: null, monthly: 50_000, annual: null }, { month: 65_000, year: 0 })
    ).toBe(0)
  })
})

describe("deferredSplit — taux", () => {
  it.each([
    [0.5, 10_000, 5_000, 5_000],
    [0.7, 10_000, 7_000, 3_000],
    [0.8, 10_000, 8_000, 2_000],
  ])("at %s, %i splits into %i / %i", (rate, amount, insurer, member) => {
    const result = deferredSplit(amount, rate, null)
    expect(result).toMatchObject({
      totalAmount: amount,
      insurerShare: insurer,
      memberShare: member,
      capped: false,
    })
    expect(result.insurerShare + result.memberShare).toBe(amount)
  })

  it.each([
    // The IPM absorbs the odd franc: ceil on its side.
    [0.5, 10_001, 5_001, 5_000],
    [0.7, 12_345, 8_642, 3_703],
    [0.8, 9_999, 8_000, 1_999],
    [0.7, 1, 1, 0],
  ])("rounds in the participant's favour (%s × %i)", (rate, amount, insurer, member) => {
    const result = deferredSplit(amount, rate, null)
    expect(result.insurerShare).toBe(insurer)
    expect(result.memberShare).toBe(member)
  })
})

describe("deferredSplit — enveloppe", () => {
  it("leaves the split alone when the envelope covers it", () => {
    const result = deferredSplit(10_000, 0.8, 8_000)
    expect(result).toMatchObject({ insurerShare: 8_000, memberShare: 2_000, capped: false })
  })

  it("caps the IPM share at what is left, and the participant owes the rest", () => {
    const result = deferredSplit(20_000, 0.8, 5_000)
    expect(result).toMatchObject({
      totalAmount: 20_000,
      insurerShare: 5_000,
      memberShare: 15_000,
      capped: true,
      uncappedInsurerShare: 16_000,
      remaining: 5_000,
    })
  })

  it("leaves everything to the participant when the envelope is exhausted", () => {
    const result = deferredSplit(7_500, 0.7, 0)
    expect(result).toMatchObject({ insurerShare: 0, memberShare: 7_500, capped: true })
  })

  it.each([0.5, 0.7, 0.8])("never makes the shares disagree with the total (%s)", (rate) => {
    for (const amount of [1, 3, 999, 10_001, 123_457]) {
      for (const remaining of [null, 0, 1, 500, 50_000]) {
        const result = deferredSplit(amount, rate, remaining)
        expect(result.insurerShare + result.memberShare).toBe(amount)
        expect(result.insurerShare).toBeGreaterThanOrEqual(0)
        expect(result.memberShare).toBeGreaterThanOrEqual(0)
        if (remaining !== null) expect(result.insurerShare).toBeLessThanOrEqual(remaining)
        expect(Number.isInteger(result.insurerShare)).toBe(true)
      }
    }
  })

  it("does not mark an exact fit as capped", () => {
    expect(deferredSplit(10_000, 0.8, 8_000).capped).toBe(false)
    expect(deferredSplit(10_001, 0.8, 8_000).capped).toBe(true)
  })
})

describe("validationFlags", () => {
  it("flags a capped bon and an amount above the threshold, without blocking", () => {
    expect(validationFlags({ totalAmount: 10_000, capped: false }, null)).toEqual([])
    expect(validationFlags({ totalAmount: 10_000, capped: true }, null)).toEqual(["CEILING_CAPPED"])
    expect(validationFlags({ totalAmount: 60_000, capped: false }, 50_000)).toEqual([
      "AMOUNT_ABOVE_THRESHOLD",
    ])
    expect(validationFlags({ totalAmount: 50_000, capped: false }, 50_000)).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */

const NOW = new Date("2026-10-08T10:00:00Z")

function state(overrides: Partial<VoucherAmountState> = {}): VoucherAmountState {
  return {
    status: "AWAITING_AMOUNT",
    deferredAmount: true,
    providerId: "prov-a",
    expiryDate: new Date("2026-10-15T10:00:00Z"),
    validationKey: null,
    validatedByProviderAccountId: null,
    invoiceStatus: null,
    ...overrides,
  }
}

const caller = { providerId: "prov-a", providerAccountId: "acct-a", key: "key-1", now: NOW }

describe("decideProviderValidation", () => {
  it("validates a waiting bon bound to the caller", () => {
    expect(decideProviderValidation(state(), caller)).toEqual({ kind: "validate" })
  })

  it("refuses another provider's bon before saying anything about it", () => {
    expect(
      decideProviderValidation(state({ status: "SETTLED", providerId: "prov-b" }), caller)
    ).toEqual({ kind: "refuse", code: "WRONG_PROVIDER" })
    expect(decideProviderValidation(state({ providerId: "prov-b" }), caller)).toEqual({
      kind: "refuse",
      code: "WRONG_PROVIDER",
    })
  })

  it("replays a retry with the same key from the same account", () => {
    const validated = state({
      status: "SETTLED",
      validationKey: "key-1",
      validatedByProviderAccountId: "acct-a",
    })
    expect(decideProviderValidation(validated, caller)).toEqual({ kind: "replay" })
    expect(decideProviderValidation({ ...validated, status: "INVOICED" }, caller)).toEqual({
      kind: "replay",
    })
  })

  it("refuses any other second validation as ALREADY_VALIDATED", () => {
    const validated = state({
      status: "SETTLED",
      validationKey: "key-1",
      validatedByProviderAccountId: "acct-a",
    })
    expect(decideProviderValidation(validated, { ...caller, key: "key-2" })).toEqual({
      kind: "refuse",
      code: "ALREADY_VALIDATED",
    })
    // Validated from the back office: no key, so never a replay.
    expect(
      decideProviderValidation(state({ status: "SETTLED" }), caller)
    ).toEqual({ kind: "refuse", code: "ALREADY_VALIDATED" })
  })

  it("never validates an expired or cancelled bon", () => {
    expect(decideProviderValidation(state({ status: "EXPIRED" }), caller)).toEqual({
      kind: "refuse",
      code: "EXPIRED",
    })
    expect(decideProviderValidation(state({ status: "CANCELLED" }), caller)).toEqual({
      kind: "refuse",
      code: "CANCELLED",
    })
  })

  it("treats a bon past its date as expired even before the job ran", () => {
    expect(
      decideProviderValidation(state({ expiryDate: new Date("2026-10-08T09:59:59Z") }), caller)
    ).toEqual({ kind: "refuse", code: "EXPIRED" })
  })

  it("refuses a bon that was not issued without an amount", () => {
    expect(
      decideProviderValidation(state({ deferredAmount: false, status: "ISSUED" }), caller)
    ).toEqual({ kind: "refuse", code: "NOT_DEFERRED" })
  })
})

describe("decideBackOfficeValidation", () => {
  it("bypasses the expiry and the provider binding", () => {
    expect(decideBackOfficeValidation(state({ providerId: "anyone" }))).toEqual({
      kind: "validate",
    })
    expect(decideBackOfficeValidation(state({ status: "EXPIRED" }))).toEqual({
      kind: "validate",
    })
    expect(
      decideBackOfficeValidation(state({ expiryDate: new Date("2020-01-01") }))
    ).toEqual({ kind: "validate" })
  })

  it("does not validate twice nor revive a cancelled bon", () => {
    expect(decideBackOfficeValidation(state({ status: "SETTLED" }))).toMatchObject({
      code: "ALREADY_VALIDATED",
    })
    expect(decideBackOfficeValidation(state({ status: "CANCELLED" }))).toMatchObject({
      code: "CANCELLED",
    })
  })
})

describe("decideAdjustment and decideVoid", () => {
  it("adjusts a validated bon unless its invoice is approved or paid", () => {
    expect(decideAdjustment(state({ status: "SETTLED" }))).toEqual({ kind: "adjust" })
    expect(
      decideAdjustment(state({ status: "INVOICED", invoiceStatus: "CHECKED" }))
    ).toEqual({ kind: "adjust" })
    expect(
      decideAdjustment(state({ status: "INVOICED", invoiceStatus: "RECEIVED" }))
    ).toEqual({ kind: "adjust" })
    expect(
      decideAdjustment(state({ status: "INVOICED", invoiceStatus: "APPROVED" }))
    ).toMatchObject({ code: "INVOICE_LOCKED" })
    expect(
      decideAdjustment(state({ status: "INVOICED", invoiceStatus: "PAID" }))
    ).toMatchObject({ code: "INVOICE_LOCKED" })
  })

  it("does not adjust what was never validated", () => {
    expect(decideAdjustment(state())).toMatchObject({ code: "NOT_VALIDATED" })
    expect(decideAdjustment(state({ status: "CANCELLED" }))).toMatchObject({
      code: "CANCELLED",
    })
  })

  it("voids at any stage short of a locked invoice", () => {
    for (const status of ["AWAITING_AMOUNT", "EXPIRED", "SETTLED", "INVOICED"]) {
      expect(decideVoid(state({ status }))).toEqual({ kind: "void" })
    }
    expect(decideVoid(state({ status: "INVOICED", invoiceStatus: "PAID" }))).toMatchObject({
      code: "INVOICE_LOCKED",
    })
    expect(decideVoid(state({ status: "CANCELLED" }))).toMatchObject({ code: "CANCELLED" })
  })
})

describe("participantMayCancel and counts", () => {
  it("lets the participant withdraw what nobody acted on", () => {
    expect(participantMayCancel("AWAITING_AMOUNT")).toBe(true)
    expect(participantMayCancel("ISSUED")).toBe(true)
    expect(participantMayCancel("SETTLED")).toBe(false)
    expect(participantMayCancel("EXPIRED")).toBe(false)
  })

  it("counts only a validated bon with an amount", () => {
    expect(counts({ status: "SETTLED", totalAmount: 1_000 })).toBe(true)
    expect(counts({ status: "INVOICED", totalAmount: 1_000 })).toBe(true)
    expect(counts({ status: "AWAITING_AMOUNT", totalAmount: null })).toBe(false)
    expect(counts({ status: "EXPIRED", totalAmount: null })).toBe(false)
    expect(counts({ status: "CANCELLED", totalAmount: 1_000 })).toBe(false)
  })
})

describe("dates", () => {
  it("puts the deadline the configured number of days after issue", () => {
    expect(validationDeadline(NOW, 7).toISOString()).toBe("2026-10-15T10:00:00.000Z")
  })

  it("parses a month and refuses anything else", () => {
    expect(monthBounds("2026-10")).toEqual({
      from: new Date("2026-10-01T00:00:00Z"),
      to: new Date("2026-11-01T00:00:00Z"),
    })
    expect(monthBounds("2026-12")?.to).toEqual(new Date("2027-01-01T00:00:00Z"))
    expect(monthBounds("2026-13")).toBeNull()
    expect(monthBounds("26-10")).toBeNull()
    expect(monthOf(NOW)).toBe("2026-10")
  })
})

describe("ledgerCorrection", () => {
  it("posts the first debit as a consumption", () => {
    expect(ledgerCorrection(0, 12_000)).toEqual({ type: "CONSUMPTION", debit: 12_000 })
  })

  it("posts a change as an adjustment for the difference, either way", () => {
    expect(ledgerCorrection(12_000, 15_000)).toEqual({ type: "ADJUSTMENT", debit: 3_000 })
    expect(ledgerCorrection(12_000, 9_000)).toEqual({ type: "ADJUSTMENT", credit: 3_000 })
  })

  it("reverses everything still posted when the bon stops counting", () => {
    expect(ledgerCorrection(12_000, 0)).toEqual({ type: "REVERSAL", credit: 12_000 })
  })

  it("writes nothing when the register already agrees", () => {
    expect(ledgerCorrection(0, 0)).toBeNull()
    expect(ledgerCorrection(8_000, 8_000)).toBeNull()
  })
})

describe("decideDeferredIssuance", () => {
  const base: IssuanceFacts = {
    on: new Date(2026, 9, 8),
    memberStatus: "ACTIVE",
    dependent: null,
    reminderDelayDays: 15,
    suspensionDelayDays: 90,
    contributionsPaidThrough: new Date(2026, 9, 1),
    provider: { accredited: true, status: "ACTIVE", hasLiveAgreement: true },
    rate: 0.8,
    totalAmount: 0,
    ceilings: NONE,
    consumed: ZERO,
    waitingPeriodDays: 0,
    lastIssuedInCategory: null,
  }

  it("allows an eligible beneficiary with no amount at all", () => {
    const decision = decideDeferredIssuance(base)
    expect(decision.allowed).toBe(true)
    if (decision.allowed) expect(decision.split.totalAmount).toBe(0)
  })

  it("still refuses on eligibility: inactive member, no rate, inactive provider", () => {
    expect(decideDeferredIssuance({ ...base, memberStatus: "SUSPENDED" }).allowed).toBe(false)
    expect(decideDeferredIssuance({ ...base, rate: null }).allowed).toBe(false)
    expect(
      decideDeferredIssuance({
        ...base,
        provider: { accredited: false, status: "ACTIVE", hasLiveAgreement: false },
      }).allowed
    ).toBe(false)
  })

  it("ignores whatever amount the facts carry", () => {
    expect(
      decideDeferredIssuance({
        ...base,
        totalAmount: 10_000_000,
        ceilings: { perAct: 1_000, monthly: null, annual: null },
      }).allowed
    ).toBe(true)
  })

  it("refuses when the plafond is already exhausted", () => {
    const decision = decideDeferredIssuance({
      ...base,
      ceilings: { perAct: null, monthly: 50_000, annual: null },
      consumed: { month: 50_000, year: 50_000 },
    })
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) expect(decision.refusals[0]?.code).toBe("CEILING_REACHED")
  })
})

describe("effectiveStatus", () => {
  it("reads a waiting bon past its deadline as expired", () => {
    const deadline = new Date("2026-10-08T10:00:00Z")
    expect(effectiveStatus("AWAITING_AMOUNT", deadline, new Date("2026-10-08T09:00:00Z"))).toBe(
      "AWAITING_AMOUNT"
    )
    expect(effectiveStatus("AWAITING_AMOUNT", deadline, new Date("2026-10-08T11:00:00Z"))).toBe(
      "EXPIRED"
    )
    expect(effectiveStatus("SETTLED", deadline, new Date("2026-12-01"))).toBe("SETTLED")
  })
})
