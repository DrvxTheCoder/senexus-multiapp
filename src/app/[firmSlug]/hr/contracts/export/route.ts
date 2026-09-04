import { requireFirmAccess, requireModule } from "@/server/auth/require-firm-access"
import { statusForError } from "@/server/errors"
import {
  loadContractSearchParams,
  toContractQuery,
} from "@/lib/queries/contract-params"
import { streamContractsForExport } from "@/server/queries/contracts"
import { formatDate } from "@/lib/format"
import { streamXlsx } from "@/server/export/xlsx"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * §3.5 — export is the same query with a different serialiser.
 *
 * It parses the identical URL parameters the page does and runs the identical
 * resolver, so it inherits the identical role scoping. There is no separate
 * export query that could forget a filter, and no way for an export to contain
 * a row the list would have hidden.
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

    return streamXlsx({
      sheetName: "Contrats",
      fileName: `contrats-${firmSlug}`,
      columns: [
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
      ],
      rows: async function* () {
        for await (const batch of streamContractsForExport(query, ctx)) {
          for (const row of batch) {
            yield {
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
              usedDays: row.ceiling.applicable
                ? row.ceiling.usedDays
                : "non applicable",
              vise: row.isVise ? "Visé" : "En attente",
              salary: row.salary ?? "",
            }
          }
        }
      },
    })
  } catch (error) {
    const status = statusForError(error)
    if (status === 500) throw error
    return new Response(null, { status })
  }
}
