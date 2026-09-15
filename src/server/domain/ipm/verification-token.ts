import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * Jeton de vérification — plan §6.
 *
 * The QR on a card resolves to a public page that says whether the bearer is
 * covered. That page is public by design: a pharmacist at a counter has no
 * account. Three consequences are designed for here rather than discovered
 * later:
 *
 *   1. **The token is signed, not guessed.** It carries the beneficiary's
 *      matricule and an expiry, and an HMAC over both. Nobody can enumerate
 *      cards by incrementing a number — which is exactly what a bare matricule
 *      in a QR would allow, and why the matricule alone is not the token.
 *   2. **It works for an ayant droit too**, not only the participant — a
 *      spouse presents their own card and must verify as themselves.
 *   3. **It expires.** A card photographed once does not become a permanent
 *      credential; regenerating a card issues a new token and the old one
 *      stops resolving.
 *
 * What the token deliberately does *not* carry is any personal data: no name,
 * no date of birth, no firm name. A QR read off a card in a bin yields a
 * number and a checksum, and the page it points at decides what is safe to
 * show.
 *
 * ## Why every field is packed as tightly as it is
 *
 * **The artwork's QR box is the budget, and it is a hard one.** The box holds
 * a 33-module symbol at a module pitch that still scans in print; at error
 * correction M that is 62 bytes for the *entire URL*, origin included. With
 * "https://vercel.senexus.app/v/" costing 29 of them, the token has about 33
 * characters to work in.
 *
 * The previous format spent 25 of those on a cuid and came to 86 characters,
 * which needs 37 modules. It never fit, so `qrFits` rejected it on every card
 * and the QR block was silently left empty — the whole register printed
 * without a code. Every choice below exists to keep the URL inside the box:
 *
 *   - **the matricule, not the row id.** Five digits instead of a
 *     25-character cuid, already unique per firm, and printed on the card
 *     anyway — so it reveals nothing the bearer is not already holding;
 *   - **a 3-character firm code** rather than a slug, because `ipm-tawfeikh`
 *     alone would blow the budget;
 *   - **day-granular expiry** in base 36: 3 characters instead of a 10-digit
 *     epoch second. A card's life is measured in months, and the hour it
 *     lapses is not information anybody needs;
 *   - **a 96-bit signature**, 16 base64url characters rather than 22. Forging
 *     one is an online-only attack against a public page, and 2^96 is not a
 *     number anybody walks up.
 *
 * ## The layout
 *
 * Fixed-width head and tail, variable middle — so no separators are needed,
 * and a matricule containing a hyphen (every ayant droit: `01716-01`) parses
 * without ambiguity:
 *
 * ```
 *   m   fvo   7kq   01716-01   Gv7xQ2mNpL4sT8yB
 *   │   │     │     │          └ signature, 16 chars
 *   │   │     │     └ matricule, variable
 *   │   │     └ firm code, 3 chars
 *   │   └ expiry, 3 chars — days since the epoch, base 36
 *   └ kind
 * ```
 */

export type BeneficiaryKind = "member" | "dependent"

export type TokenPayload = {
  kind: BeneficiaryKind
  /** Short firm discriminator — `firmCode(firmId)`, never the slug. */
  firmCode: string
  /** The matricule printed on the card: `01716`, or `01716-01` for a dependent. */
  matricule: string
  /** Seconds since the epoch. Always a midnight — the token stores whole days. */
  expiresAt: number
}

/** A year. Long enough to outlive a card in a wallet, short enough to lapse. */
export const DEFAULT_TOKEN_TTL_DAYS = 365

const SECONDS_PER_DAY = 86_400

const KIND_CODE: Record<BeneficiaryKind, string> = {
  member: "m",
  dependent: "d",
}

const CODE_KIND: Record<string, BeneficiaryKind> = {
  m: "member",
  d: "dependent",
}

/** Field widths. The matricule is whatever is left between them. */
const KIND_CHARS = 1
const EXPIRY_CHARS = 3
const FIRM_CHARS = 3
const HEAD_CHARS = KIND_CHARS + EXPIRY_CHARS + FIRM_CHARS

/**
 * 12 bytes of HMAC-SHA256, which is exactly 16 base64url characters.
 *
 * Truncation is deliberate and the number is chosen rather than inherited: the
 * only way to test a guess is to ask the verification page, so 96 bits is far
 * past the point where the attack is bounded by the network rather than by the
 * arithmetic.
 */
const SIGNATURE_BYTES = 12
const SIGNATURE_CHARS = 16

/** The largest day number the expiry field can hold — base36, 3 chars. */
const MAX_EXPIRY_DAYS = 36 ** EXPIRY_CHARS

/**
 * A firm, in 3 base36 characters — 46 656 slots for a handful of firms.
 *
 * The matricule is unique only *within* a firm, so something has to say which
 * firm, and the slug does not fit. This is a pure function of the firm id, so
 * it costs no column and no migration. Collisions are possible in principle;
 * the resolver treats two matching firms as unresolvable rather than guessing,
 * which is why this can be a hash rather than an allocated code.
 */
export function firmCode(firmId: string): string {
  const digest = createHmac("sha256", "ipm:card-firm-code").update(firmId).digest()
  return (digest.readUInt32BE(0) % 36 ** FIRM_CHARS)
    .toString(36)
    .padStart(FIRM_CHARS, "0")
}

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url")
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
    Math.floor(now.getTime() / 1000) + DEFAULT_TOKEN_TTL_DAYS * SECONDS_PER_DAY

  // Rounded up, so day granularity never shortens a card's life below what
  // the caller asked for.
  const days = Math.ceil(expiresAt / SECONDS_PER_DAY)
  if (days >= MAX_EXPIRY_DAYS) {
    throw new Error(
      `Verification token expiry ${expiresAt} overflows the ${EXPIRY_CHARS}-character field.`
    )
  }

  const body =
    KIND_CODE[payload.kind] +
    days.toString(36).padStart(EXPIRY_CHARS, "0") +
    payload.firmCode +
    payload.matricule

  return body + sign(body, secret)
}

export type VerifyFailure = "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED"

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
  // A token with nothing left over for the matricule cannot be genuine, and
  // slicing it would silently produce an empty one.
  if (token.length <= HEAD_CHARS + SIGNATURE_CHARS) {
    return { valid: false, reason: "MALFORMED" }
  }

  const body = token.slice(0, -SIGNATURE_CHARS)
  const signature = token.slice(-SIGNATURE_CHARS)

  const kind = CODE_KIND[body.slice(0, KIND_CHARS)]
  const days = Number.parseInt(
    body.slice(KIND_CHARS, KIND_CHARS + EXPIRY_CHARS),
    36
  )
  const code = body.slice(KIND_CHARS + EXPIRY_CHARS, HEAD_CHARS)
  const matricule = body.slice(HEAD_CHARS)

  if (!kind || !Number.isInteger(days)) {
    return { valid: false, reason: "MALFORMED" }
  }

  const expected = sign(body, secret)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: "BAD_SIGNATURE" }
  }

  const expiresAt = days * SECONDS_PER_DAY
  if (Math.floor(now.getTime() / 1000) >= expiresAt) {
    return { valid: false, reason: "EXPIRED" }
  }

  return { valid: true, payload: { kind, firmCode: code, matricule, expiresAt } }
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
