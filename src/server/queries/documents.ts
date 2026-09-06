import "server-only"

import { Prisma } from "@prisma/client"
import { z } from "zod"

import { db } from "@/lib/db"
import { paginationSchema, sortSpecSchema } from "@/lib/queries/query-primitives"
import type { FirmContext } from "@/server/auth/require-firm-access"
import type { Facets, Paged } from "@/server/queries/types"

export const DOCUMENT_TYPES = [
  "CV",
  "ID_CARD",
  "PASSPORT",
  "CONTRACT",
  "PAYSLIP",
  "CERTIFICATE",
  "DIPLOMA",
  "MEDICAL_CERTIFICATE",
  "LEGAL_DOCUMENT",
  "MISSION_REPORT",
  "EXPENSE_RECEIPT",
  "OTHER",
] as const

export const DOCUMENT_FLAGS = ["expired", "expiring", "unverified"] as const

export const documentQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  type: z.array(z.enum(DOCUMENT_TYPES)).optional(),
  flag: z.array(z.enum(DOCUMENT_FLAGS)).optional(),
  employeeId: z.string().optional(),
  sort: z.array(sortSpecSchema).default([]),
  ...paginationSchema,
})

export type DocumentQuery = z.infer<typeof documentQuerySchema>

/**
 * Documents — its own module (Q4), still bound to employees by a real foreign
 * key. Nothing here selects `fileUrl` or `storageKey`: bytes are served through
 * the authenticated file route, and a raw storage URL must never reach the HTML
 * (§3.7).
 */

type PredicateKey = "tenancy" | "scope" | "search" | "type" | "flag" | "employee"
type Predicates = Partial<Record<PredicateKey, Prisma.Sql>>

function buildPredicates(q: DocumentQuery, ctx: FirmContext): Predicates {
  const predicates: Predicates = {
    tenancy: Prisma.sql`d."firmId" = ${ctx.firmId}`,
  }

  if (ctx.assignedClientIds !== null) {
    predicates.scope = ctx.assignedClientIds.length
      ? Prisma.sql`e."assignedClientId" IN (${Prisma.join(ctx.assignedClientIds)})`
      : Prisma.sql`false`
  }

  if (q.search) {
    const term = `%${q.search}%`
    predicates.search = Prisma.sql`(
      d."fileName" ILIKE ${term}
      OR e."firstName" ILIKE ${term}
      OR e."lastName" ILIKE ${term}
      OR e."matricule" ILIKE ${term}
    )`
  }

  if (q.type?.length) {
    predicates.type = Prisma.sql`d."documentType"::text IN (${Prisma.join(q.type)})`
  }

  if (q.employeeId) {
    predicates.employee = Prisma.sql`d."employeeId" = ${q.employeeId}`
  }

  if (q.flag?.length) {
    const clauses = q.flag.map((flag) => {
      if (flag === "expired")
        return Prisma.sql`(d."expiryDate" IS NOT NULL AND d."expiryDate" < now())`
      if (flag === "expiring")
        return Prisma.sql`(d."expiryDate" IS NOT NULL AND d."expiryDate" >= now()
          AND d."expiryDate" <= now() + INTERVAL '60 days')`
      return Prisma.sql`d."isVerified" = false`
    })
    predicates.flag = Prisma.sql`(${Prisma.join(clauses, " OR ")})`
  }

  return predicates
}

function whereFrom(predicates: Predicates, exclude: PredicateKey[] = []): Prisma.Sql {
  const parts = (Object.keys(predicates) as PredicateKey[])
    .filter((key) => !exclude.includes(key))
    .map((key) => predicates[key])
    .filter((part): part is Prisma.Sql => part !== undefined)
  if (parts.length === 0) return Prisma.sql`true`
  return Prisma.join(parts, " AND ")
}

export type DocumentRow = {
  id: string
  documentType: string
  fileName: string
  fileSize: number | null
  mimeType: string | null
  expiryDate: Date | null
  isVerified: boolean
  createdAt: Date
  employee: {
    id: string
    firstName: string
    lastName: string
    matricule: string
  }
}

/**
 * The list groups by employee, so the *page* unit is a person and not a piece.
 * Paging by document would cut a group in half — eight documents for one
 * employee, five at the foot of page 1 and three at the head of page 2, drawn
 * as two separate people — so the window is taken over employees and every
 * matching document for the employees in it is fetched whole.
 */
export type DocumentGroup = {
  employee: DocumentRow["employee"]
  documents: DocumentRow[]
  /** Counts over the group, for the collapsed row. */
  expired: number
  unverified: number
  /** Soonest expiry among the group's documents, for the collapsed row. */
  nextExpiry: Date | null
  totalSize: number
}

const toNumber = (value: bigint | number | null | undefined): number =>
  value === null || value === undefined ? 0 : Number(value)

export async function listDocuments(
  q: DocumentQuery,
  ctx: FirmContext
): Promise<Paged<DocumentGroup>> {
  const predicates = buildPredicates(q, ctx)
  const offset = (q.page - 1) * q.perPage

  /* One row per employee, ordered so the people who need attention surface
     first: anyone holding an expired piece, then the soonest expiry, then
     whoever has the most unverified pieces. `total_count` counts employees,
     which is what the pager now walks. */
  const employeeRows = await db.$queryRaw<{ id: string; total_count: bigint }[]>(Prisma.sql`
    SELECT
      e."id",
      COUNT(*) OVER() AS total_count
    FROM employees e
    JOIN employee_documents d ON d."employeeId" = e."id"
    WHERE ${whereFrom(predicates)}
    GROUP BY e."id", e."lastName", e."firstName"
    ORDER BY
      COUNT(*) FILTER (
        WHERE d."expiryDate" IS NOT NULL AND d."expiryDate" < now()
      ) > 0 DESC,
      MIN(d."expiryDate") ASC NULLS LAST,
      COUNT(*) FILTER (WHERE d."isVerified" = false) DESC,
      e."lastName" ASC,
      e."firstName" ASC
    LIMIT ${q.perPage} OFFSET ${offset}
  `)

  const total = employeeRows.length ? toNumber(employeeRows[0].total_count) : 0
  if (employeeRows.length === 0) {
    return {
      rows: [],
      total: 0,
      page: q.page,
      perPage: q.perPage,
      pageCount: 0,
      facets: await documentFacets(q, ctx),
    }
  }

  const employeeIds = employeeRows.map((row) => row.id)

  /* The documents themselves, still filtered by the same predicates so a type
     or state filter narrows what hangs under each person — but unpaged, so a
     group is never truncated. */
  const documentIds = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT d."id"
    FROM employee_documents d
    JOIN employees e ON e."id" = d."employeeId"
    WHERE ${whereFrom(predicates)}
      AND d."employeeId" IN (${Prisma.join(employeeIds)})
    ORDER BY
      (d."expiryDate" IS NOT NULL AND d."expiryDate" < now()) DESC,
      d."expiryDate" ASC NULLS LAST,
      d."isVerified" ASC,
      d."createdAt" DESC
  `)

  const ids = documentIds.map((row) => row.id)
  const records = ids.length
    ? await db.employeeDocument.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          documentType: true,
          fileName: true,
          fileSize: true,
          mimeType: true,
          expiryDate: true,
          isVerified: true,
          createdAt: true,
          employee: {
            select: { id: true, firstName: true, lastName: true, matricule: true },
          },
        },
      })
    : []

  const byId = new Map(records.map((record) => [record.id, record]))
  const now = new Date()

  const groups = new Map<string, DocumentGroup>()
  for (const id of ids) {
    const record = byId.get(id)
    if (!record) continue

    let group = groups.get(record.employee.id)
    if (!group) {
      group = {
        employee: record.employee,
        documents: [],
        expired: 0,
        unverified: 0,
        nextExpiry: null,
        totalSize: 0,
      }
      groups.set(record.employee.id, group)
    }

    group.documents.push(record)
    if (record.expiryDate && record.expiryDate < now) group.expired += 1
    if (!record.isVerified) group.unverified += 1
    if (
      record.expiryDate &&
      (group.nextExpiry === null || record.expiryDate < group.nextExpiry)
    ) {
      group.nextExpiry = record.expiryDate
    }
    group.totalSize += record.fileSize ?? 0
  }

  return {
    // Ordered by the employee window, not by map insertion.
    rows: employeeIds.flatMap((id) => {
      const group = groups.get(id)
      return group ? [group] : []
    }),
    total,
    page: q.page,
    perPage: q.perPage,
    pageCount: Math.ceil(total / q.perPage),
    facets: await documentFacets(q, ctx),
  }
}

const TYPE_LABELS: Record<string, string> = {
  CV: "CV",
  ID_CARD: "Copie CNI",
  PASSPORT: "Passeport",
  CONTRACT: "Contrat de travail",
  PAYSLIP: "Bulletin de paie",
  CERTIFICATE: "Attestation",
  DIPLOMA: "Diplôme",
  MEDICAL_CERTIFICATE: "Certificat médical",
  LEGAL_DOCUMENT: "Document légal",
  MISSION_REPORT: "Rapport de mission",
  EXPENSE_RECEIPT: "Justificatif de frais",
  OTHER: "Autre",
}

export async function documentFacets(
  q: DocumentQuery,
  ctx: FirmContext
): Promise<Facets> {
  const predicates = buildPredicates(q, ctx)

  const types = await db.$queryRaw<{ value: string; count: bigint }[]>(Prisma.sql`
    SELECT d."documentType"::text AS value, COUNT(*) AS count
    FROM employee_documents d
    JOIN employees e ON e."id" = d."employeeId"
    WHERE ${whereFrom(predicates, ["type"])}
    GROUP BY 1 ORDER BY count DESC
  `)

  const [flags] = await db.$queryRaw<
    { expired: bigint; expiring: bigint; unverified: bigint }[]
  >(Prisma.sql`
    SELECT
      COUNT(*) FILTER (WHERE d."expiryDate" IS NOT NULL AND d."expiryDate" < now()) AS expired,
      COUNT(*) FILTER (
        WHERE d."expiryDate" IS NOT NULL
          AND d."expiryDate" >= now()
          AND d."expiryDate" <= now() + INTERVAL '60 days'
      ) AS expiring,
      COUNT(*) FILTER (WHERE d."isVerified" = false) AS unverified
    FROM employee_documents d
    JOIN employees e ON e."id" = d."employeeId"
    WHERE ${whereFrom(predicates, ["flag"])}
  `)

  return {
    type: types.map((row) => ({
      value: row.value,
      label: TYPE_LABELS[row.value] ?? row.value,
      count: toNumber(row.count),
    })),
    flag: [
      { value: "expired", label: "Expirés", count: toNumber(flags?.expired) },
      { value: "expiring", label: "Expirent sous 60 j", count: toNumber(flags?.expiring) },
      { value: "unverified", label: "Non vérifiés", count: toNumber(flags?.unverified) },
    ],
  }
}

export type DocumentSummary = {
  matching: number
  /** Distinct employees holding a matching piece — the unit the pager walks. */
  employees: number
  expired: number
  expiring: number
  unverified: number
}

export async function documentSummary(
  q: DocumentQuery,
  ctx: FirmContext
): Promise<DocumentSummary> {
  const [row] = await db.$queryRaw<
    {
      matching: bigint
      employees: bigint
      expired: bigint
      expiring: bigint
      unverified: bigint
    }[]
  >(Prisma.sql`
    SELECT
      COUNT(*) AS matching,
      COUNT(DISTINCT d."employeeId") AS employees,
      COUNT(*) FILTER (WHERE d."expiryDate" IS NOT NULL AND d."expiryDate" < now()) AS expired,
      COUNT(*) FILTER (
        WHERE d."expiryDate" IS NOT NULL
          AND d."expiryDate" >= now()
          AND d."expiryDate" <= now() + INTERVAL '60 days'
      ) AS expiring,
      COUNT(*) FILTER (WHERE d."isVerified" = false) AS unverified
    FROM employee_documents d
    JOIN employees e ON e."id" = d."employeeId"
    WHERE ${whereFrom(buildPredicates(q, ctx))}
  `)

  return {
    matching: toNumber(row?.matching),
    employees: toNumber(row?.employees),
    expired: toNumber(row?.expired),
    expiring: toNumber(row?.expiring),
    unverified: toNumber(row?.unverified),
  }
}
