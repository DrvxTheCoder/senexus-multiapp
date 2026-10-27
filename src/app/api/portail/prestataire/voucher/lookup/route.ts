import { json, portalRoute, preflight } from "@/server/portal/http"
import { requireProviderAccount } from "@/server/portal/provider-auth"
import { lookupSchema, lookupVoucher } from "@/server/portal/provider-vouchers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/portail/prestataire/voucher/lookup?token=… — the bon behind a
 * scanned QR, or of a typed bon number. 403 WRONG_PROVIDER when the QR is
 * bound to another pharmacy, 404 when nothing names an open bon of its own.
 */
export const GET = portalRoute(async (request) => {
  const principal = await requireProviderAccount(request)
  const { token } = lookupSchema.parse({
    token: new URL(request.url).searchParams.get("token") ?? "",
  })
  return json(await lookupVoucher(principal, token))
})

export const OPTIONS = preflight
