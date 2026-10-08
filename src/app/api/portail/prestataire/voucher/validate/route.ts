import { json, portalRoute, preflight, readJson } from "@/server/portal/http"
import { requireProviderAccount } from "@/server/portal/provider-auth"
import { validateAmount, validateRequestSchema } from "@/server/portal/provider-vouchers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/portail/prestataire/voucher/validate — `{ voucherId, amount,
 * idempotencyKey }` → the final split. The bon counts from here: plafond,
 * participant balance, the pharmacy's invoice.
 *
 * A retry with the same key answers 200 `replayed: true`; any other second
 * validation is 409 ALREADY_VALIDATED.
 */
export const POST = portalRoute(async (request) => {
  const principal = await requireProviderAccount(request)
  const input = validateRequestSchema.parse(await readJson(request))
  return json(await validateAmount(principal, input))
})

export const OPTIONS = preflight
