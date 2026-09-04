import "server-only"

import { Prisma } from "@prisma/client"

import { db } from "@/lib/db"
import { type ClientQuery } from "@/lib/queries/client-query"
import type { FirmContext } from "@/server/auth/require-firm-access"
import type { Facets, Paged } from "@/server/queries/types"

export {
  clientQuerySchema,
  EMPTY_CLIENT_QUERY,
  type ClientQuery,
} from "@/lib/queries/client-query"

/**
 * Clients — the CRM list.
 *
 * The counts a portfolio screen lives on (employees placed, active contracts,
 * monthly payroll, next expiry) are aggregates over `employees` and
 * `contracts`, so they are computed in SQL alongside the row rather than
 * fetched per client. Doing it per row is exactly the N+1 §3.6 forbids.
 */

type PredicateKey = "tenancy" | "scope" | "search" | "status" | "industry" | "expiring"
type Predicates = Partial<Record<PredicateKey, Prisma.Sql>>

function buildPredicates(q: ClientQuery, ctx: FirmContext): Predicates {
  const predicates: Predicates = {
    tenancy: Prisma.sql`cl."firmId" = ${ctx.firmId}`,
  }

  // A client-scoped caller sees only their own accounts — including here, so
  // the CRM list cannot become a directory of every client in the firm.
  if (ctx.assignedClientIds !== null) {
    predicates.scope = ctx.assignedClientIds.length
      ? Prisma.sql`cl."id" IN (${Prisma.join(ctx.assignedClientIds)})`
      : Prisma.sql`false`
  }

  if (q.search) {
    const term = `%${q.search}%`
    predicates.search = Prisma.sql`(
      cl."name" ILIKE ${term}
      OR cl."industry" ILIKE ${term}
      OR cl."contactName" ILIKE ${term}
    )`
  }

  if (q.status?.length) {
    predicates.status = Prisma.sql`cl."status"::text IN (${Prisma.join(q.status)})`
  }

  if (q.industry?.length) {
    predicates.industry = Prisma.sql`cl."industry" IN (${Prisma.join(q.industry)})`
  }

  if (q.expiringWithin !== undefined) {
    predicates.expiring = Prisma.sql`stats.next_expiry IS NOT NULL
      AND stats.next_expiry <= (now() + (${q.expiringWithin}::int * INTERVAL '1 day'))`
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

/** Per-client aggregates, computed once for the whole page. */
function statsJoin(firmId: string): Prisma.Sql {
  return Prisma.sql`
    LEFT JOIN LATERAL (
      SELECT
        COUNT(DISTINCT e."id") FILTER (WHERE e."status" = 'ACTIVE') AS placed,
        COALESCE(SUM(e."netSalary") FILTER (WHERE e."status" = 'ACTIVE'), 0) AS payroll
      FROM employees e
      WHERE e."assignedClientId" = cl."id" AND e."firmId" = ${firmId}
    ) headcount ON true
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE c."status" = 'ACTIVE') AS active_contracts,
        MIN(c."endDate") FILTER (WHERE c."status" = 'ACTIVE' AND c."endDate" >= now())
          AS next_expiry
      FROM contracts c
      WHERE c."clientId" = cl."id" AND c."firmId" = ${firmId}
    ) stats ON true
  `
}

function orderBy(sort: ClientQuery["sort"]): Prisma.Sql {
  const columns: Record<string, string> = {
    name: 'cl."name"',
    status: 'cl."status"',
    placed: "headcount.placed",
    payroll: "headcount.payroll",
    nextExpiry: "stats.next_expiry",
  }

  const clauses = sort
    .filter((entry) => entry.id in columns)
    .map((entry) =>
      Prisma.raw(`${columns[entry.id]} ${entry.desc ? "DESC" : "ASC"} NULLS LAST`)
    )

  if (clauses.length === 0) {
    // Largest accounts first: a portfolio screen is read top-down by weight.
    return Prisma.sql`ORDER BY headcount.placed DESC NULLS LAST, cl."name" ASC`
  }
  return Prisma.sql`ORDER BY ${Prisma.join(clauses, ", ")}, cl."id" ASC`
}

export type ClientRow = {
  id: string
  name: string
  status: string
  industry: string | null
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  address: string | null
  since: Date | null
  placed: number
  activeContracts: number
  monthlyPayroll: number
  nextExpiry: Date | null
  daysToNextExpiry: number | null
}

type RawRow = {
  id: string
  name: string
  status: string
  industry: string | null
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  address: string | null
  since: Date | null
  placed: bigint | number | null
  payroll: string | number | null
  active_contracts: bigint | number | null
  next_expiry: Date | null
  total_count: bigint | number
}

const toNumber = (value: bigint | number | string | null | undefined): number =>
  value === null || value === undefined ? 0 : Number(value)

const DAY = 86_400_000

export async function listClients(
  q: ClientQuery,
  ctx: FirmContext
): Promise<Paged<ClientRow>> {
  const predicates = buildPredicates(q, ctx)
  const offset = (q.page - 1) * q.perPage

  const rows = await db.$queryRaw<RawRow[]>(Prisma.sql`
    SELECT
      cl."id", cl."name", cl."status"::text AS status, cl."industry",
      cl."contactName", cl."contactEmail", cl."contactPhone", cl."address",
      cl."contractStartDate" AS since,
      headcount.placed, headcount.payroll,
      stats.active_contracts, stats.next_expiry,
      COUNT(*) OVER() AS total_count
    FROM clients cl
    ${statsJoin(ctx.firmId)}
    WHERE ${whereFrom(predicates)}
    ${orderBy(q.sort)}
    LIMIT ${q.perPage} OFFSET ${offset}
  `)

  const total = rows.length > 0 ? toNumber(rows[0].total_count) : 0
  const now = Date.now()

  return {
    rows: rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      industry: row.industry,
      contactName: row.contactName,
      contactEmail: row.contactEmail,
      contactPhone: row.contactPhone,
      address: row.address,
      since: row.since,
      placed: toNumber(row.placed),
      activeContracts: toNumber(row.active_contracts),
      monthlyPayroll: toNumber(row.payroll),
      nextExpiry: row.next_expiry,
      daysToNextExpiry: row.next_expiry
        ? Math.round((row.next_expiry.getTime() - now) / DAY)
        : null,
    })),
    total,
    page: q.page,
    perPage: q.perPage,
    pageCount: Math.ceil(total / q.perPage),
    facets: await clientFacets(q, ctx),
  }
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Actif",
  INACTIVE: "Inactif",
  PROSPECT: "Prospect",
  ARCHIVED: "Archivé",
}

export async function clientFacets(
  q: ClientQuery,
  ctx: FirmContext
): Promise<Facets> {
  const predicates = buildPredicates(q, ctx)

  const run = (exclude: PredicateKey, column: Prisma.Sql) =>
    db.$queryRaw<{ value: string | null; count: bigint }[]>(Prisma.sql`
      SELECT ${column} AS value, COUNT(*) AS count
      FROM clients cl
      ${statsJoin(ctx.firmId)}
      WHERE ${whereFrom(predicates, [exclude])}
      GROUP BY 1
      ORDER BY count DESC
    `)

  const [statuses, industries] = await Promise.all([
    run("status", Prisma.sql`cl."status"::text`),
    run("industry", Prisma.sql`cl."industry"`),
  ])

  return {
    status: statuses.map((row) => ({
      value: row.value ?? "",
      label: STATUS_LABELS[row.value ?? ""] ?? row.value ?? "",
      count: toNumber(row.count),
    })),
    industry: industries
      .filter((row) => row.value !== null)
      .map((row) => ({
        value: row.value ?? "",
        label: row.value ?? "",
        count: toNumber(row.count),
      })),
  }
}

export type ClientSummary = {
  matching: number
  active: number
  placed: number
  monthlyPayroll: number
}

export async function clientSummary(
  q: ClientQuery,
  ctx: FirmContext
): Promise<ClientSummary> {
  const [row] = await db.$queryRaw<
    { matching: bigint; active: bigint; placed: bigint; payroll: string | null }[]
  >(Prisma.sql`
    SELECT
      COUNT(*) AS matching,
      COUNT(*) FILTER (WHERE cl."status" = 'ACTIVE') AS active,
      COALESCE(SUM(headcount.placed), 0) AS placed,
      COALESCE(SUM(headcount.payroll), 0) AS payroll
    FROM clients cl
    ${statsJoin(ctx.firmId)}
    WHERE ${whereFrom(buildPredicates(q, ctx))}
  `)

  return {
    matching: toNumber(row?.matching),
    active: toNumber(row?.active),
    placed: toNumber(row?.placed),
    monthlyPayroll: toNumber(row?.payroll),
  }
}

/**
 * The employees placed at one client, for the drawer. Scoped twice over: the
 * firm, and the caller's own client assignments.
 */
export async function clientPlacements(
  clientId: string,
  ctx: FirmContext,
  limit = 25
) {
  if (ctx.assignedClientIds !== null && !ctx.assignedClientIds.includes(clientId)) {
    return []
  }

  return db.employee.findMany({
    where: { firmId: ctx.firmId, assignedClientId: clientId, status: "ACTIVE" },
    orderBy: { lastName: "asc" },
    take: limit,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      matricule: true,
      jobTitle: true,
    },
  })
}

export async function streamClientsForExport(
  q: ClientQuery,
  ctx: FirmContext
): Promise<ClientRow[]> {
  // A firm has tens of clients, not thousands: one page is the whole list.
  const result = await listClients({ ...q, page: 1, perPage: 200 }, ctx)
  return result.rows
}
