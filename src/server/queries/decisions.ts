import "server-only"

import { Prisma } from "@prisma/client"

import { db } from "@/lib/db"
import type { FirmContext } from "@/server/auth/require-firm-access"
import {
  INTERIM_CEILING_DAYS,
  INTERIM_WARNING_DAYS,
} from "@/server/domain/interim-ceiling"
import { interimCeilingCte } from "@/server/queries/ceiling-sql"

/**
 * Q10 — the Décisions queue.
 *
 * Not an approvals inbox: everything demanding *this* caller's attention,
 * access-filtered by default like every other query. Scope for now is contracts
 * (ceiling breaches, expiries, missing visa), employees (incomplete records) and
 * documents (expired, expiring, unverified). Leaves and transfers join when
 * those screens land.
 *
 * Aged, and sorted by urgency rather than by name (§4.7): the oldest problem is
 * the one that has been ignored longest.
 */

export type DecisionKind =
  | "ceiling-breach"
  | "ceiling-warning"
  | "contract-expiring"
  | "contract-unvised"
  | "employee-incomplete"
  | "document-expired"
  | "document-unverified"

export type Decision = {
  id: string
  kind: DecisionKind
  /** Group heading in the UI. */
  category: "Plafond légal" | "Contrat" | "Dossier" | "Document"
  title: string
  detail: string
  /** Days this has been outstanding. Drives the default sort. */
  ageDays: number
  tone: "alert" | "signal" | "muted"
  href: string
  employeeId: string | null
}

const DAY = 86_400_000
const toNumber = (value: bigint | number | null | undefined): number =>
  value === null || value === undefined ? 0 : Number(value)

function employeeScope(ctx: FirmContext, alias: string): Prisma.Sql {
  if (ctx.assignedClientIds === null) return Prisma.empty
  if (ctx.assignedClientIds.length === 0) return Prisma.sql`AND false`
  return Prisma.sql`AND ${Prisma.raw(`${alias}."assignedClientId"`)} IN (${Prisma.join(
    ctx.assignedClientIds
  )})`
}

export async function listDecisions(
  ctx: FirmContext,
  limit = 60
): Promise<Decision[]> {
  const slug = ctx.firm.slug
  const now = Date.now()
  const decisions: Decision[] = []

  const hr = ctx.firm.modules.includes("hr")
  const documentsModule = ctx.firm.modules.includes("documents")

  if (hr) {
    /* ---- ceiling: breaches and near-breaches ---------------------------- */
    const ceilingRows = await db.$queryRaw<
      {
        id: string
        first_name: string
        last_name: string
        matricule: string
        used_days: bigint
        client_name: string | null
        since: Date | null
      }[]
    >(Prisma.sql`
      WITH ${interimCeilingCte(ctx.firmId)}
      SELECT
        e."id", e."firstName" AS first_name, e."lastName" AS last_name,
        e."matricule", cl.used_days, cli."name" AS client_name,
        cur."startDate" AS since
      FROM employees e
      JOIN ceiling cl ON cl.employee_id = e."id"
      LEFT JOIN clients cli ON cli."id" = e."assignedClientId"
      LEFT JOIN LATERAL (
        SELECT c."startDate" FROM contracts c
        WHERE c."employeeId" = e."id" AND c."firmId" = ${ctx.firmId} AND c."status" = 'ACTIVE'
        ORDER BY c."startDate" DESC LIMIT 1
      ) cur ON true
      WHERE e."firmId" = ${ctx.firmId}
        AND e."status" = 'ACTIVE'
        AND cl.used_days >= ${INTERIM_WARNING_DAYS}
        ${employeeScope(ctx, "e")}
      ORDER BY cl.used_days DESC
      LIMIT 40
    `)

    for (const row of ceilingRows) {
      const used = toNumber(row.used_days)
      const breach = used >= INTERIM_CEILING_DAYS
      decisions.push({
        id: `ceiling-${row.id}`,
        kind: breach ? "ceiling-breach" : "ceiling-warning",
        category: "Plafond légal",
        title: `${row.first_name} ${row.last_name}`,
        detail: breach
          ? `${used} j cumulés · dépassement de ${used - INTERIM_CEILING_DAYS} j · requalification en CDI à envisager`
          : `${used} j cumulés · ${INTERIM_CEILING_DAYS - used} j de marge`,
        // How long they have been over the line, approximated by how far past
        // the threshold they are — one day over is one day of exposure.
        ageDays: Math.max(0, used - (breach ? INTERIM_CEILING_DAYS : INTERIM_WARNING_DAYS)),
        tone: breach ? "alert" : "signal",
        href: `/${slug}/hr/employees/${row.id}?tab=contrats`,
        employeeId: row.id,
      })
    }

    /* ---- contracts: expiring inside their own alert threshold ----------- */
    const expiring = await db.contract.findMany({
      where: {
        firmId: ctx.firmId,
        status: "ACTIVE",
        endDate: { not: null, gte: new Date() },
        ...(ctx.assignedClientIds ? { clientId: { in: ctx.assignedClientIds } } : {}),
      },
      orderBy: { endDate: "asc" },
      take: 40,
      select: {
        id: true,
        type: true,
        endDate: true,
        alertThreshold: true,
        isVise: true,
        employee: {
          select: { id: true, firstName: true, lastName: true, matricule: true },
        },
        client: { select: { name: true } },
      },
    })

    for (const contract of expiring) {
      if (!contract.endDate) continue
      const daysLeft = Math.round((contract.endDate.getTime() - now) / DAY)
      // §6 — the stored threshold is authoritative, defaulting to 30.
      if (daysLeft > (contract.alertThreshold || 30)) continue

      decisions.push({
        id: `expiry-${contract.id}`,
        kind: "contract-expiring",
        category: "Contrat",
        title: `${contract.employee.firstName} ${contract.employee.lastName}`,
        detail: `${contract.type} · échéance dans ${daysLeft} j${
          contract.client ? ` · ${contract.client.name}` : ""
        }`,
        ageDays: (contract.alertThreshold || 30) - daysLeft,
        tone: daysLeft <= 7 ? "alert" : "signal",
        href: `/${slug}/hr/employees/${contract.employee.id}?tab=contrats`,
        employeeId: contract.employee.id,
      })
    }

    /* ---- contracts awaiting the labour inspectorate visa ---------------- */
    const unvised = await db.contract.findMany({
      where: {
        firmId: ctx.firmId,
        status: "ACTIVE",
        isVise: false,
        ...(ctx.assignedClientIds ? { clientId: { in: ctx.assignedClientIds } } : {}),
      },
      orderBy: { startDate: "asc" },
      take: 25,
      select: {
        id: true,
        type: true,
        startDate: true,
        employee: {
          select: { id: true, firstName: true, lastName: true, matricule: true },
        },
      },
    })

    for (const contract of unvised) {
      const age = Math.round((now - contract.startDate.getTime()) / DAY)
      decisions.push({
        id: `visa-${contract.id}`,
        kind: "contract-unvised",
        category: "Contrat",
        title: `${contract.employee.firstName} ${contract.employee.lastName}`,
        detail: `${contract.type} · visa de l'inspection du travail en attente depuis ${age} j`,
        ageDays: age,
        tone: age > 60 ? "signal" : "muted",
        href: `/${slug}/hr/employees/${contract.employee.id}?tab=contrats`,
        employeeId: contract.employee.id,
      })
    }

    /* ---- incomplete employee records ------------------------------------ */
    const incomplete = await db.employee.findMany({
      where: {
        firmId: ctx.firmId,
        status: "ACTIVE",
        ...(ctx.assignedClientIds
          ? { assignedClientId: { in: ctx.assignedClientIds } }
          : {}),
        OR: [{ cni: null }, { cni: "" }, { AND: [{ phone: null }, { email: null }] }],
      },
      orderBy: { hireDate: "asc" },
      take: 25,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        matricule: true,
        cni: true,
        phone: true,
        email: true,
        hireDate: true,
      },
    })

    for (const employee of incomplete) {
      const missing: string[] = []
      if (!employee.cni) missing.push("CNI")
      if (!employee.phone && !employee.email) missing.push("contact")

      decisions.push({
        id: `record-${employee.id}`,
        kind: "employee-incomplete",
        category: "Dossier",
        title: `${employee.firstName} ${employee.lastName}`,
        detail: `${missing.join(" et ")} manquant${missing.length > 1 ? "s" : ""} · ${employee.matricule}`,
        ageDays: Math.round((now - employee.hireDate.getTime()) / DAY),
        tone: "signal",
        href: `/${slug}/hr/employees/${employee.id}`,
        employeeId: employee.id,
      })
    }
  }

  /* ---- documents -------------------------------------------------------- */
  if (documentsModule) {
    const documents = await db.employeeDocument.findMany({
      where: {
        firmId: ctx.firmId,
        ...(ctx.assignedClientIds
          ? { employee: { assignedClientId: { in: ctx.assignedClientIds } } }
          : {}),
        OR: [
          { expiryDate: { not: null, lt: new Date() } },
          { isVerified: false },
        ],
      },
      orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }],
      take: 40,
      select: {
        id: true,
        documentType: true,
        expiryDate: true,
        isVerified: true,
        createdAt: true,
        employee: { select: { id: true, firstName: true, lastName: true } },
      },
    })

    for (const document of documents) {
      const expired = document.expiryDate !== null && document.expiryDate < new Date()
      decisions.push({
        id: `doc-${document.id}`,
        kind: expired ? "document-expired" : "document-unverified",
        category: "Document",
        title: `${document.employee.firstName} ${document.employee.lastName}`,
        detail: expired
          ? `${document.documentType} expiré depuis ${Math.round((now - (document.expiryDate?.getTime() ?? now)) / DAY)} j`
          : `${document.documentType} en attente de vérification`,
        ageDays: expired
          ? Math.round((now - (document.expiryDate?.getTime() ?? now)) / DAY)
          : Math.round((now - document.createdAt.getTime()) / DAY),
        tone: expired ? "alert" : "muted",
        href: `/${slug}/hr/employees/${document.employee.id}?tab=documents`,
        employeeId: document.employee.id,
      })
    }
  }

  // Alert before warning before note, then oldest first inside each tone.
  const toneRank = { alert: 0, signal: 1, muted: 2 } as const
  decisions.sort(
    (a, b) => toneRank[a.tone] - toneRank[b.tone] || b.ageDays - a.ageDays
  )

  return decisions.slice(0, limit)
}

export async function countDecisions(ctx: FirmContext): Promise<number> {
  const decisions = await listDecisions(ctx, 500)
  return decisions.length
}
