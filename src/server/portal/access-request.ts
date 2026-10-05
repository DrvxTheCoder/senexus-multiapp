import "server-only"

import { z } from "zod"

import { db } from "@/lib/db"
import type { AccessRequestResponse } from "@/server/portal/contract"
import { PortalError } from "@/server/portal/http"
import { FailureLimiter, normalisePhone } from "@/server/portal/token"

/**
 * "Je n'arrive pas à me connecter" — a participant asking, from the login
 * screen, for a code their IPM will give them by other means.
 *
 * Unauthenticated, so it says nothing: the same 202 whether the number has an
 * account, has one that is suspended, or has none. A known number gets its
 * request stamped on the account, where the back office lists it; the first
 * stamp is kept, so "en attente depuis" stays honest under repeated taps.
 *
 * Throttled per firm and phone, three per hour, counted for every number
 * alike — the limit cannot tell a stranger which numbers exist either.
 */

export const accessRequestSchema = z.object({
  firmSlug: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(6, "Numéro invalide.").max(30),
})

const globalForLimiter = globalThis as unknown as {
  portalAccessRequestLimiter?: FailureLimiter
}
const limiter = (globalForLimiter.portalAccessRequestLimiter ??=
  new FailureLimiter(3, 60 * 60_000))

export async function requestAccessCode(
  raw: unknown
): Promise<AccessRequestResponse> {
  const input = accessRequestSchema.parse(raw)
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
      `Demande déjà transmise. Réessayez dans ${Math.ceil(wait / 60)} min.`,
      undefined,
      { "Retry-After": String(wait) }
    )
  }
  limiter.fail(key)

  const firm = await db.firm.findUnique({
    where: { slug: input.firmSlug },
    select: { id: true },
  })
  if (firm) {
    await db.portalAccount.updateMany({
      where: { firmId: firm.id, phone, accessRequestedAt: null },
      data: { accessRequestedAt: new Date() },
    })
  }

  return { requested: true }
}
