import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * Jeton de vérification — plan §6.
 *
 * The QR on a card resolves to a public page that says whether the bearer is
 * covered. That page is public by design: a pharmacist at a counter has no
 * account. Three consequences are designed for here rather than discovered
 * later:
 *
 *   1. **The token is signed, not guessed.** It carries the beneficiary's id
 *      and an expiry, and an HMAC over both. Nobody can enumerate cards by
 *      incrementing a number, which is exactly what a bare matricule in a QR
 *      would allow.
 *   2. **It works for an ayant droit too**, not only the participant — a
 *      spouse presents their own card and must verify as themselves.
 *   3. **It expires.** A card photographed once does not become a permanent
 *      credential; regenerating a card issues a new token and the old one
 *      stops resolving.
 *
 * What the token deliberately does *not* carry is any personal data. It is an
 * opaque reference, so a QR read off a card in a bin reveals nothing on its
 * own, and the page it points at decides what is safe to show.
 */

export type BeneficiaryKind = "member" | "dependent"

export type TokenPayload = {
  kind: BeneficiaryKind
  id: string
  /** Seconds since the epoch. */
  expiresAt: number
}

/** A year. Long enough to outlive a card in a wallet, short enough to lapse. */
export const DEFAULT_TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60

const KIND_CODE: Record<BeneficiaryKind, string> = {
  member: "m",
  dependent: "d",
}

const CODE_KIND: Record<string, BeneficiaryKind> = {
  m: "member",
  d: "dependent",
}

/** 16 bytes of HMAC-SHA256. Enough that guessing is hopeless, short in a QR. */
const SIGNATURE_BYTES = 16

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url")
}

function body(payload: TokenPayload): string {
  return `${KIND_CODE[payload.kind]}.${payload.id}.${payload.expiresAt}`
}

function sign(value: string, secret: string): string {
  return base64url(
    createHmac("sha256", secret).update(value).digest().subarray(0, SIGNATURE_BYTES)
  )
}

export function issueToken(
  payload: Omit<TokenPayload, "expiresAt"> & { expiresAt?: number },
  secret: string,
  now: Date = new Date()
): string {
  const expiresAt =
    payload.expiresAt ??
    Math.floor(now.getTime() / 1000) + DEFAULT_TOKEN_TTL_SECONDS
  const value = body({ ...payload, expiresAt })
  return `${value}.${sign(value, secret)}`
}

export type VerifyFailure =
  | "MALFORMED"
  | "BAD_SIGNATURE"
  | "EXPIRED"

export type VerifyResult =
  | { valid: true; payload: TokenPayload }
  | { valid: false; reason: VerifyFailure }

/**
 * Verifies a token.
 *
 * The signature is compared in constant time and **before** the expiry, so a
 * forged token and an expired genuine one are not distinguishable by how long
 * the answer takes. The caller still has to look the beneficiary up: a valid
 * signature proves the token was issued here, not that the person is covered.
 */
export function verifyToken(
  token: string,
  secret: string,
  now: Date = new Date()
): VerifyResult {
  const parts = token.split(".")
  if (parts.length !== 4) return { valid: false, reason: "MALFORMED" }

  const [kindCode, id, expiresAtRaw, signature] = parts
  const kind = CODE_KIND[kindCode]
  const expiresAt = Number(expiresAtRaw)

  if (!kind || !id || !Number.isInteger(expiresAt)) {
    return { valid: false, reason: "MALFORMED" }
  }

  const expected = sign(`${kindCode}.${id}.${expiresAtRaw}`, secret)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: "BAD_SIGNATURE" }
  }

  if (Math.floor(now.getTime() / 1000) >= expiresAt) {
    return { valid: false, reason: "EXPIRED" }
  }

  return { valid: true, payload: { kind, id, expiresAt } }
}

/**
 * The secret the tokens are signed with.
 *
 * Derived from NEXTAUTH_SECRET rather than given its own variable, with a
 * distinct label mixed in so a verification token can never be confused with
 * a session token even though both descend from the same secret. Throwing
 * when it is absent is deliberate: silently falling back to a constant would
 * make every token forgeable in production and nothing would look wrong.
 */
export function verificationSecret(): string {
  const base = process.env.NEXTAUTH_SECRET
  if (!base) {
    throw new Error(
      "NEXTAUTH_SECRET is required to sign IPM verification tokens."
    )
  }
  return createHmac("sha256", base).update("ipm:card-verification").digest("hex")
}
