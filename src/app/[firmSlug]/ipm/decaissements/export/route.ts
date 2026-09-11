import {
  requireFirmAccess,
  requireModule,
} from "@/server/auth/require-firm-access"
import { isAccessError, statusForError } from "@/server/errors"
import { accountingExport, toCsv } from "@/server/queries/ipm/disbursements"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Export comptable — §2.
 *
 * The module **produces an export and passes no entry**. Double-entry
 * accounting is excluded from the scope in writing: no journal, no chart of
 * accounts, no bank reconciliation, no fixed assets, no budget. This route is
 * where that line is drawn — rows a bookkeeper imports, on the SYSCOHADA codes
 * the institution already uses, and nothing that claims to be a ledger.
 *
 * Behind the module gate and a membership check like every other IPM route:
 * the file names providers, amounts and payment references.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ firmSlug: string }> }
) {
  const { firmSlug } = await params

  try {
    const ctx = await requireFirmAccess(firmSlug)
    requireModule(ctx, "ipm")

    const url = new URL(request.url)
    const year = new Date().getFullYear()
    const from = new Date(url.searchParams.get("from") ?? `${year}-01-01`)
    const to = new Date(url.searchParams.get("to") ?? `${year}-12-31`)

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return new Response("Période invalide.", { status: 400 })
    }

    const rows = await accountingExport(ctx, { from, to })
    const csv = toCsv(rows)

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ecritures-ipm-${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error) {
    if (!isAccessError(error)) console.error("Accounting export failed", error)
    return new Response(null, { status: statusForError(error) })
  }
}
