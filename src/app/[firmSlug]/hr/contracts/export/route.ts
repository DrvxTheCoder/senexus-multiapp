import ExcelJS from "exceljs"

import { requireFirmAccess, requireModule } from "@/server/auth/require-firm-access"
import { statusForError } from "@/server/errors"
import {
  loadContractSearchParams,
  toContractQuery,
} from "@/lib/queries/contract-params"
import { streamContractsForExport } from "@/server/queries/contracts"
import { formatDate } from "@/lib/format"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * §3.5 — export is the same query with a different serialiser.
 *
 * It parses the identical URL parameters the page does, runs the identical
 * resolver, and therefore inherits the identical role scoping. There is no
 * separate export query that could forget a filter, and no way for an export to
 * contain a row the list would have hidden.
 *
 * Rows are streamed through ExcelJS's streaming writer, so a 400-row export and
 * a 40 000-row export cost the same memory.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ firmSlug: string }> }
) {
  const { firmSlug } = await params

  try {
    const ctx = await requireFirmAccess(firmSlug)
    requireModule(ctx, "hr")

    const url = new URL(request.url)
    const query = toContractQuery(loadContractSearchParams(url.searchParams))

    const stream = new TransformStream<Uint8Array, Uint8Array>()
    const writer = stream.writable.getWriter()

    // ExcelJS writes to a Node-style sink; this bridges it to the web stream
    // the route returns.
    const sink = {
      write(chunk: Uint8Array, _encoding: unknown, callback: () => void) {
        void writer.write(chunk).then(callback, callback)
        return true
      },
      end(callback?: () => void) {
        void writer.close().then(
          () => callback?.(),
          () => callback?.()
        )
      },
      on() {},
      once() {},
      emit() {},
      removeListener() {},
    }

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ExcelJS types its sink as a Node stream; this is the documented adapter shape.
      stream: sink as any,
      useStyles: true,
    })

    // The streaming writer exposes `views` as a getter only, so the frozen
    // header row has to be declared when the sheet is created.
    const sheet = workbook.addWorksheet("Contrats", {
      views: [{ state: "frozen", ySplit: 1 }],
    })
    sheet.columns = [
      { header: "Matricule", key: "matricule", width: 14 },
      { header: "Nom", key: "lastName", width: 18 },
      { header: "Prénom", key: "firstName", width: 18 },
      { header: "Poste", key: "position", width: 28 },
      { header: "Type", key: "type", width: 12 },
      { header: "Statut", key: "status", width: 14 },
      { header: "Client", key: "client", width: 24 },
      { header: "Début", key: "startDate", width: 12 },
      { header: "Fin", key: "endDate", width: 12 },
      { header: "Jours restants", key: "daysRemaining", width: 14 },
      { header: "Jours cumulés (plafond 730)", key: "usedDays", width: 26 },
      { header: "Visa", key: "vise", width: 10 },
      { header: "Salaire (FCFA)", key: "salary", width: 16 },
    ]
    sheet.getRow(1).font = { bold: true }

    // Produce the file in the background; the response streams as it is written.
    void (async () => {
      try {
        for await (const batch of streamContractsForExport(query, ctx)) {
          for (const row of batch) {
            sheet
              .addRow({
                matricule: row.employee.matricule,
                lastName: row.employee.lastName,
                firstName: row.employee.firstName,
                position: row.position ?? row.employee.jobTitle ?? "",
                type: row.type,
                status: row.status,
                client: row.client?.name ?? "",
                startDate: formatDate(row.startDate),
                endDate: row.endDate ? formatDate(row.endDate) : "",
                daysRemaining: row.daysRemaining ?? "",
                // "non applicable" rather than 0, for the same reason the meter
                // refuses to draw an empty bar for a CDI.
                usedDays: row.ceiling.applicable ? row.ceiling.usedDays : "non applicable",
                vise: row.isVise ? "Visé" : "En attente",
                salary: row.salary ?? "",
              })
              .commit()
          }
        }
        await workbook.commit()
      } catch (error) {
        console.error("Contract export failed", error)
        await writer.abort(error)
      }
    })()

    const stamp = new Date().toISOString().slice(0, 10)

    return new Response(stream.readable, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="contrats-${firmSlug}-${stamp}.xlsx"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    const status = statusForError(error)
    if (status === 500) throw error
    return new Response(null, { status })
  }
}
