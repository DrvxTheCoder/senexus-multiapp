import { describe, expect, it } from "vitest"

import {
  FailureLimiter,
  issuePortalToken,
  normalisePhone,
  PORTAL_TOKEN_TTL_SECONDS,
  sameCode,
  verifyPortalToken,
} from "@/server/portal/token"

const SECRET = "test-secret"
const NOW = new Date("2026-10-02T10:00:00Z")

describe("portal token", () => {
  const { token, payload } = issuePortalToken(
    { portalAccountId: "pa_1", firmId: "firm_1" },
    SECRET,
    NOW
  )

  it("round-trips its claims, for 30 days", () => {
    expect(verifyPortalToken(token, SECRET, NOW)).toEqual({ valid: true, payload })
    expect(payload.exp - NOW.getTime() / 1000).toBe(PORTAL_TOKEN_TTL_SECONDS)
    expect(PORTAL_TOKEN_TTL_SECONDS).toBe(30 * 86_400)
  })

  it("refuses another secret", () => {
    expect(verifyPortalToken(token, "other", NOW)).toEqual({
      valid: false,
      reason: "BAD_SIGNATURE",
    })
  })

  it("refuses a payload edited to another account", () => {
    const [, signature] = token.split(".")
    const forged = Buffer.from(
      JSON.stringify({ ...payload, portalAccountId: "pa_2" })
    ).toString("base64url")
    expect(verifyPortalToken(`${forged}.${signature}`, SECRET, NOW).valid).toBe(false)
  })

  it("expires", () => {
    const later = new Date((payload.exp + 1) * 1000)
    expect(verifyPortalToken(token, SECRET, later)).toEqual({
      valid: false,
      reason: "EXPIRED",
    })
  })

  it("calls garbage malformed", () => {
    expect(verifyPortalToken("nope", SECRET, NOW).valid).toBe(false)
    expect(verifyPortalToken("", SECRET, NOW).valid).toBe(false)
  })
})

describe("normalisePhone", () => {
  it("keeps the 9 national digits whatever the participant typed", () => {
    expect(normalisePhone("77 123 45 67")).toBe("771234567")
    expect(normalisePhone("+221 77 123 45 67")).toBe("771234567")
    expect(normalisePhone("00221771234567")).toBe("771234567")
    expect(normalisePhone("221771234567")).toBe("771234567")
    expect(normalisePhone("77.123.45.67")).toBe("771234567")
  })
})

describe("sameCode", () => {
  it("compares exactly", () => {
    expect(sameCode("2026", "2026")).toBe(true)
    expect(sameCode("2026", "2025")).toBe(false)
    expect(sameCode("2026", "20260")).toBe(false)
  })
})

describe("FailureLimiter", () => {
  it("blocks after five failures and lets go after the window", () => {
    const limiter = new FailureLimiter(5, 15 * 60_000)
    const t0 = 1_000_000
    for (let i = 0; i < 4; i += 1) limiter.fail("k", t0 + i)
    expect(limiter.retryAfter("k", t0 + 10)).toBe(0)
    limiter.fail("k", t0 + 5)
    expect(limiter.retryAfter("k", t0 + 10)).toBeGreaterThan(0)
    expect(limiter.retryAfter("other", t0 + 10)).toBe(0)
    expect(limiter.retryAfter("k", t0 + 15 * 60_000 + 10)).toBe(0)
  })

  it("forgets a key on success", () => {
    const limiter = new FailureLimiter(2, 60_000)
    limiter.fail("k", 1)
    limiter.fail("k", 2)
    expect(limiter.retryAfter("k", 3)).toBeGreaterThan(0)
    limiter.clear("k")
    expect(limiter.retryAfter("k", 3)).toBe(0)
  })
})
