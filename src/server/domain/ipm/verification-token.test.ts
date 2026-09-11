import { describe, expect, it } from "vitest"

import {
  DEFAULT_TOKEN_TTL_SECONDS,
  issueToken,
  verifyToken,
} from "@/server/domain/ipm/verification-token"

const SECRET = "a-test-secret-that-is-not-the-real-one"
const OTHER = "a-different-secret"
const NOW = new Date("2026-09-11T10:00:00.000Z")

describe("issueToken / verifyToken", () => {
  it("round-trips a participant", () => {
    const token = issueToken({ kind: "member", id: "mem_1" }, SECRET, NOW)
    const result = verifyToken(token, SECRET, NOW)
    expect(result).toMatchObject({
      valid: true,
      payload: { kind: "member", id: "mem_1" },
    })
  })

  it("round-trips an ayant droit", () => {
    // §6: the page must work for a dependent presenting their own card, not
    // only for the participant.
    const token = issueToken({ kind: "dependent", id: "dep_7" }, SECRET, NOW)
    expect(verifyToken(token, SECRET, NOW)).toMatchObject({
      valid: true,
      payload: { kind: "dependent", id: "dep_7" },
    })
  })

  it("carries no personal data", () => {
    const token = issueToken({ kind: "member", id: "mem_1" }, SECRET, NOW)
    // An id and an expiry. A QR read off a card in a bin reveals nothing.
    expect(token).not.toMatch(/diop|aminata|01716/i)
  })

  it("defaults to a one-year life", () => {
    const token = issueToken({ kind: "member", id: "mem_1" }, SECRET, NOW)
    const result = verifyToken(token, SECRET, NOW)
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.payload.expiresAt).toBe(
        Math.floor(NOW.getTime() / 1000) + DEFAULT_TOKEN_TTL_SECONDS
      )
    }
  })
})

describe("verifyToken — refusals", () => {
  it("refuses a token signed with another secret", () => {
    const token = issueToken({ kind: "member", id: "mem_1" }, OTHER, NOW)
    expect(verifyToken(token, SECRET, NOW)).toEqual({
      valid: false,
      reason: "BAD_SIGNATURE",
    })
  })

  it("refuses a tampered id", () => {
    const token = issueToken({ kind: "member", id: "mem_1" }, SECRET, NOW)
    const forged = token.replace("mem_1", "mem_2")
    expect(verifyToken(forged, SECRET, NOW)).toEqual({
      valid: false,
      reason: "BAD_SIGNATURE",
    })
  })

  it("refuses an expiry pushed further out", () => {
    // The obvious attack on a token that expires: edit the number.
    const token = issueToken(
      { kind: "member", id: "mem_1", expiresAt: 1_000 },
      SECRET,
      NOW
    )
    const forged = token.replace(".1000.", ".99999999999.")
    expect(verifyToken(forged, SECRET, NOW)).toEqual({
      valid: false,
      reason: "BAD_SIGNATURE",
    })
  })

  it("refuses an expired token", () => {
    const token = issueToken(
      {
        kind: "member",
        id: "mem_1",
        expiresAt: Math.floor(NOW.getTime() / 1000) - 1,
      },
      SECRET,
      NOW
    )
    expect(verifyToken(token, SECRET, NOW)).toEqual({
      valid: false,
      reason: "EXPIRED",
    })
  })

  it("treats the expiry instant itself as expired", () => {
    const at = Math.floor(NOW.getTime() / 1000)
    const token = issueToken({ kind: "member", id: "mem_1", expiresAt: at }, SECRET, NOW)
    expect(verifyToken(token, SECRET, NOW)).toEqual({
      valid: false,
      reason: "EXPIRED",
    })
  })

  it("refuses anything that is not a token", () => {
    for (const junk of ["", "x", "m.mem_1", "m.mem_1.abc.def.ghi", "z.id.1.sig"]) {
      expect(verifyToken(junk, SECRET, NOW).valid).toBe(false)
    }
  })

  it("checks the signature before the expiry", () => {
    // Otherwise the two failures are distinguishable, and a forger learns
    // whether the id they guessed exists.
    const expired = issueToken(
      { kind: "member", id: "mem_1", expiresAt: 1 },
      OTHER,
      NOW
    )
    expect(verifyToken(expired, SECRET, NOW).valid).toBe(false)
    expect(verifyToken(expired, SECRET, NOW)).toEqual({
      valid: false,
      reason: "BAD_SIGNATURE",
    })
  })
})
