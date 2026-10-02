import { requirePortalAccount } from "@/server/portal/auth"
import { json, portalRoute, preflight, readJson } from "@/server/portal/http"
import { previewDraftSchema, previewPortalVoucher } from "@/server/portal/vouchers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/portail/vouchers/preview — a draft → `{ allowed, refusals, split,
 * wouldHold, flags, … }`. Read-only: the same facts and decisions as the
 * issue, nothing written.
 */
export const POST = portalRoute(async (request) => {
  const principal = await requirePortalAccount(request)
  const draft = previewDraftSchema.parse(await readJson(request))
  return json(await previewPortalVoucher(principal, draft))
})

export const OPTIONS = preflight
