import { json, portalRoute, preflight } from "@/server/portal/http"
import { providerLogout, requireProviderAccount } from "@/server/portal/provider-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** POST /api/portail/prestataire/logout — closes this session, and only it. */
export const POST = portalRoute(async (request) => {
  const principal = await requireProviderAccount(request, { allowPendingPasswordChange: true })
  await providerLogout(principal)
  return json({ ok: true })
})

export const OPTIONS = preflight
