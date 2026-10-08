import { z } from "zod"

import { db } from "@/lib/db"
import { requirePortalAccount } from "@/server/portal/auth"
import { json, portalRoute, preflight, readJson } from "@/server/portal/http"
import { voucherPayload } from "@/server/portal/snapshot"
import { cancelPortalVoucher } from "@/server/portal/vouchers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const cancelSchema = z.object({
  voucherId: z.string().min(1).max(64),
  reason: z.string().trim().max(200).optional(),
})

/**
 * POST /api/portail/voucher/cancel — `{ voucherId, reason? }`.
 *
 * The same rule as `/api/portail/vouchers/:id/cancel`, with the id in the
 * body: the caller's family only (403 otherwise), and only while nobody has
 * acted on the bon — for a bon de pharmacie, while it awaits its amount. Its
 * QR is rotated to a dead token, so the pharmacy can no longer find it.
 */
export const POST = portalRoute(async (request) => {
  const principal = await requirePortalAccount(request)
  const { voucherId, reason } = cancelSchema.parse(await readJson(request))

  await db.$transaction((tx) =>
    cancelPortalVoucher(tx, principal, voucherId, reason || "Annulé par le participant")
  )
  return json(await voucherPayload(principal.firmId, voucherId))
})

export const OPTIONS = preflight
