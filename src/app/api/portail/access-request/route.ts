import { requestAccessCode } from "@/server/portal/access-request"
import { json, portalRoute, preflight, readJson } from "@/server/portal/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/portail/access-request — `{ firmSlug, phone }` → 202
 * `{ requested: true }`, whatever the number. No bearer token: it is asked
 * by someone who cannot log in.
 */
export const POST = portalRoute(async (request) => {
  return json(await requestAccessCode(await readJson(request)), 202)
})

export const OPTIONS = preflight
