import { requireFirmAccess, requireModule } from "@/server/auth/require-firm-access"
import { statusForError } from "@/server/errors"
import {
  loadEmployeeSearchParams,
  toEmployeeQuery,
} from "@/lib/queries/employee-params"
import { streamEmployeesForExport } from "@/server/queries/employees"
import { formatDate } from "@/lib/format"
import { streamXlsx } from "@/server/export/xlsx"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Same query, different serialiser (§3.5). The scope is inherited from the
 * resolver, so an export can never contain a row the list would have hidden.
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
    const query = toEmployeeQuery(loadEmployeeSearchParams(url.searchParams))

    return streamXlsx({
      sheetName: "Employés",
      fileName: `employes-${firmSlug}`,
      columns: [
        { header: "Matricule", key: "matricule", width: 14 },
        { header: "Nom", key: "lastName", width: 18 },
        { header: "Prénom", key: "firstName", width: 18 },
        { header: "Poste", key: "jobTitle", width: 28 },
        { header: "Statut", key: "status", width: 12 },
        { header: "Client", key: "client", width: 24 },
        { header: "Département", key: "department", width: 18 },
        { header: "Embauche", key: "hireDate", width: 12 },
        { header: "Ancienneté (jours)", key: "seniority", width: 18 },
        { header: "Contrat en cours", key: "contract", width: 16 },
        { header: "Fin de contrat", key: "contractEnd", width: 14 },
        { header: "Jours cumulés (plafond 730)", key: "usedDays", width: 26 },
        { header: "Téléphone", key: "phone", width: 18 },
        { header: "Email", key: "email", width: 26 },
        { header: "Pièces manquantes", key: "missing", width: 22 },
      ],
      rows: async function* () {
        for await (const batch of streamEmployeesForExport(query, ctx)) {
          for (const row of batch) {
            yield {
              matricule: row.matricule,
              lastName: row.lastName,
              firstName: row.firstName,
              jobTitle: row.jobTitle ?? "",
              status: row.status,
              client: row.client?.name ?? "",
              department: row.department?.name ?? "",
              hireDate: formatDate(row.hireDate),
              seniority: row.seniorityDays,
              contract: row.currentContract?.type ?? "aucun",
              contractEnd: row.currentContract?.endDate
                ? formatDate(row.currentContract.endDate)
                : "",
              usedDays: row.ceiling.applicable
                ? row.ceiling.usedDays
                : "non applicable",
              phone: row.phone ?? "",
              email: row.email ?? "",
              missing: row.missing.join(", "),
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
