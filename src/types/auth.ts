import type { FirmRole } from "@prisma/client"

/**
 * A firm the caller belongs to, as carried in the JWT.
 *
 * Everything here is cheap and stable enough to live in a cookie: the firm
 * identity plus the role. Anything that changes per request (counts, enabled
 * modules, theme) is resolved server-side in the firm layout instead.
 */
export type FirmMembership = {
  firmId: string
  firmSlug: string
  firmName: string
  holdingId: string
  role: FirmRole
}

/**
 * Role ordering, most privileged first. `RESPONSABLE` sits below `MANAGER`
 * because it is a *narrowing* role: a responsable sees only the clients
 * assigned to them through `UserClientAssignment`.
 */
export const ROLE_RANK: Record<FirmRole, number> = {
  OWNER: 0,
  ADMIN: 1,
  MANAGER: 2,
  RESPONSABLE: 3,
  STAFF: 4,
  VIEWER: 5,
}

/** True when `role` is at least as privileged as `minimum`. */
export function roleAtLeast(role: FirmRole, minimum: FirmRole): boolean {
  return ROLE_RANK[role] <= ROLE_RANK[minimum]
}

/**
 * Roles whose visibility is restricted to their assigned clients.
 * The restriction itself is applied inside the query resolvers (§3.5), never
 * in a handler.
 */
export function isClientScopedRole(role: FirmRole): boolean {
  return role === "RESPONSABLE"
}
