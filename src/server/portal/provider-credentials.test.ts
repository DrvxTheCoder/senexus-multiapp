import { describe, expect, it } from "vitest"

import {
  afterFailedAttempt,
  issueProviderToken,
  lockRemaining,
  LOCKOUT_MS,
  MAX_FAILED_ATTEMPTS,
  normaliseProviderCode,
  passwordProblem,
  PROVIDER_SESSION_TTL_SECONDS,
  temporaryPassword,
  verifyProviderToken,
} from "@/server/portal/provider-credentials"
import { issuePortalToken, verifyPortalToken } from "@/server/portal/token"

const SECRET = "p".repeat(48)
const NOW = new Date("2026-10-08T10:00:00Z")

describe("provider token", () => {
  it("round-trips the session and account", () => {
    const { token } = issueProviderToken({ sessionId: "s1", accountId: "a1" }, SECRET, NOW)
    const verified = verifyProviderToken(token, SECRET, NOW)
    expect(verified).toMatchObject({ valid: true, payload: { sid: "s1", aid: "a1" } })
  })

  it("refuses a tampered, expired or foreign-secret token", () => {
    const { token } = issueProviderToken({ sessionId: "s1", accountId: "a1" }, SECRET, NOW)
    const [body, sig] = token.split(".")
    const forged = Buffer.from(JSON.stringify({ sid: "s2", aid: "a1", exp: 9e9 })).toString(
      "base64url"
    )
    expect(verifyProviderToken(`${forged}.${sig}`, SECRET, NOW).valid).toBe(false)
    expect(verifyProviderToken(`${body}.${sig}x`, SECRET, NOW).valid).toBe(false)
    expect(verifyProviderToken(token, "q".repeat(48), NOW).valid).toBe(false)
    const later = new Date(NOW.getTime() + PROVIDER_SESSION_TTL_SECONDS * 1000)
    expect(verifyProviderToken(token, SECRET, later).valid).toBe(false)
    expect(verifyProviderToken("garbage", SECRET, NOW).valid).toBe(false)
  })

  it("is not interchangeable with a participant token, even under one secret", () => {
    const participant = issuePortalToken({ portalAccountId: "a1", firmId: "f1" }, SECRET, NOW)
    expect(verifyProviderToken(participant.token, SECRET, NOW).valid).toBe(false)
    const provider = issueProviderToken({ sessionId: "s1", accountId: "a1" }, SECRET, NOW)
    expect(verifyPortalToken(provider.token, SECRET, NOW).valid).toBe(false)
  })
})

describe("lockout", () => {
  it("locks at the fifth failure and resets the counter", () => {
    let state = { failedAttempts: 0, lockedUntil: null as Date | null }
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) {
      state = afterFailedAttempt(state.failedAttempts, NOW)
      expect(state).toEqual({ failedAttempts: i, lockedUntil: null })
    }
    state = afterFailedAttempt(state.failedAttempts, NOW)
    expect(state.failedAttempts).toBe(0)
    expect(state.lockedUntil).toEqual(new Date(NOW.getTime() + LOCKOUT_MS))
  })

  it("reports the time left on a lock", () => {
    expect(lockRemaining(null, NOW)).toBe(0)
    expect(lockRemaining(new Date(NOW.getTime() - 1), NOW)).toBe(0)
    expect(lockRemaining(new Date(NOW.getTime() + 90_500), NOW)).toBe(91)
  })
})

describe("codes and passwords", () => {
  it("normalises the code as typed", () => {
    expect(normaliseProviderCode("  ph042 ")).toBe("PH042")
  })

  it("generates unambiguous temporary passwords that pass the policy", () => {
    for (let i = 0; i < 50; i++) {
      const password = temporaryPassword()
      expect(password).toHaveLength(12)
      expect(password).not.toMatch(/[0O1lI]/)
    }
  })

  it("enforces length, letters and digits, and keeps the code out", () => {
    expect(passwordProblem("short1", "PH042")).toMatch(/au moins/)
    expect(passwordProblem("onlyletterslong", "PH042")).toMatch(/chiffres/)
    expect(passwordProblem("1234567890123", "PH042")).toMatch(/lettres/)
    expect(passwordProblem("myph042pass99", "PH042")).toMatch(/code prestataire/)
    expect(passwordProblem("Pharmacie2026!", "PH042")).toBeNull()
  })
})
