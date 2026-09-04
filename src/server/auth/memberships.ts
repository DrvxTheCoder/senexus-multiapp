import "server-only"

import { db } from "@/lib/db"
import type { FirmMembership } from "@/types/auth"

/**
 * How long a set of memberships may sit in the JWT before it is refreshed.
 *
 * §3.2 requires that authorisation checks do not hit the database on every
 * request, so memberships live in the token. They are refreshed on sign-in, on
 * an explicit `update()` (call `refreshMemberships` after changing a
 * membership), and otherwise at most once per window as a safety net for
 * changes made from another session.
 */
export const MEMBERSHIP_TTL_MS = 15 * 60 * 1000

/**
 * One indexed lookup: `user_firms` is unique on (userId, firmId), so the
 * leading column serves this query.
 */
export async function loadMemberships(
  userId: string
): Promise<FirmMembership[]> {
  const rows = await db.userFirm.findMany({
    where: { userId },
    select: {
      role: true,
      firm: {
        select: { id: true, slug: true, name: true, holdingId: true },
      },
    },
    orderBy: { firm: { name: "asc" } },
  })

  return rows.map((row) => ({
    firmId: row.firm.id,
    firmSlug: row.firm.slug,
    firmName: row.firm.name,
    holdingId: row.firm.holdingId,
    role: row.role,
  }))
}
