import "server-only"

import { cache } from "react"
import type { FirmRole } from "@prisma/client"

import { auth } from "@/server/auth"
import {
  resolveAssignedClientIds,
  resolveFirmBySlug,
  type ResolvedFirm,
} from "@/server/firms/resolve-firm"
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@/server/errors"
import { isClientScopedRole, roleAtLeast } from "@/types/auth"

/**
 * Everything a query resolver needs to scope itself. Pass this, not a firmId
 * string: the client scoping travels with it, so an export cannot forget what
 * a list remembered.
 */
export type FirmContext = {
  userId: string
  userName: string | null
  userEmail: string
  firm: ResolvedFirm
  firmId: string
  role: FirmRole
  /**
   * `null` means unrestricted. An array means the caller may only see rows
   * belonging to these clients — including rows with no client at all only
   * when the resolver says so explicitly.
   */
  assignedClientIds: string[] | null
}

export const getSession = cache(async () => auth())

/**
 * §3.3 — the single authorisation helper.
 *
 * Every server action, route handler and page calls this first. It throws
 * typed errors that map to 401 / 403 / 404; there is exactly one implementation
 * and no handler should ever re-check a membership by hand.
 *
 * Memberships come from the JWT, so the common path costs no query. Only the
 * firm record itself is read, once per request, through `cache()`.
 */
export const requireFirmAccess = cache(
  async (firmSlug: string, minimumRole?: FirmRole): Promise<FirmContext> => {
    const session = await getSession()

    if (!session?.user?.id) {
      throw new UnauthorizedError()
    }

    const membership = session.user.memberships.find(
      (m) => m.firmSlug === firmSlug
    )

    // Unknown slug and non-member are deliberately the same 404 to a caller
    // who cannot see the firm, so slugs cannot be enumerated. A member of the
    // holding who is simply below the role bar gets a 403 instead.
    const firm = await resolveFirmBySlug(firmSlug)
    if (!firm) {
      throw new NotFoundError("Entreprise introuvable.")
    }

    if (!membership) {
      const inSameHolding = session.user.holdingIds.includes(firm.holdingId)
      throw inSameHolding
        ? new ForbiddenError("Vous n'êtes pas membre de cette entreprise.")
        : new NotFoundError("Entreprise introuvable.")
    }

    if (minimumRole && !roleAtLeast(membership.role, minimumRole)) {
      throw new ForbiddenError(
        "Votre rôle ne permet pas cette action."
      )
    }

    const assignedClientIds = isClientScopedRole(membership.role)
      ? await resolveAssignedClientIds(session.user.id, firm.id)
      : null

    return {
      userId: session.user.id,
      userName: session.user.name ?? null,
      userEmail: session.user.email ?? "",
      firm,
      firmId: firm.id,
      role: membership.role,
      assignedClientIds,
    }
  }
)

/**
 * Module gating (§3.4): modules gate navigation and authorisation, never
 * rendering. A module disabled for a firm 404s its routes.
 */
export function requireModule(ctx: FirmContext, moduleSlug: string): void {
  if (!ctx.firm.modules.includes(moduleSlug)) {
    throw new NotFoundError("Module non activé pour cette entreprise.")
  }
}

/** Holding-level administration. Any OWNER membership in the holding. */
export const requireHoldingAccess = cache(async (): Promise<string[]> => {
  const session = await getSession()
  if (!session?.user?.id) {
    throw new UnauthorizedError()
  }
  // OWNER **or** ADMIN, matching the legacy rule and the switcher: the
  // Administration entry is offered to both, so the gate has to admit both or
  // an administrator is handed a link that always answers 403.
  const owned = session.user.memberships.filter(
    (m) => m.role === "OWNER" || m.role === "ADMIN"
  )
  if (owned.length === 0) {
    throw new ForbiddenError("Administration réservée aux administrateurs.")
  }
  return [...new Set(owned.map((m) => m.holdingId))]
})
