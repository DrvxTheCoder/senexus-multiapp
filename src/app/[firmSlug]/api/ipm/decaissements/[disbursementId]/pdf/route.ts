import { createElement } from "react"

import { requireFirmAccess, requireModule } from "@/server/auth/require-firm-access"
import { isAccessError, statusForError } from "@/server/errors"
import { documentImages } from "@/server/pdf/images"
import { pdfResponse, renderDocument } from "@/server/pdf/render"
import { DisbursementPdf } from "@/server/pdf/templates/disbursement"
import { disbursementDocument } from "@/server/queries/ipm/documents"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Le PDF d'un bon de décaissement, annexes comprises.
 *
 * MANAGER, the same bar as the visa actions: this document names the payee,
 * the amount and who approved it, and it is what a signatory prints to sign.
 *
 * ## Les signatures
 *
 * Fetched from the **rows**, not from the request: `approvedById` and
 * `accountingById` are only ever written with `ctx.userId`, so the image that
 * prints in a visa box belongs to the person who actually performed that
 * approval. Whoever is downloading the file cannot influence which signature
 * appears on it, which is the only construction under which printing a
 * signature at all is defensible.
 *
 * A signatory with no uploaded signature prints as a named, unsigned box. That
 * is not a failure — it is the truth about that visa, and it is the reason the
 * user form grew a signature field.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ firmSlug: string; disbursementId: string }> }
) {
  const { firmSlug, disbursementId } = await params

  try {
    const ctx = await requireFirmAccess(firmSlug, "MANAGER")
    requireModule(ctx, "ipm")

    const document = await disbursementDocument(ctx, disbursementId)
    if (!document) {
      return new Response("Bon de décaissement introuvable.", { status: 404 })
    }

    const [letterhead, stamp, approvedSignature, accountingSignature] =
      await documentImages([
        document.firm.letterhead,
        document.firm.stamp,
        document.approvedBy?.signature,
        document.accountingBy?.signature,
      ])

    const buffer = await renderDocument(
      createElement(DisbursementPdf, {
        document,
        assets: { letterhead, stamp, approvedSignature, accountingSignature },
        printedBy: ctx.userName ?? ctx.userEmail,
      })
    )

    const download = new URL(request.url).searchParams.get("download") === "1"
    return pdfResponse(buffer, `decaissement-${document.number}.pdf`, { download })
  } catch (error) {
    if (!isAccessError(error)) {
      console.error("Disbursement PDF failed", { disbursementId })
    }
    return new Response(null, { status: statusForError(error) })
  }
}
