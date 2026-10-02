import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * Jeton de session du portail participant.
 *
 * The same approach as the card's `verification-token.ts` — an HMAC over the
 * payload, compared in constant time before anything else is read — without
 * that token's packing, because a bearer header has no QR box to fit in:
 *
 *   base64url(JSON payload) "." base64url(HMAC-SHA256)
 *
 * The payload carries the account and its firm, and an expiry. It is a
 * credential, not an authorisation: every handler still loads the account and
 * requires it to be ACTIVE, so locking an account takes effect on the next
 * request rather than when its token lapses.
 */

export type PortalTokenPayload = {
  portalAccountId: string
  firmId: string
  /** Seconds since the epoch. */
  exp: number
}

export const PORTAL_TOKEN_TTL_SECONDS = 30 * 86_400

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url")
}

export function issuePortalToken(
  claims: Omit<PortalTokenPayload, "exp">,
  secret: string,
  now: Date = new Date()
): { token: string; payload: PortalTokenPayload } {
  const payload: PortalTokenPayload = {
    portalAccountId: claims.portalAccountId,
    firmId: claims.firmId,
    exp: Math.floor(now.getTime() / 1000) + PORTAL_TOKEN_TTL_SECONDS,
  }
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return { token: `${body}.${sign(body, secret)}`, payload }
}

export type PortalTokenFailure = "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED"

export function verifyPortalToken(
  token: string,
  secret: string,
  now: Date = new Date()
):
  | { valid: true; payload: PortalTokenPayload }
  | { valid: false; reason: PortalTokenFailure } {
  const parts = token.split(".")
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { valid: false, reason: "MALFORMED" }
  }
  const [body, signature] = parts

  // Signature first, so a forged token and an expired genuine one cannot be
  // told apart by how long the answer takes.
  const a = Buffer.from(signature)
  const b = Buffer.from(sign(body, secret))
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: "BAD_SIGNATURE" }
  }

  let payload: PortalTokenPayload
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
  } catch {
    return { valid: false, reason: "MALFORMED" }
  }
  if (
    typeof payload?.portalAccountId !== "string" ||
    typeof payload.firmId !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return { valid: false, reason: "MALFORMED" }
  }

  if (Math.floor(now.getTime() / 1000) >= payload.exp) {
    return { valid: false, reason: "EXPIRED" }
  }
  return { valid: true, payload }
}

/**
 * A phone number as `PortalAccount.phone` stores it: 9 national digits.
 * Spaces, dots, dashes and the +221 / 00221 prefix are all forms a
 * participant types.
 */
export function normalisePhone(raw: string): string {
  let digits = raw.replace(/\D/g, "")
  if (digits.startsWith("00221")) digits = digits.slice(5)
  else if (digits.startsWith("221") && digits.length === 12) digits = digits.slice(3)
  return digits
}

/** Constant-time comparison of two short strings (the one-time code). */
export function sameCode(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * Failed sign-ins per key, in memory: five in fifteen minutes, then wait.
 *
 * Per process, so it resets on a restart and does not span instances. For a
 * demo with one fixed code that is the right weight; a real SMS code needs it
 * in the database.
 */
export class FailureLimiter {
  private readonly failures = new Map<string, number[]>()

  constructor(
    private readonly max = 5,
    private readonly windowMs = 15 * 60_000
  ) {}

  private recent(key: string, now: number): number[] {
    const kept = (this.failures.get(key) ?? []).filter(
      (at) => now - at < this.windowMs
    )
    if (kept.length) this.failures.set(key, kept)
    else this.failures.delete(key)
    return kept
  }

  /** Seconds until the key may try again, or 0 when it may now. */
  retryAfter(key: string, now: number = Date.now()): number {
    const recent = this.recent(key, now)
    if (recent.length < this.max) return 0
    return Math.ceil((recent[0] + this.windowMs - now) / 1000)
  }

  fail(key: string, now: number = Date.now()): void {
    this.failures.set(key, [...this.recent(key, now), now])
  }

  clear(key: string): void {
    this.failures.delete(key)
  }
}
