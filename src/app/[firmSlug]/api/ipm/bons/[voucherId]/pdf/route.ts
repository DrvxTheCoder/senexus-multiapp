import { createElement } from "react"

import { appOrigin } from "@/lib/app-url"
import { requireFirmAccess, requireModule } from "@/server/auth/require-firm-access"
import { isAccessError, statusForError } from "@/server/errors"
import { documentImages, qrImage } from "@/server/pdf/images"
import { pdfResponse, renderDocument } from "@/server/pdf/render"
import { VoucherPdf } from "@/server/pdf/templates/voucher"
import { voucherDocument } from "@/server/queries/ipm/documents"
import { db } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Le PDF d'un bon — authentifié, toujours.
 *
 * Same rule as the card route, and for the same reason: a bon carries the
 * beneficiary's name, their matricule, what they are being treated for and
 * what it costs. The bytes never sit at a public URL; they are rendered per
 * request behind a membership check and the module gate.
 *
 * ## The QR
 *
 * The bon prints the verification code that is already stored on the row. It
 * resolves the **bearer**, not the bon — the public page at `/v/{token}` says
 * whether this participant is covered, which is the question a pharmacist at a
 * counter actually has. Cancelling a bon rotates that token to an expired one,
 * so a copy that has already been printed stops verifying; the template also
 * stamps the page as cancelled, and the two agree.
 *
 * The origin comes from `appOrigin()`, never from this request: a bon printed
 * on a laptop would otherwise carry a QR pointing at `localhost`, and the
 * paper outlives the request by months. Unlike the card, there is no size
 * budget — a sheet of A4 has room — so nothing is packed or omitted.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ firmSlug: string; voucherId: string }> }
) {
  const { firmSlug, voucherId } = await params

  try {
    const ctx = await requireFirmAccess(firmSlug)
    requireModule(ctx, "ipm")

    const document = await voucherDocument(ctx, voucherId)
    // A voucher id from another firm does not resolve, and the answer is the
    // same 404 as an id that does not exist.
    if (!document) return new Response("Bon introuvable.", { status: 404 })

    // The issuer's signature, if they have uploaded one. A bon is not a
    // payment instrument, so an unsigned one is perfectly valid — the box just
    // carries the name.
    const issuer = await db.ipmVoucher.findFirst({
      where: { id: voucherId, firmId: ctx.firmId },
      select: { issuedBy: { select: { signatureUrl: true } } },
    })

    const [letterhead, stamp, issuerSignature] = await documentImages([
      document.firm.letterhead,
      document.firm.stamp,
      issuer?.issuedBy?.signatureUrl,
    ])

    // A bon de pharmacie à montant différé carries its own token, which the
    // pharmacy scans in the portal to find the bon; every other bon, the
    // bearer's verification link.
    const qrContent = document.deferredAmount
      ? document.qrToken
      : `${appOrigin()}/v/${document.qrToken}`
    const qr = await qrImage(qrContent).catch(
      // A QR that cannot be produced must not take the bon down with it. The
      // page simply prints without one.
      () => null
    )

    const buffer = await renderDocument(
      createElement(VoucherPdf, {
        document,
        assets: { letterhead, stamp, qr, issuerSignature },
        printedBy: ctx.userName ?? ctx.userEmail,
      })
    )

    const download = new URL(request.url).searchParams.get("download") === "1"
    return pdfResponse(buffer, `${document.number}.pdf`, { download })
  } catch (error) {
    // Never the document's contents: a render failure must not put a name, a
    // matricule or a diagnosis into a log line.
    if (!isAccessError(error)) console.error("Voucher PDF failed", { voucherId })
    return new Response(null, { status: statusForError(error) })
  }
}
