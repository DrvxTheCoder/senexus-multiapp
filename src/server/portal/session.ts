import "server-only"

import { z } from "zod"

import { db } from "@/lib/db"
import { portalTokenSecret } from "@/server/portal/auth"
import type { SessionResponse } from "@/server/portal/contract"
import { PortalError } from "@/server/portal/http"
import { toContractAccount } from "@/server/portal/snapshot"
import {
  FailureLimiter,
  hashAccessCode,
  issuePortalToken,
  normalisePhone,
  sameCode,
} from "@/server/portal/token"

/**
 * Connexion au portail — phone number and one-time code.
 *
 * **Demo only.** The code is not sent anywhere: it must equal `DEMO_OTP`, and
 * when that variable is unset the endpoint answers 503 rather than accepting a
 * constant from the source. A real SMS code replaces the comparison below and
 * nothing else.
 *
 * The code may also be an **access code** a gestionnaire issued from the back
 * office, for a participant who cannot receive the SMS. It is checked against
 * that account's hash, works once, and works whether or not `DEMO_OTP` is set.
 *
 * Failures are counted per firm and phone, five per fifteen minutes, whether
 * the number exists or not — so the answer and the lockout cannot be used to
 * learn which numbers have an account. The same count covers access codes,
 * which is what makes six digits enough.
 */

export const sessionSchema = z.object({
  firmSlug: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(6, "Numéro invalide.").max(30),
  code: z.string().trim().min(1, "Code requis.").max(20),
})

// Survives hot reload in development; per process in production — see
// FailureLimiter.
const globalForLimiter = globalThis as unknown as { portalLoginLimiter?: FailureLimiter }
const limiter = (globalForLimiter.portalLoginLimiter ??= new FailureLimiter(5, 15 * 60_000))

const WRONG = () =>
  new PortalError(401, "INVALID_CREDENTIALS", "Numéro ou code incorrect.")

export async function openSession(raw: unknown): Promise<SessionResponse> {
  const expected = process.env.DEMO_OTP
  const secret = portalTokenSecret()

  const input = sessionSchema.parse(raw)
  const phone = normalisePhone(input.phone)
  if (!/^\d{9}$/.test(phone)) {
    throw new PortalError(422, "INVALID_PHONE", "Numéro de téléphone invalide.")
  }

  const key = `${input.firmSlug}:${phone}`
  const wait = limiter.retryAfter(key)
  if (wait > 0) {
    throw new PortalError(
      429,
      "TOO_MANY_ATTEMPTS",
      `Trop de tentatives. Réessayez dans ${Math.ceil(wait / 60)} min.`,
      undefined,
      { "Retry-After": String(wait) }
    )
  }

  const firm = await db.firm.findUnique({
    where: { slug: input.firmSlug },
    select: { id: true },
  })
  const account = firm
    ? await db.portalAccount.findUnique({
        where: { firmId_phone: { firmId: firm.id, phone } },
        select: {
          id: true,
          firmId: true,
          status: true,
          activatedAt: true,
          accessCodeHash: true,
          accessCodeExpiresAt: true,
        },
      })
    : null

  const now = new Date()
  const otpMatches = expected ? sameCode(input.code, expected) : false
  const accessCodeMatches = Boolean(
    account?.accessCodeHash &&
      account.accessCodeExpiresAt &&
      account.accessCodeExpiresAt > now &&
      sameCode(hashAccessCode(account.id, input.code, secret), account.accessCodeHash)
  )

  if (!account || !(otpMatches || accessCodeMatches)) {
    limiter.fail(key)
    // No SMS service: only an access code can open a session, and a wrong one
    // gets the same answer as before codes existed — answering differently
    // would tell a stranger which numbers have a code outstanding.
    if (!expected) {
      throw new PortalError(
        503,
        "NOT_CONFIGURED",
        "La connexion au portail n'est pas encore disponible."
      )
    }
    // Same answer for an unknown number and a wrong code.
    throw WRONG()
  }

  if (account.status === "LOCKED") {
    throw new PortalError(
      403,
      "ACCOUNT_LOCKED",
      "Votre accès au portail est suspendu. Contactez votre IPM."
    )
  }

  limiter.clear(key)

  // The first successful code is the activation: an INVITED account becomes
  // ACTIVE, and `activatedAt` records when.
  const updated = await db.portalAccount.update({
    where: { id: account.id },
    data: {
      lastLoginAt: now,
      activatedAt: account.activatedAt ?? now,
      status: "ACTIVE",
      // Logged in: whatever help was asked for is no longer needed, and an
      // access code is spent — single use, whichever code opened the session.
      accessRequestedAt: null,
      ...(accessCodeMatches ? { accessCodeHash: null, accessCodeExpiresAt: null } : {}),
    },
    select: {
      id: true,
      firmId: true,
      memberId: true,
      phone: true,
      status: true,
      activatedAt: true,
      lastLoginAt: true,
    },
  })

  const { token } = issuePortalToken(
    { portalAccountId: updated.id, firmId: updated.firmId },
    secret,
    now
  )
  return { token, account: toContractAccount(updated) }
}
