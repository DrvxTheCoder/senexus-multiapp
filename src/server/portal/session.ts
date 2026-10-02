import "server-only"

import { z } from "zod"

import { db } from "@/lib/db"
import { portalTokenSecret } from "@/server/portal/auth"
import type { SessionResponse } from "@/server/portal/contract"
import { PortalError } from "@/server/portal/http"
import { toContractAccount } from "@/server/portal/snapshot"
import {
  FailureLimiter,
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
 * Failures are counted per firm and phone, five per fifteen minutes, whether
 * the number exists or not — so the answer and the lockout cannot be used to
 * learn which numbers have an account.
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
  if (!expected) {
    throw new PortalError(
      503,
      "NOT_CONFIGURED",
      "La connexion au portail n'est pas encore disponible."
    )
  }
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
        select: { id: true, firmId: true, status: true, activatedAt: true },
      })
    : null

  // Same answer for an unknown number and a wrong code.
  const codeMatches = sameCode(input.code, expected)
  if (!account || !codeMatches) {
    limiter.fail(key)
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
  const now = new Date()

  // The first successful code is the activation: an INVITED account becomes
  // ACTIVE, and `activatedAt` records when.
  const updated = await db.portalAccount.update({
    where: { id: account.id },
    data: {
      lastLoginAt: now,
      activatedAt: account.activatedAt ?? now,
      status: "ACTIVE",
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
