import { json, portalRoute, preflight } from "@/server/portal/http"
import { requireProviderAccount } from "@/server/portal/provider-auth"
import { listValidated } from "@/server/portal/provider-vouchers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/portail/prestataire/vouchers?month=YYYY-MM — the pharmacy's
 * validated bons for the month (this month by default), with the current
 * amounts and their total.
 */
export const GET = portalRoute(async (request) => {
  const principal = await requireProviderAccount(request)
  return json(await listValidated(principal, new URL(request.url).searchParams.get("month")))
})

export const OPTIONS = preflight
