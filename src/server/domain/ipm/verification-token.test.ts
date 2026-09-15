import { describe, expect, it } from "vitest"

import {
  DEFAULT_TOKEN_TTL_DAYS,
  firmCode,
  issueToken,
  verifyToken,
} from "@/server/domain/ipm/verification-token"

const SECRET = "a-test-secret-that-is-not-the-real-one"
const OTHER = "a-different-secret"
const NOW = new Date("2026-09-11T10:00:00.000Z")
const FIRM = firmCode("firm_1")

const member = (matricule = "01716") =>
  ({ kind: "member", firmCode: FIRM, matricule }) as const

describe("issueToken / verifyToken", () => {
  it("round-trips a participant", () => {
    const token = issueToken(member(), SECRET, NOW)
    expect(verifyToken(token, SECRET, NOW)).toMatchObject({
      valid: true,
      payload: { kind: "member", firmCode: FIRM, matricule: "01716" },
    })
  })

  it("round-trips an ayant droit", () => {
    // §6: the page must work for a dependent presenting their own card, not
    // only for the participant.
    const token = issueToken(
      { kind: "dependent", firmCode: FIRM, matricule: "01716-02" },
      SECRET,
      NOW
    )
    expect(verifyToken(token, SECRET, NOW)).toMatchObject({
      valid: true,
      payload: { kind: "dependent", matricule: "01716-02" },
    })
  })

  it("round-trips a matricule carrying an employer prefix", () => {
    // The matricule is the variable-width field between two fixed ones, so a
    // prefix must not shift the parse of either.
    const token = issueToken(member("CI01716-02"), SECRET, NOW)
    expect(verifyToken(token, SECRET, NOW)).toMatchObject({
      valid: true,
      payload: { matricule: "CI01716-02" },
    })
  })

  it("carries no personal data", () => {
    const token = issueToken(member(), SECRET, NOW)
    // A matricule, a firm code and an expiry. The matricule is printed on the
    // card the bearer is already holding; nothing else is in there.
    expect(token).not.toMatch(/diop|aminata|tawfeikh/i)
  })

  it("defaults to a one-year life, to the day", () => {
    const token = issueToken(member(), SECRET, NOW)
    const result = verifyToken(token, SECRET, NOW)
    expect(result.valid).toBe(true)
    if (result.valid) {
      // Day granularity is what keeps the expiry field 3 characters wide, so
      // the token lapses at a midnight rather than at an instant.
      const expected =
        Math.ceil(
          (Math.floor(NOW.getTime() / 1000) + DEFAULT_TOKEN_TTL_DAYS * 86_400) /
            86_400
        ) * 86_400
      expect(result.payload.expiresAt).toBe(expected)
    }
  })

  it("stays inside the QR budget for a real URL", () => {
    // The whole reason this format exists. `render-card.ts` refuses a payload
    // over 62 bytes, and the origin is most of it.
    const token = issueToken(member("01716-02"), SECRET, NOW)
    const url = `https://vercel.senexus.app/v/${token}`
    expect(url.length).toBeLessThanOrEqual(62)
  })
})

describe("firmCode", () => {
  it("is stable and 3 characters", () => {
    expect(firmCode("firm_1")).toHaveLength(3)
    expect(firmCode("firm_1")).toBe(firmCode("firm_1"))
  })

  it("separates two firms", () => {
    expect(firmCode("firm_1")).not.toBe(firmCode("firm_2"))
  })
})

describe("verifyToken — refusals", () => {
  it("refuses a token signed with another secret", () => {
    expect(verifyToken(issueToken(member(), OTHER, NOW), SECRET, NOW)).toEqual({
      valid: false,
      reason: "BAD_SIGNATURE",
    })
  })

  it("refuses a tampered matricule", () => {
    const token = issueToken(member(), SECRET, NOW)
    const forged = token.replace("01716", "01717")
    expect(verifyToken(forged, SECRET, NOW)).toEqual({
      valid: false,
      reason: "BAD_SIGNATURE",
    })
  })

  it("refuses a token re-aimed at another firm", () => {
    // Without the firm in the signed body, the same matricule at a different
    // firm would resolve to a different person.
    const token = issueToken(member(), SECRET, NOW)
    const forged = token.replace(FIRM, firmCode("firm_2"))
    expect(verifyToken(forged, SECRET, NOW)).toEqual({
      valid: false,
      reason: "BAD_SIGNATURE",
    })
  })

  it("refuses an expiry pushed further out", () => {
    // The obvious attack on a token that expires: edit the number.
    const token = issueToken({ ...member(), expiresAt: 86_400 }, SECRET, NOW)
    const forged = "m" + "zzz" + token.slice(4)
    expect(verifyToken(forged, SECRET, NOW)).toEqual({
      valid: false,
      reason: "BAD_SIGNATURE",
    })
  })

  it("refuses an expired token", () => {
    const token = issueToken(
      { ...member(), expiresAt: Math.floor(NOW.getTime() / 1000) - 86_400 },
      SECRET,
      NOW
    )
    expect(verifyToken(token, SECRET, NOW)).toEqual({
      valid: false,
      reason: "EXPIRED",
    })
  })

  it("refuses anything that is not a token", () => {
    for (const junk of ["", "x", "m01716", "z" + "fvo" + FIRM + "01716".padEnd(16, "a")]) {
      expect(verifyToken(junk, SECRET, NOW).valid).toBe(false)
    }
  })

  it("refuses a token with no matricule left in it", () => {
    // Head and signature only. Slicing must not yield an empty matricule that
    // then resolves against whatever the database returns first.
    const token = issueToken(member(), SECRET, NOW)
    expect(verifyToken(token.slice(0, 7) + token.slice(-16), SECRET, NOW).valid).toBe(
      false
    )
  })

  it("checks the signature before the expiry", () => {
    // Otherwise the two failures are distinguishable, and a forger learns
    // whether the matricule they guessed exists.
    const expired = issueToken({ ...member(), expiresAt: 86_400 }, OTHER, NOW)
    expect(verifyToken(expired, SECRET, NOW)).toEqual({
      valid: false,
      reason: "BAD_SIGNATURE",
    })
  })
})
