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

const toNumber = (value: bigint | number | null | undefined): number =>
  value === null || value === undefined ? 0 : Number(value)

export async function listDocuments(
  q: DocumentQuery,
  ctx: FirmContext
): Promise<Paged<DocumentRow>> {
  const predicates = buildPredicates(q, ctx)
  const offset = (q.page - 1) * q.perPage

  const idRows = await db.$queryRaw<{ id: string; total_count: bigint }[]>(Prisma.sql`
    SELECT d."id", COUNT(*) OVER() AS total_count
    FROM employee_documents d
    JOIN employees e ON e."id" = d."employeeId"
    WHERE ${whereFrom(predicates)}
    ORDER BY
      (d."expiryDate" IS NOT NULL AND d."expiryDate" < now()) DESC,
      d."expiryDate" ASC NULLS LAST,
      d."isVerified" ASC,
      d."createdAt" DESC
    LIMIT ${q.perPage} OFFSET ${offset}
  `)

  const total = idRows.length ? toNumber(idRows[0].total_count) : 0
  if (idRows.length === 0) {
    return {
      rows: [],
      total: 0,
      page: q.page,
      perPage: q.perPage,
      pageCount: 0,
      facets: await documentFacets(q, ctx),
    }
  }

  const ids = idRows.map((row) => row.id)
  const records = await db.employeeDocument.findMany({
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

  const byId = new Map(records.map((record) => [record.id, record]))

  return {
    rows: ids.flatMap((id) => {
      const record = byId.get(id)
      return record ? [record] : []
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
  expired: number
  expiring: number
  unverified: number
}

export async function documentSummary(
  q: DocumentQuery,
  ctx: FirmContext
): Promise<DocumentSummary> {
  const [row] = await db.$queryRaw<
    { matching: bigint; expired: bigint; expiring: bigint; unverified: bigint }[]
  >(Prisma.sql`
    SELECT
      COUNT(*) AS matching,
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
    expired: toNumber(row?.expired),
    expiring: toNumber(row?.expiring),
    unverified: toNumber(row?.unverified),
  }
}
