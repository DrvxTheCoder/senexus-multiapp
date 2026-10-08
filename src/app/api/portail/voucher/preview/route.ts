import { requirePortalAccount } from "@/server/portal/auth"
import { json, portalRoute, preflight, readJson } from "@/server/portal/http"
import { pharmacyRequestSchema, previewPharmacyVoucher } from "@/server/portal/pharmacy"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/portail/voucher/preview — `{ beneficiaryRef, category, providerId }`
 * → eligibility for a bon de pharmacie. No amount, so no split: the pharmacy
 * enters the amount when it validates. Read-only.
 */
export const POST = portalRoute(async (request) => {
  const principal = await requirePortalAccount(request)
  const input = pharmacyRequestSchema.parse(await readJson(request))
  return json(await previewPharmacyVoucher(principal, input))
})

export const OPTIONS = preflight
