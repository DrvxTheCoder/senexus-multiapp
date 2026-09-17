import { createElement } from "react"

import { db } from "@/lib/db"
import { requireFirmAccess, requireModule } from "@/server/auth/require-firm-access"
import { isAccessError, statusForError } from "@/server/errors"
import { documentImages } from "@/server/pdf/images"
import { pdfResponse, renderDocument } from "@/server/pdf/render"
import { ProviderInvoicePdf } from "@/server/pdf/templates/provider-invoice"
import { providerInvoiceDocument } from "@/server/queries/ipm/documents"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Le PDF d'une facture prestataire.
 *
 * MANAGER rather than plain membership: an invoice is a financial document
 * naming every beneficiary who was treated at that provider in the period,
 * which is a different — and larger — disclosure than a single bon. The list
 * screen that links here is already behind the same bar.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ firmSlug: string; invoiceId: string }> }
) {
  const { firmSlug, invoiceId } = await params

  try {
    const ctx = await requireFirmAccess(firmSlug, "MANAGER")
    requireModule(ctx, "ipm")

    const document = await providerInvoiceDocument(ctx, invoiceId)
    if (!document) return new Response("Facture introuvable.", { status: 404 })

    const checker = await db.ipmProviderInvoice.findFirst({
      where: { id: invoiceId, firmId: ctx.firmId },
      select: { checkedBy: { select: { signatureUrl: true } } },
    })

    const [letterhead, stamp, checkerSignature] = await documentImages([
      document.firm.letterhead,
      document.firm.stamp,
      checker?.checkedBy?.signatureUrl,
    ])

    const buffer = await renderDocument(
      createElement(ProviderInvoicePdf, {
        document,
        assets: { letterhead, stamp, checkerSignature },
        printedBy: ctx.userName ?? ctx.userEmail,
      })
    )

    const download = new URL(request.url).searchParams.get("download") === "1"
    return pdfResponse(buffer, `facture-${document.number}.pdf`, { download })
  } catch (error) {
    if (!isAccessError(error)) console.error("Invoice PDF failed", { invoiceId })
    return new Response(null, { status: statusForError(error) })
  }
}
