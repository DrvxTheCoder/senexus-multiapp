import { db } from "@/lib/db"
import { requireFirmAccess, requireModule } from "@/server/auth/require-firm-access"
import { isAccessError, statusForError } from "@/server/errors"
import { streamPrescription } from "@/server/portal/prescription"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * L'ordonnance d'un bon, pour le back office — behind the session and the
 * module gate, like the bon's PDF. Streamed from storage, never redirected to
 * it: the storage URL is not something a browser should ever see.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ firmSlug: string; voucherId: string }> }
) {
  const { firmSlug, voucherId } = await params

  try {
    const ctx = await requireFirmAccess(firmSlug)
    requireModule(ctx, "ipm")

    // Another firm's bon does not resolve: the same 404 as none.
    const voucher = await db.ipmVoucher.findFirst({
      where: { id: voucherId, firmId: ctx.firmId },
      select: { prescriptionUrl: true },
    })
    if (!voucher?.prescriptionUrl) {
      return new Response("Ordonnance introuvable.", { status: 404 })
    }
    return streamPrescription(voucher.prescriptionUrl)
  } catch (error) {
    if (!isAccessError(error)) console.error("Prescription stream failed", { voucherId })
    return new Response(null, { status: statusForError(error) })
  }
}
