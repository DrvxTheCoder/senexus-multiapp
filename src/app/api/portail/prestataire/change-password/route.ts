import { json, portalRoute, preflight, readJson } from "@/server/portal/http"
import { changeProviderPassword, requireProviderAccount } from "@/server/portal/provider-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/portail/prestataire/change-password — `{ currentPassword,
 * newPassword }` → `{ mustChangePassword: false }`. The one route a session
 * opened with a temporary password may reach. Closes the account's other
 * sessions.
 */
export const POST = portalRoute(async (request) => {
  const principal = await requireProviderAccount(request, { allowPendingPasswordChange: true })
  return json(await changeProviderPassword(principal, await readJson(request)))
})

export const OPTIONS = preflight
