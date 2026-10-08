import { json, portalRoute, preflight, readJson } from "@/server/portal/http"
import { requireProviderAccount } from "@/server/portal/provider-auth"
import { amountRequestSchema, previewAmount } from "@/server/portal/provider-vouchers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/portail/prestataire/voucher/validate/preview — `{ voucherId,
 * amount }` → the split the pharmacist will confirm. Same rules and same
 * pricing as the validation, nothing written.
 */
export const POST = portalRoute(async (request) => {
  const principal = await requireProviderAccount(request)
  const input = amountRequestSchema.parse(await readJson(request))
  return json(await previewAmount(principal, input))
})

export const OPTIONS = preflight
