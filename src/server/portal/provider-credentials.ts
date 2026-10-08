import { createHmac, randomInt, timingSafeEqual } from "node:crypto"

/**
 * Accès prestataire — the parts with no database: the session token, the
 * lockout rule, temporary passwords and the password policy.
 *
 * The token has the same shape as the participant's (`token.ts`) but is signed
 * with **its own secret** (`PROVIDER_TOKEN_SECRET`) and names a session row
 * rather than an account. A participant token therefore never verifies on a
 * provider route, nor the reverse, and a provider session can be revoked
 * one by one — logout, password reset, deactivation — which a stateless
 * token could not do.
 */

export type ProviderTokenPayload = {
  /** ProviderSession.id */
  sid: string
  /** ProviderAccount.id — checked against the session row. */
  aid: string
  /** Seconds since the epoch. */
  exp: number
}

/** A working day at the counter, with margin. */
export const PROVIDER_SESSION_TTL_SECONDS = 12 * 3_600

function sign(body: string, secret: string): string {
  return createHmac("sha256", `provider:${secret}`).update(body).digest("base64url")
}

export function issueProviderToken(
  claims: { sessionId: string; accountId: string },
  secret: string,
  now: Date = new Date()
): { token: string; payload: ProviderTokenPayload } {
  const payload: ProviderTokenPayload = {
    sid: claims.sessionId,
    aid: claims.accountId,
    exp: Math.floor(now.getTime() / 1000) + PROVIDER_SESSION_TTL_SECONDS,
  }
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return { token: `${body}.${sign(body, secret)}`, payload }
}

export function verifyProviderToken(
  token: string,
  secret: string,
  now: Date = new Date()
): { valid: true; payload: ProviderTokenPayload } | { valid: false } {
  const parts = token.split(".")
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { valid: false }
  const [body, signature] = parts

  const a = Buffer.from(signature)
  const b = Buffer.from(sign(body, secret))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false }

  let payload: ProviderTokenPayload
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
  } catch {
    return { valid: false }
  }
  if (
    typeof payload?.sid !== "string" ||
    typeof payload.aid !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return { valid: false }
  }
  if (Math.floor(now.getTime() / 1000) >= payload.exp) return { valid: false }
  return { valid: true, payload }
}

/* ==========================================================================
 * Verrouillage
 * ========================================================================== */

export const MAX_FAILED_ATTEMPTS = 5
export const LOCKOUT_MS = 15 * 60_000

/**
 * What a wrong password does to the account: one more failure, and at the
 * fifth a lock of fifteen minutes with the counter reset — so the sixth try
 * waits, and the one after the lock gets five again.
 */
export function afterFailedAttempt(
  failedAttempts: number,
  now: Date
): { failedAttempts: number; lockedUntil: Date | null } {
  const next = failedAttempts + 1
  if (next >= MAX_FAILED_ATTEMPTS) {
    return { failedAttempts: 0, lockedUntil: new Date(now.getTime() + LOCKOUT_MS) }
  }
  return { failedAttempts: next, lockedUntil: null }
}

/** Seconds left on a lock, 0 when there is none. */
export function lockRemaining(lockedUntil: Date | null, now: Date): number {
  if (!lockedUntil || lockedUntil <= now) return 0
  return Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000)
}

/* ==========================================================================
 * Identifiant et mots de passe
 * ========================================================================== */

/** A code prestataire as stored and as typed: trimmed, upper case. */
export function normaliseProviderCode(raw: string): string {
  return raw.trim().toUpperCase()
}

/** No 0/O, 1/l/I: it is read aloud over the phone and typed at a counter. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"

/** Shown once to the gestionnaire, then only its hash exists. */
export function temporaryPassword(length = 12): string {
  let out = ""
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(0, ALPHABET.length)]
  return out
}

export const MIN_PASSWORD_LENGTH = 10

/** Null when acceptable, otherwise the sentence to show. */
export function passwordProblem(password: string, code: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`
  }
  if (password.length > 128) return "Le mot de passe est trop long."
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return "Le mot de passe doit contenir des lettres et des chiffres."
  }
  if (password.toUpperCase().includes(normaliseProviderCode(code))) {
    return "Le mot de passe ne doit pas contenir le code prestataire."
  }
  return null
}
