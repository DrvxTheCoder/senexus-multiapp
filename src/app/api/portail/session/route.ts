import { json, portalRoute, preflight, readJson } from "@/server/portal/http"
import { openSession } from "@/server/portal/session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/portail/session — `{ firmSlug, phone, code }` → `{ token, account }`.
 *
 * The only portal route without a bearer token: it is where one is obtained.
 */
export const POST = portalRoute(async (request) => {
  return json(await openSession(await readJson(request)))
})

export const OPTIONS = preflight
