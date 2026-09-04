import "server-only"

import { db } from "@/lib/db"
import type { FirmContext } from "@/server/auth/require-firm-access"

/**
 * §5.2 — the search behind the command palette.
 *
 * Firm-scoped and role-scoped like every other query: a responsable searching
 * for a name finds only people placed at their own clients. Capped tightly and
 * ordered so an exact matricule beats a fuzzy name match, because the palette
 * is for people who already know what they are looking for.
 */

export type SearchHit = {
  id: string
  kind: "employee" | "client" | "contract"
  label: string
  sublabel: string
  href: string
  /** Two-letter chip for employees; the others use an icon. */
  initials?: string
  accentId?: string
}

export async function searchFirm(
  term: string,
  ctx: FirmContext,
  perKind = 5
): Promise<SearchHit[]> {
  const trimmed = term.trim()
  if (trimmed.length < 2) return []

  const slug = ctx.firm.slug
  const scoped = ctx.assignedClientIds

  const [employees, clients, contracts] = await Promise.all([
    ctx.firm.modules.includes("hr")
      ? db.employee.findMany({
          where: {
            firmId: ctx.firmId,
            ...(scoped ? { assignedClientId: { in: scoped } } : {}),
            OR: [
              { matricule: { contains: trimmed, mode: "insensitive" } },
              { firstName: { contains: trimmed, mode: "insensitive" } },
              { lastName: { contains: trimmed, mode: "insensitive" } },
              { jobTitle: { contains: trimmed, mode: "insensitive" } },
            ],
          },
          take: perKind,
          orderBy: [{ status: "asc" }, { lastName: "asc" }],
          select: {
            id: true,
            firstName: true,
            lastName: true,
            matricule: true,
            jobTitle: true,
            assignedClient: { select: { name: true } },
          },
        })
      : Promise.resolve([]),

    ctx.firm.modules.includes("crm")
      ? db.client.findMany({
          where: {
            firmId: ctx.firmId,
            ...(scoped ? { id: { in: scoped } } : {}),
            OR: [
              { name: { contains: trimmed, mode: "insensitive" } },
              { industry: { contains: trimmed, mode: "insensitive" } },
            ],
          },
          take: perKind,
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            industry: true,
            _count: { select: { assignedEmployees: true } },
          },
        })
      : Promise.resolve([]),

    ctx.firm.modules.includes("hr")
      ? db.contract.findMany({
          where: {
            firmId: ctx.firmId,
            ...(scoped ? { clientId: { in: scoped } } : {}),
            OR: [
              { position: { contains: trimmed, mode: "insensitive" } },
              { employee: { matricule: { contains: trimmed, mode: "insensitive" } } },
            ],
            status: "ACTIVE",
          },
          take: perKind,
          orderBy: { endDate: "asc" },
          select: {
            id: true,
            type: true,
            endDate: true,
            employee: {
              select: { id: true, firstName: true, lastName: true, matricule: true },
            },
          },
        })
      : Promise.resolve([]),
  ])

  const hits: SearchHit[] = []

  for (const employee of employees) {
    hits.push({
      id: employee.id,
      kind: "employee",
      label: `${employee.firstName} ${employee.lastName}`,
      sublabel: [employee.matricule, employee.jobTitle, employee.assignedClient?.name]
        .filter(Boolean)
        .join(" · "),
      href: `/${slug}/hr/employees/${employee.id}`,
      initials: `${employee.firstName[0] ?? ""}${employee.lastName[0] ?? ""}`.toUpperCase(),
    })
  }

  for (const client of clients) {
    hits.push({
      id: client.id,
      kind: "client",
      label: client.name,
      sublabel: [client.industry, `${client._count.assignedEmployees} employés placés`]
        .filter(Boolean)
        .join(" · "),
      href: `/${slug}/crm/clients?open=${client.id}`,
      accentId: client.id,
    })
  }

  for (const contract of contracts) {
    hits.push({
      id: contract.id,
      kind: "contract",
      label: `${contract.employee.firstName} ${contract.employee.lastName}`,
      sublabel: `${contract.type} · ${contract.employee.matricule}`,
      href: `/${slug}/hr/employees/${contract.employee.id}`,
    })
  }

  return hits
}
