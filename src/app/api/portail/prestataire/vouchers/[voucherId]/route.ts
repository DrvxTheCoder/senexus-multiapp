import { json, portalRoute, preflight } from "@/server/portal/http"
import { requireProviderAccount } from "@/server/portal/provider-auth"
import { voucherDetail } from "@/server/portal/provider-vouchers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/portail/prestataire/vouchers/:voucherId — one of the pharmacy's own
 * bons, with a fresh link to its ordonnance. Another pharmacy's bon is 404.
 */
export const GET = portalRoute(
  async (request, { params }: { params: Promise<{ voucherId: string }> }) => {
    const principal = await requireProviderAccount(request)
    const { voucherId } = await params
    return json(await voucherDetail(principal, voucherId))
  }
)

export const OPTIONS = preflight
