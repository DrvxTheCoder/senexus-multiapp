import "server-only"

import { db } from "@/lib/db"
import { PortalError } from "@/server/portal/http"
import { verifyPortalToken } from "@/server/portal/token"

/**
 * Who is calling the portal API — the one check every handler but the session
 * one starts with.
 *
 * The token proves which account it was issued to. It does not prove the
 * account may still act: that is read from the database on every request, so
 * locking an account, or the IPM module being switched off, takes effect
 * immediately rather than in up to 30 days.
 */

export type PortalPrincipal = {
  portalAccountId: string
  firmId: string
  memberId: string
}

/**
 * The secret tokens are signed with. Its own variable rather than one derived
 * from NEXTAUTH_SECRET: the portal is a separate client, and rotating its
 * secret (logging every participant out) must not touch back-office sessions.
 * Absent, the API answers 503 — never a fallback constant, which would make
 * every token forgeable while nothing looked wrong.
 */
export function portalTokenSecret(): string {
  const secret = process.env.PORTAL_TOKEN_SECRET
  if (!secret || secret.length < 32) {
    throw new PortalError(
      503,
      "NOT_CONFIGURED",
      "Le portail n'est pas encore disponible. Réessayez plus tard."
    )
  }
  return secret
}

const UNAUTHENTICATED = () =>
  new PortalError(401, "UNAUTHENTICATED", "Votre session a expiré. Reconnectez-vous.")

export async function requirePortalAccount(request: Request): Promise<PortalPrincipal> {
  const header = request.headers.get("authorization") ?? ""
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  if (!match) throw UNAUTHENTICATED()

  const verified = verifyPortalToken(match[1], portalTokenSecret())
  if (!verified.valid) throw UNAUTHENTICATED()

  const account = await db.portalAccount.findFirst({
    where: { id: verified.payload.portalAccountId, firmId: verified.payload.firmId },
    select: {
      id: true,
      firmId: true,
      memberId: true,
      status: true,
      firm: {
        select: {
          firmModules: {
            where: { module: { slug: "ipm" } },
            select: { isEnabled: true },
          },
        },
      },
    },
  })

  if (!account) throw UNAUTHENTICATED()
  if (account.status !== "ACTIVE") {
    throw new PortalError(
      403,
      "ACCOUNT_LOCKED",
      "Votre accès au portail est suspendu. Contactez votre IPM."
    )
  }
  if (!account.firm.firmModules.some((m) => m.isEnabled)) throw UNAUTHENTICATED()

  return {
    portalAccountId: account.id,
    firmId: account.firmId,
    memberId: account.memberId,
  }
}
