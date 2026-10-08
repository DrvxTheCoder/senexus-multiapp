import { db } from "@/lib/db"
import { errorResponse, portalRoute, preflight } from "@/server/portal/http"
import { streamPrescription, verifyPrescriptionLink } from "@/server/portal/prescription"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/portail/prescriptions/:voucherId?exp=…&sig=… — the ordonnance.
 *
 * The signature is the authorisation: it is minted only for the family's own
 * session or the bound pharmacy's (see `server/portal/prescription.ts`) and
 * lapses after ten minutes. A bad, stale or absent one is the same 404 as a bon
 * that does not exist, so the route says nothing about which bons have files.
 */
export const GET = portalRoute(
  async (request, { params }: { params: Promise<{ voucherId: string }> }) => {
    const { voucherId } = await params
    const url = new URL(request.url)

    const notFound = () => errorResponse(404, "NOT_FOUND", "Ordonnance introuvable.")
    if (!verifyPrescriptionLink(voucherId, url.searchParams.get("exp"), url.searchParams.get("sig"))) {
      return notFound()
    }

    const voucher = await db.ipmVoucher.findUnique({
      where: { id: voucherId },
      select: { prescriptionUrl: true },
    })
    if (!voucher?.prescriptionUrl) return notFound()

    // The portal may fetch() it as a blob as well as open it; same single origin.
    const origin = process.env.PORTAL_ORIGIN?.replace(/\/$/, "")
    return streamPrescription(voucher.prescriptionUrl, {
      ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
      Vary: "Origin",
    })
  }
)

export const OPTIONS = preflight
