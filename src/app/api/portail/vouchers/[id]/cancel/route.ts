import { z } from "zod"

import { db } from "@/lib/db"
import { requirePortalAccount } from "@/server/portal/auth"
import { json, portalRoute, preflight, readJson } from "@/server/portal/http"
import { voucherPayload } from "@/server/portal/snapshot"
import { cancelPortalVoucher } from "@/server/portal/vouchers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const cancelSchema = z.object({
  reason: z.string().trim().min(3, "Indiquez le motif de l'annulation.").max(200),
})

/**
 * POST /api/portail/vouchers/:id/cancel — `{ reason }`.
 *
 * The bon must belong to the caller's family (403 otherwise) and be ISSUED or
 * PENDING_REVIEW. The shared `cancelVoucherCore` does the rest: dead QR token,
 * consumption released.
 */
export const POST = portalRoute(
  async (request, { params }: { params: Promise<{ id: string }> }) => {
    const principal = await requirePortalAccount(request)
    const { id } = await params
    const { reason } = cancelSchema.parse(await readJson(request))

    await db.$transaction((tx) => cancelPortalVoucher(tx, principal, id, reason))
    return json(await voucherPayload(principal.firmId, id))
  }
)

export const OPTIONS = preflight
