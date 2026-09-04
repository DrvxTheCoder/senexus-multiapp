import "server-only"

import { cache } from "react"

import { db } from "@/lib/db"

export type ResolvedFirm = {
  id: string
  slug: string
  name: string
  holdingId: string
  logo: string | null
  /** Raw column value. Validate with `parseFirmTheme` before use — the live
   *  data contains both hex and colour names. */
  themeColor: string | null
  /** Slugs of the modules enabled for this firm. */
  modules: string[]
}

/**
 * §3.1 — the firm is resolved exactly once per request, in the layout.
 *
 * Wrapped in React `cache()` so that the layout, a page, a server action and a
 * route handler in the same request all share one query. No page or client
 * component ever looks a firm up by slug again.
 */
export const resolveFirmBySlug = cache(
  async (slug: string): Promise<ResolvedFirm | null> => {
    const firm = await db.firm.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        name: true,
        holdingId: true,
        logo: true,
        themeColor: true,
        firmModules: {
          where: { isEnabled: true, module: { isActive: true } },
          select: { module: { select: { slug: true } } },
        },
      },
    })

    if (!firm) return null

    const { firmModules, ...rest } = firm
    return {
      ...rest,
      modules: firmModules.map((fm) => fm.module.slug),
    }
  }
)

/**
 * Clients the caller may see within a firm, for roles whose visibility is
 * narrowed by `UserClientAssignment`. Cached per request; the result feeds the
 * query resolvers, which apply it inside the where-builder rather than in any
 * handler.
 */
export const resolveAssignedClientIds = cache(
  async (userId: string, firmId: string): Promise<string[]> => {
    const rows = await db.userClientAssignment.findMany({
      where: { userId, firmId },
      select: { clientId: true },
    })
    return rows.map((row) => row.clientId)
  }
)
