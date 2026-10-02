import { requirePortalAccount } from "@/server/portal/auth"
import { json, portalRoute, preflight } from "@/server/portal/http"
import { buildSnapshot } from "@/server/portal/snapshot"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/portail/snapshot — the portal's `Db`, for the caller's family only.
 * The scope comes from the account behind the token; see `buildSnapshot`.
 */
export const GET = portalRoute(async (request) => {
  const principal = await requirePortalAccount(request)
  return json(await buildSnapshot(principal))
})

export const OPTIONS = preflight
