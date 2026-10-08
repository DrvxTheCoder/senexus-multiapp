import { json, portalRoute, preflight, readJson } from "@/server/portal/http"
import { providerLogin } from "@/server/portal/provider-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/portail/prestataire/login — `{ code, password }` →
 * `{ token, expiresAt, mustChangePassword, provider }`.
 *
 * One answer for every failure (401 INVALID_CREDENTIALS); 429 ACCOUNT_LOCKED
 * with `Retry-After` after five, for a code that exists and one that does not
 * alike. See `server/portal/provider-auth.ts`.
 */
export const POST = portalRoute(async (request) => {
  return json(await providerLogin(await readJson(request)))
})

export const OPTIONS = preflight
