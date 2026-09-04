import "server-only"

import { Prisma } from "@prisma/client"
import { z } from "zod"

import { db } from "@/lib/db"
import { paginationSchema, sortSpecSchema } from "@/lib/queries/query-primitives"
import type { FirmContext } from "@/server/auth/require-firm-access"
import type { Facets, Paged } from "@/server/queries/types"

export const LEAVE_TYPES = [
  "ANNUAL",
  "SICK",
  "MATERNITY",
  "PATERNITY",
  "UNPAID",
  "SPECIAL",
  "COMPENSATORY",
] as const

export const LEAVE_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const

export const leaveQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  type: z.array(z.enum(LEAVE_TYPES)).optional(),
  status: z.array(z.enum(LEAVE_STATUSES)).optional(),
  /** ISO month, `2026-09`, for the calendar view. */
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  sort: z.array(sortSpecSchema).default([]),
  ...paginationSchema,
})

export type LeaveQuery = z.infer<typeof leaveQuerySchema>

/**
 * Leave requests.
 *
 * Same contract as every other list. The month filter serves the calendar
 * (§5.6): the calendar and the table are the same query rendered two ways, so
 * they can never show different sets.
 */

type PredicateKey = "tenancy" | "scope" | "search" | "type" | "status" | "month"
type Predicates = Partial<Record<PredicateKey, Prisma.Sql>>

function buildPredicates(q: LeaveQuery, ctx: FirmContext): Predicates {
  const predicates: Predicates = {
    tenancy: Prisma.sql`l."firmId" = ${ctx.firmId}`,
  }

  if (ctx.assignedClientIds !== null) {
    predicates.scope = ctx.assignedClientIds.length
      ? Prisma.sql`e."assignedClientId" IN (${Prisma.join(ctx.assignedClientIds)})`
      : Prisma.sql`false`
  }

  if (q.search) {
    const term = `%${q.search}%`
    predicates.search = Prisma.sql`(
      e."firstName" ILIKE ${term} OR e."lastName" ILIKE ${term} OR e."matricule" ILIKE ${term}
    )`
  }

  if (q.type?.length) {
    predicates.type = Prisma.sql`l."leaveType"::text IN (${Prisma.join(q.type)})`
  }

  if (q.status?.length) {
    predicates.status = Prisma.sql`l."status"::text IN (${Prisma.join(q.status)})`
  }

  if (q.month) {
    // Any overlap with the month, not just requests starting inside it — a
    // three-week leave spanning a month boundary belongs to both months.
    predicates.month = Prisma.sql`(
      l."startDate" < (${`${q.month}-01`}::date + INTERVAL '1 month')
      AND l."endDate" >= ${`${q.month}-01`}::date
    )`
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

export type LeaveRow = {
  id: string
  leaveType: string
  status: string
  startDate: Date
  endDate: Date
  totalDays: number
  isPaid: boolean
  requestedAt: Date
  /** Days a PENDING request has been waiting. §4.7 makes aging first class. */
  waitingDays: number | null
  reason: string | null
  employee: {
    id: string
    firstName: string
    lastName: string
    matricule: string
    clientName: string | null
  }
}

const toNumber = (value: bigint | number | string | null | undefined): number =>
  value === null || value === undefined ? 0 : Number(value)

export async function listLeaves(
  q: LeaveQuery,
  ctx: FirmContext
): Promise<Paged<LeaveRow>> {
  const predicates = buildPredicates(q, ctx)
  const offset = (q.page - 1) * q.perPage

  const idRows = await db.$queryRaw<{ id: string; total_count: bigint }[]>(Prisma.sql`
    SELECT l."id", COUNT(*) OVER() AS total_count
    FROM leave_requests l
    JOIN employees e ON e."id" = l."employeeId"
    WHERE ${whereFrom(predicates)}
    ORDER BY
      (l."status" = 'PENDING') DESC,
      l."requestedAt" ASC,
      l."startDate" DESC
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
      facets: await leaveFacets(q, ctx),
    }
  }

  const ids = idRows.map((row) => row.id)
  const records = await db.leaveRequest.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      leaveType: true,
      status: true,
      startDate: true,
      endDate: true,
      totalDays: true,
      isPaid: true,
      requestedAt: true,
      reason: true,
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          matricule: true,
          assignedClient: { select: { name: true } },
        },
      },
    },
  })

  const byId = new Map(records.map((record) => [record.id, record]))
  const now = Date.now()

  return {
    rows: ids.flatMap((id) => {
      const record = byId.get(id)
      if (!record) return []
      return [
        {
          id: record.id,
          leaveType: record.leaveType,
          status: record.status,
          startDate: record.startDate,
          endDate: record.endDate,
          totalDays: Number(record.totalDays),
          isPaid: record.isPaid,
          requestedAt: record.requestedAt,
          waitingDays:
            record.status === "PENDING"
              ? Math.round((now - record.requestedAt.getTime()) / 86_400_000)
              : null,
          reason: record.reason,
          employee: {
            id: record.employee.id,
            firstName: record.employee.firstName,
            lastName: record.employee.lastName,
            matricule: record.employee.matricule,
            clientName: record.employee.assignedClient?.name ?? null,
          },
        },
      ]
    }),
    total,
    page: q.page,
    perPage: q.perPage,
    pageCount: Math.ceil(total / q.perPage),
    facets: await leaveFacets(q, ctx),
  }
}

const TYPE_LABELS: Record<string, string> = {
  ANNUAL: "Annuel",
  SICK: "Maladie",
  MATERNITY: "Maternité",
  PATERNITY: "Paternité",
  UNPAID: "Sans solde",
  SPECIAL: "Spécial",
  COMPENSATORY: "Récupération",
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: "En attente",
  APPROVED: "Approuvé",
  REJECTED: "Refusé",
  CANCELLED: "Annulé",
}

export async function leaveFacets(q: LeaveQuery, ctx: FirmContext): Promise<Facets> {
  const predicates = buildPredicates(q, ctx)

  const run = (exclude: PredicateKey, column: Prisma.Sql) =>
    db.$queryRaw<{ value: string | null; count: bigint }[]>(Prisma.sql`
      SELECT ${column} AS value, COUNT(*) AS count
      FROM leave_requests l
      JOIN employees e ON e."id" = l."employeeId"
      WHERE ${whereFrom(predicates, [exclude])}
      GROUP BY 1 ORDER BY count DESC
    `)

  const [types, statuses] = await Promise.all([
    run("type", Prisma.sql`l."leaveType"::text`),
    run("status", Prisma.sql`l."status"::text`),
  ])

  return {
    type: types.map((row) => ({
      value: row.value ?? "",
      label: TYPE_LABELS[row.value ?? ""] ?? row.value ?? "",
      count: toNumber(row.count),
    })),
    status: statuses.map((row) => ({
      value: row.value ?? "",
      label: STATUS_LABELS[row.value ?? ""] ?? row.value ?? "",
      count: toNumber(row.count),
    })),
  }
}

export type LeaveSummary = {
  matching: number
  pending: number
  daysThisMonth: number
  oldestWaitingDays: number
}

export async function leaveSummary(
  q: LeaveQuery,
  ctx: FirmContext
): Promise<LeaveSummary> {
  const [row] = await db.$queryRaw<
    {
      matching: bigint
      pending: bigint
      days_month: string | null
      oldest: Date | null
    }[]
  >(Prisma.sql`
    SELECT
      COUNT(*) AS matching,
      COUNT(*) FILTER (WHERE l."status" = 'PENDING') AS pending,
      COALESCE(SUM(l."totalDays") FILTER (
        WHERE l."status" = 'APPROVED'
          AND l."startDate" < date_trunc('month', now()) + INTERVAL '1 month'
          AND l."endDate" >= date_trunc('month', now())
      ), 0) AS days_month,
      MIN(l."requestedAt") FILTER (WHERE l."status" = 'PENDING') AS oldest
    FROM leave_requests l
    JOIN employees e ON e."id" = l."employeeId"
    WHERE ${whereFrom(buildPredicates(q, ctx))}
  `)

  return {
    matching: toNumber(row?.matching),
    pending: toNumber(row?.pending),
    daysThisMonth: toNumber(row?.days_month),
    oldestWaitingDays: row?.oldest
      ? Math.round((Date.now() - row.oldest.getTime()) / 86_400_000)
      : 0,
  }
}

/**
 * Every leave overlapping a month, for the calendar. Capped, because a calendar
 * that renders 900 bars is not a calendar.
 */
export async function leavesInMonth(month: string, ctx: FirmContext) {
  return listLeaves(
    leaveQuerySchema.parse({ month, perPage: 200, status: ["APPROVED", "PENDING"] }),
    ctx
  )
}
