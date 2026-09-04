import "server-only"

import { Prisma } from "@prisma/client"
import { z } from "zod"

import { db } from "@/lib/db"
import type { FirmContext } from "@/server/auth/require-firm-access"
import { clientScopeSql } from "@/server/queries/scope"
import {
  INTERIM_CEILING_DAYS,
  INTERIM_WARNING_DAYS,
  toneFor,
} from "@/server/domain/interim-ceiling"
import {
  paginationSchema,
  sortSpecSchema,
  type Facets,
  type Paged,
  type Selection,
} from "@/server/queries/types"

/* ==========================================================================
 * The query
 *
 * §3.5 — one schema, one resolver. The URL is a serialised ContractQuery, a
 * saved view is a serialised ContractQuery, an export is the same query with a
 * different serialiser, and a bulk action takes the query rather than a list of
 * ids. Nothing here is duplicated per consumer.
 * ========================================================================== */

export const CONTRACT_SORT_IDS = [
  "employee",
  "type",
  "client",
  "period",
  "remaining",
  "ceiling",
  "visa",
  "status",
] as const

export const contractQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  type: z.array(z.enum(["CDI", "CDD", "INTERIM", "STAGE", "PRESTATION"])).optional(),
  status: z.array(z.enum(["ACTIVE", "EXPIRED", "TERMINATED", "RENEWED"])).optional(),
  clientId: z.array(z.string()).optional(),
  departmentId: z.array(z.string()).optional(),
  /** `true` = visa obtained, `false` = still awaiting the labour inspectorate. */
  vise: z.boolean().optional(),
  /** Active contracts whose endDate falls inside this many days. */
  expiringWithin: z.coerce.number().int().min(1).max(400).optional(),
  /** Cumulative interim days, computed in SQL — see `ceilingCte`. */
  interimDaysMin: z.coerce.number().int().min(0).max(2000).optional(),
  interimDaysMax: z.coerce.number().int().min(0).max(2000).optional(),
  sort: z.array(sortSpecSchema).default([]),
  ...paginationSchema,
  columns: z.array(z.string()).optional(),
})

export type ContractQuery = z.infer<typeof contractQuerySchema>

export const EMPTY_CONTRACT_QUERY: ContractQuery = contractQuerySchema.parse({})

/* ==========================================================================
 * Predicates
 *
 * Built one dimension at a time so that a facet can be counted with every
 * filter applied *except its own* — which is what makes the counts in a filter
 * bar mean "how many more would this add", rather than "how many are already
 * showing".
 * ========================================================================== */

type PredicateKey =
  | "tenancy"
  | "scope"
  | "search"
  | "type"
  | "status"
  | "client"
  | "department"
  | "vise"
  | "expiring"
  | "ceiling"

type Predicates = Partial<Record<PredicateKey, Prisma.Sql>>

/**
 * Tenancy and role scoping are not optional and are not keyed by a filter the
 * user controls. `tenancy` is always present; `scope` is present whenever the
 * caller is client-restricted.
 */
function buildPredicates(q: ContractQuery, ctx: FirmContext): Predicates {
  const predicates: Predicates = {
    tenancy: Prisma.sql`c."firmId" = ${ctx.firmId}`,
  }

  const scope = clientScopeSql(ctx, Prisma.sql`c."clientId"`)
  if (scope) predicates.scope = scope

  if (q.search) {
    const term = `%${q.search}%`
    predicates.search = Prisma.sql`(
      e."firstName" ILIKE ${term}
      OR e."lastName" ILIKE ${term}
      OR e."matricule" ILIKE ${term}
      OR c."position" ILIKE ${term}
    )`
  }

  if (q.type?.length) {
    predicates.type = Prisma.sql`c."type"::text IN (${Prisma.join(q.type)})`
  }

  if (q.status?.length) {
    predicates.status = Prisma.sql`c."status"::text IN (${Prisma.join(q.status)})`
  }

  if (q.clientId?.length) {
    predicates.client = Prisma.sql`c."clientId" IN (${Prisma.join(q.clientId)})`
  }

  if (q.departmentId?.length) {
    predicates.department = Prisma.sql`e."departmentId" IN (${Prisma.join(q.departmentId)})`
  }

  if (q.vise !== undefined) {
    predicates.vise = Prisma.sql`c."isVise" = ${q.vise}`
  }

  if (q.expiringWithin !== undefined) {
    predicates.expiring = Prisma.sql`(
      c."status" = 'ACTIVE'
      AND c."endDate" IS NOT NULL
      AND c."endDate" >= now()
      AND c."endDate" <= now() + (${q.expiringWithin}::int * INTERVAL '1 day')
    )`
  }

  const ceilingBounds: Prisma.Sql[] = []
  if (q.interimDaysMin !== undefined) {
    ceilingBounds.push(Prisma.sql`COALESCE(cl.used_days, 0) >= ${q.interimDaysMin}`)
  }
  if (q.interimDaysMax !== undefined) {
    ceilingBounds.push(Prisma.sql`COALESCE(cl.used_days, 0) <= ${q.interimDaysMax}`)
  }
  if (ceilingBounds.length) {
    predicates.ceiling = Prisma.sql`(${Prisma.join(ceilingBounds, " AND ")})`
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

/**
 * Cumulative interim days per employee, within this firm only.
 *
 * The ceiling is per employer (§6), so the CTE is firm-scoped: days worked for
 * another group firm are invisible here by construction, not by convention.
 *
 * `range_agg` unions overlapping contracts so two overlapping periods count
 * once, which a `SUM(endDate - startDate)` would get wrong. Bounds are
 * half-open with `+ 1` on the end so a single-day contract counts as one day.
 *
 * Computing it here rather than in JavaScript is what allows the list to be
 * filtered and sorted by the ceiling in SQL, which §3.6 requires.
 */
function ceilingCte(firmId: string): Prisma.Sql {
  return Prisma.sql`
    interim_periods AS (
      SELECT
        c."employeeId" AS employee_id,
        daterange(c."startDate"::date,
                  (LEAST(COALESCE(c."endDate", now()), now()))::date + 1) AS worked,
        daterange(c."startDate"::date,
                  COALESCE(c."endDate", now())::date + 1) AS contracted
      FROM contracts c
      WHERE c."firmId" = ${firmId}
        AND c."type" = 'INTERIM'
        AND c."startDate" <= now()
    ),
    ceiling AS (
      SELECT
        employee_id,
        (SELECT COALESCE(SUM(upper(r) - lower(r)), 0)
           FROM unnest(range_agg(worked)) r) AS used_days,
        (SELECT COALESCE(SUM(upper(r) - lower(r)), 0)
           FROM unnest(range_agg(contracted)) r) AS projected_days
      FROM interim_periods
      GROUP BY employee_id
    )
  `
}

/**
 * §4.7 — aging is a first-class column and the default sort is urgency, not
 * name. Contracts with no end date (CDI) sort last rather than first.
 */
function orderBy(sort: ContractQuery["sort"]): Prisma.Sql {
  const columns: Record<string, string> = {
    employee: 'e."lastName"',
    type: 'c."type"',
    client: 'cli."name"',
    period: 'c."startDate"',
    remaining: 'c."endDate"',
    ceiling: "used_days",
    visa: 'c."isVise"',
    status: 'c."status"',
  }

  const clauses = sort
    .filter((entry) => entry.id in columns)
    .map((entry) =>
      Prisma.raw(
        `${columns[entry.id]} ${entry.desc ? "DESC" : "ASC"} NULLS LAST`
      )
    )

  if (clauses.length === 0) {
    // §4.7 — default sort is urgency, not name. Running contracts come first,
    // soonest expiry at the top; a contract that ended two years ago is not
    // urgent, so the archive sorts most-recent-first underneath.
    return Prisma.sql`ORDER BY
      (c."status" = 'ACTIVE') DESC,
      CASE WHEN c."status" = 'ACTIVE' THEN c."endDate" END ASC NULLS LAST,
      c."endDate" DESC NULLS LAST,
      used_days DESC NULLS LAST,
      e."lastName" ASC`
  }

  return Prisma.sql`ORDER BY ${Prisma.join(clauses, ", ")}, c."id" ASC`
}

/* ==========================================================================
 * Rows
 * ========================================================================== */

export type ContractRow = {
  id: string
  type: string
  status: string
  startDate: Date
  endDate: Date | null
  isVise: boolean
  position: string | null
  salary: number | null
  /** Days until endDate. Negative when overdue, null for an open-ended contract. */
  daysRemaining: number | null
  employee: {
    id: string
    firstName: string
    lastName: string
    matricule: string
    jobTitle: string | null
    hireDate: Date
  }
  client: { id: string; name: string } | null
  ceiling: {
    applicable: boolean
    usedDays: number
    projectedDays: number
    remainingDays: number
    tone: "brand" | "signal" | "alert"
  }
}

type IdRow = {
  id: string
  used_days: bigint | number | null
  projected_days: bigint | number | null
  total_count: bigint | number
}

const toNumber = (value: bigint | number | null | undefined): number =>
  value === null || value === undefined ? 0 : Number(value)

/* ==========================================================================
 * The resolver
 * ========================================================================== */

/**
 * One page of contracts, its total, and its facet counts.
 *
 * Two round trips, never more: the first selects the ids in the right order
 * with the computed columns and the window count; the second hydrates exactly
 * those rows with an explicit `select`, so nothing is over-fetched and there is
 * no N+1.
 */
export async function listContracts(
  q: ContractQuery,
  ctx: FirmContext
): Promise<Paged<ContractRow>> {
  const predicates = buildPredicates(q, ctx)
  const where = whereFrom(predicates)
  const offset = (q.page - 1) * q.perPage

  const idRows = await db.$queryRaw<IdRow[]>(Prisma.sql`
    WITH ${ceilingCte(ctx.firmId)}
    SELECT
      c."id",
      cl.used_days,
      cl.projected_days,
      COUNT(*) OVER() AS total_count
    FROM contracts c
    JOIN employees e ON e."id" = c."employeeId"
    LEFT JOIN clients cli ON cli."id" = c."clientId"
    LEFT JOIN ceiling cl ON cl.employee_id = c."employeeId"
    WHERE ${where}
    ${orderBy(q.sort)}
    LIMIT ${q.perPage} OFFSET ${offset}
  `)

  const total = idRows.length > 0 ? toNumber(idRows[0].total_count) : 0

  if (idRows.length === 0) {
    return {
      rows: [],
      total: 0,
      page: q.page,
      perPage: q.perPage,
      pageCount: 0,
      facets: await contractFacets(q, ctx),
    }
  }

  const ids = idRows.map((row) => row.id)
  const ceilingById = new Map(
    idRows.map((row) => [
      row.id,
      { used: toNumber(row.used_days), projected: toNumber(row.projected_days) },
    ])
  )

  const records = await db.contract.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      type: true,
      status: true,
      startDate: true,
      endDate: true,
      isVise: true,
      position: true,
      salary: true,
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          matricule: true,
          jobTitle: true,
          hireDate: true,
        },
      },
      client: { select: { id: true, name: true } },
    },
  })

  // Restore the order the database chose; `IN (...)` does not preserve it.
  const byId = new Map(records.map((record) => [record.id, record]))
  const now = Date.now()
  const DAY = 86_400_000

  const rows: ContractRow[] = ids.flatMap((id) => {
    const record = byId.get(id)
    if (!record) return []
    const measured = ceilingById.get(id) ?? { used: 0, projected: 0 }
    const applicable = record.type === "INTERIM"

    return [
      {
        id: record.id,
        type: record.type,
        status: record.status,
        startDate: record.startDate,
        endDate: record.endDate,
        isVise: record.isVise,
        position: record.position,
        salary: record.salary === null ? null : Number(record.salary),
        daysRemaining:
          record.endDate === null
            ? null
            : Math.round((record.endDate.getTime() - now) / DAY),
        employee: record.employee,
        client: record.client,
        ceiling: {
          applicable,
          usedDays: applicable ? measured.used : 0,
          projectedDays: applicable ? measured.projected : 0,
          remainingDays: applicable
            ? Math.max(0, INTERIM_CEILING_DAYS - measured.used)
            : INTERIM_CEILING_DAYS,
          tone: applicable ? toneFor(measured.used) : "brand",
        },
      },
    ]
  })

  return {
    rows,
    total,
    page: q.page,
    perPage: q.perPage,
    pageCount: Math.ceil(total / q.perPage),
    facets: await contractFacets(q, ctx),
  }
}

/* ==========================================================================
 * Facets
 *
 * §3.6 — counts come from grouped SQL, never from counting a fetched array.
 * Each facet is counted with every other filter applied but its own excluded,
 * so ticking a second value in the same facet widens the result rather than
 * narrowing it to nothing.
 * ========================================================================== */

type CountRow = { value: string | null; label: string | null; count: bigint | number }

async function facetCounts(
  predicates: Predicates,
  ctx: FirmContext,
  exclude: PredicateKey,
  valueSql: Prisma.Sql,
  labelSql: Prisma.Sql
): Promise<CountRow[]> {
  return db.$queryRaw<CountRow[]>(Prisma.sql`
    WITH ${ceilingCte(ctx.firmId)}
    SELECT ${valueSql} AS value, ${labelSql} AS label, COUNT(*) AS count
    FROM contracts c
    JOIN employees e ON e."id" = c."employeeId"
    LEFT JOIN clients cli ON cli."id" = c."clientId"
    LEFT JOIN ceiling cl ON cl.employee_id = c."employeeId"
    WHERE ${whereFrom(predicates, [exclude])}
    GROUP BY 1, 2
    ORDER BY count DESC
  `)
}

const TYPE_LABELS: Record<string, string> = {
  CDI: "CDI",
  CDD: "CDD",
  INTERIM: "Intérim",
  STAGE: "Stage",
  PRESTATION: "Prestation",
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Actif",
  EXPIRED: "Expiré",
  TERMINATED: "Résilié",
  RENEWED: "Renouvelé",
}

export async function contractFacets(
  q: ContractQuery,
  ctx: FirmContext
): Promise<Facets> {
  const predicates = buildPredicates(q, ctx)

  const [types, statuses, clients, visa] = await Promise.all([
    facetCounts(predicates, ctx, "type", Prisma.sql`c."type"::text`, Prisma.sql`c."type"::text`),
    facetCounts(predicates, ctx, "status", Prisma.sql`c."status"::text`, Prisma.sql`c."status"::text`),
    facetCounts(predicates, ctx, "client", Prisma.sql`c."clientId"`, Prisma.sql`cli."name"`),
    facetCounts(predicates, ctx, "vise", Prisma.sql`c."isVise"::text`, Prisma.sql`c."isVise"::text`),
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
    client: clients
      .filter((row) => row.value !== null)
      .map((row) => ({
        value: row.value ?? "",
        label: row.label ?? "Client supprimé",
        count: toNumber(row.count),
      })),
    vise: visa.map((row) => ({
      value: row.value ?? "",
      label: row.value === "true" ? "Visé" : "En attente de visa",
      count: toNumber(row.count),
    })),
  }
}

/* ==========================================================================
 * Headline numbers for the panel header and footer
 * ========================================================================== */

export type ContractSummary = {
  matching: number
  active: number
  expiringSoon: number
  atRisk: number
  overCeiling: number
}

/**
 * The stats a Panel header shows. All five are SQL aggregates over the same
 * predicates as the list, so the header cannot disagree with the table.
 */
export async function contractSummary(
  q: ContractQuery,
  ctx: FirmContext
): Promise<ContractSummary> {
  const where = whereFrom(buildPredicates(q, ctx))

  const [row] = await db.$queryRaw<
    {
      matching: bigint
      active: bigint
      expiring_soon: bigint
      at_risk: bigint
      over_ceiling: bigint
    }[]
  >(Prisma.sql`
    WITH ${ceilingCte(ctx.firmId)}
    SELECT
      COUNT(*) AS matching,
      COUNT(*) FILTER (WHERE c."status" = 'ACTIVE') AS active,
      COUNT(*) FILTER (
        WHERE c."status" = 'ACTIVE'
          AND c."endDate" IS NOT NULL
          AND c."endDate" BETWEEN now() AND now() + make_interval(days => c."alertThreshold")
      ) AS expiring_soon,
      COUNT(*) FILTER (
        WHERE c."type" = 'INTERIM'
          AND COALESCE(cl.used_days, 0) >= ${INTERIM_WARNING_DAYS}
          AND COALESCE(cl.used_days, 0) < ${INTERIM_CEILING_DAYS}
      ) AS at_risk,
      COUNT(*) FILTER (
        WHERE c."type" = 'INTERIM' AND COALESCE(cl.used_days, 0) >= ${INTERIM_CEILING_DAYS}
      ) AS over_ceiling
    FROM contracts c
    JOIN employees e ON e."id" = c."employeeId"
    LEFT JOIN clients cli ON cli."id" = c."clientId"
    LEFT JOIN ceiling cl ON cl.employee_id = c."employeeId"
    WHERE ${where}
  `)

  return {
    matching: toNumber(row?.matching),
    active: toNumber(row?.active),
    expiringSoon: toNumber(row?.expiring_soon),
    atRisk: toNumber(row?.at_risk),
    overCeiling: toNumber(row?.over_ceiling),
  }
}

/* ==========================================================================
 * Export
 *
 * The same query with a different serialiser. It streams in batches so a
 * 400-row export and a 40 000-row export cost the same memory, and it goes
 * through the same predicates — including the role scoping — so an export can
 * never contain a row the list would have hidden.
 * ========================================================================== */

export async function* streamContractsForExport(
  q: ContractQuery,
  ctx: FirmContext,
  batchSize = 500
): AsyncGenerator<ContractRow[]> {
  let page = 1

  for (;;) {
    const result = await listContracts(
      { ...q, page, perPage: Math.min(batchSize, 200) },
      ctx
    )
    if (result.rows.length === 0) return
    yield result.rows
    if (result.page >= result.pageCount) return
    page += 1
  }
}

/* ==========================================================================
 * Selection, for bulk actions
 * ========================================================================== */

/**
 * Resolves a selection to concrete contract ids, re-applying the caller's
 * scope. A client-supplied id array is *not* trusted: it is intersected with
 * what this caller may actually see, so a crafted request cannot act on a row
 * the user could never have selected.
 */
export async function resolveContractSelection(
  selection: Selection<ContractQuery>,
  ctx: FirmContext
): Promise<string[]> {
  if ("ids" in selection) {
    const predicates = buildPredicates(EMPTY_CONTRACT_QUERY, ctx)
    const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
      WITH ${ceilingCte(ctx.firmId)}
      SELECT c."id"
      FROM contracts c
      JOIN employees e ON e."id" = c."employeeId"
      LEFT JOIN ceiling cl ON cl.employee_id = c."employeeId"
      WHERE ${whereFrom(predicates)}
        AND c."id" IN (${Prisma.join(selection.ids)})
    `)
    return rows.map((row) => row.id)
  }

  const predicates = buildPredicates(selection.query, ctx)
  const except = selection.except
  const exceptClause = except.length
    ? Prisma.sql`AND c."id" NOT IN (${Prisma.join(except)})`
    : Prisma.empty

  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    WITH ${ceilingCte(ctx.firmId)}
    SELECT c."id"
    FROM contracts c
    JOIN employees e ON e."id" = c."employeeId"
    LEFT JOIN clients cli ON cli."id" = c."clientId"
    LEFT JOIN ceiling cl ON cl.employee_id = c."employeeId"
    WHERE ${whereFrom(predicates)}
    ${exceptClause}
  `)

  return rows.map((row) => row.id)
}
