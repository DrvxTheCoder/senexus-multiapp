import { json, portalRoute, preflight } from "@/server/portal/http"
import { requireProviderAccount } from "@/server/portal/provider-auth"
import { lookupSchema, lookupVoucher } from "@/server/portal/provider-vouchers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/portail/prestataire/voucher/lookup?token=… — the bon behind a
 * scanned QR. 403 WRONG_PROVIDER when it is bound to another pharmacy, 404
 * when the token names no open bon.
 */
export const GET = portalRoute(async (request) => {
  const principal = await requireProviderAccount(request)
  const { token } = lookupSchema.parse({
    token: new URL(request.url).searchParams.get("token") ?? "",
  })
  return json(await lookupVoucher(principal, token))
})

export const OPTIONS = preflight
