import { z } from "zod"

import { db } from "@/lib/db"
import { requirePortalAccount } from "@/server/portal/auth"
import { json, portalRoute, preflight, readJson } from "@/server/portal/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const readSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(100) })

/**
 * POST /api/portail/notifications/read — `{ ids }` → marks them read.
 * Scoped to the caller's account: an id belonging to someone else is simply
 * not matched, and `updated` says how many were.
 */
export const POST = portalRoute(async (request) => {
  const principal = await requirePortalAccount(request)
  const { ids } = readSchema.parse(await readJson(request))

  const { count } = await db.portalNotification.updateMany({
    where: { id: { in: ids }, portalAccountId: principal.portalAccountId, readAt: null },
    data: { readAt: new Date() },
  })
  return json({ updated: count })
})

export const OPTIONS = preflight
