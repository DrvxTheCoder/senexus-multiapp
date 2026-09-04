import "server-only"

import { Prisma } from "@prisma/client"

import { db } from "@/lib/db"
import {
  EMPTY_EMPLOYEE_QUERY,
  type EmployeeQuery,
} from "@/lib/queries/employee-query"
import type { FirmContext } from "@/server/auth/require-firm-access"
import { clientScopeSql } from "@/server/queries/scope"
import {
  INTERIM_CEILING_DAYS,
  INTERIM_WARNING_DAYS,
  toneFor,
} from "@/server/domain/interim-ceiling"
import { interimCeilingCte } from "@/server/queries/ceiling-sql"
import type { Facets, Paged, Selection } from "@/server/queries/types"

export {
  employeeQuerySchema,
  EMPTY_EMPLOYEE_QUERY,
  EMPLOYEE_SORT_IDS,
  type EmployeeQuery,
} from "@/lib/queries/employee-query"

/* ==========================================================================
 * Predicates
 * ========================================================================== */

type PredicateKey =
  | "tenancy"
  | "scope"
  | "search"
  | "status"
  | "contractType"
  | "client"
  | "department"
  | "ceiling"
  | "incomplete"

type Predicates = Partial<Record<PredicateKey, Prisma.Sql>>

function buildPredicates(q: EmployeeQuery, ctx: FirmContext): Predicates {
  const predicates: Predicates = {
    tenancy: Prisma.sql`e."firmId" = ${ctx.firmId}`,
  }

  // §3.5 — the scope is part of the where-builder, so list, facets, export and
  // bulk actions inherit it without any of them remembering to.
  const scope = clientScopeSql(ctx, Prisma.sql`e."assignedClientId"`)
  if (scope) predicates.scope = scope

  if (q.search) {
    const term = `%${q.search}%`
    predicates.search = Prisma.sql`(
      e."firstName" ILIKE ${term}
      OR e."lastName" ILIKE ${term}
      OR e."matricule" ILIKE ${term}
      OR e."jobTitle" ILIKE ${term}
      OR e."email" ILIKE ${term}
    )`
  }

  if (q.status?.length) {
    predicates.status = Prisma.sql`e."status"::text IN (${Prisma.join(q.status)})`
  }

  if (q.contractType?.length) {
    predicates.contractType = Prisma.sql`cur.type::text IN (${Prisma.join(q.contractType)})`
  }

  if (q.clientId?.length) {
    predicates.client = Prisma.sql`e."assignedClientId" IN (${Prisma.join(q.clientId)})`
  }

  if (q.departmentId?.length) {
    predicates.department = Prisma.sql`e."departmentId" IN (${Prisma.join(q.departmentId)})`
  }

  const bounds: Prisma.Sql[] = []
  if (q.interimDaysMin !== undefined) {
    bounds.push(Prisma.sql`COALESCE(cl.used_days, 0) >= ${q.interimDaysMin}`)
  }
  if (q.interimDaysMax !== undefined) {
    bounds.push(Prisma.sql`COALESCE(cl.used_days, 0) <= ${q.interimDaysMax}`)
  }
  if (bounds.length) {
    predicates.ceiling = Prisma.sql`(${Prisma.join(bounds, " AND ")})`
  }

  if (q.incomplete?.length) {
    const clauses = q.incomplete.map((reason) => {
      if (reason === "cni") return Prisma.sql`(e."cni" IS NULL OR e."cni" = '')`
      if (reason === "contact")
        return Prisma.sql`((e."phone" IS NULL OR e."phone" = '') AND (e."email" IS NULL OR e."email" = ''))`
      return Prisma.sql`cur.id IS NULL`
    })
    // Any of the selected gaps, not all of them: the queue is a list of things
    // to fix, not a list of records that are wrong in every way at once.
    predicates.incomplete = Prisma.sql`(${Prisma.join(clauses, " OR ")})`
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
 * The employee's current contract: the active one if there is one, otherwise
 * the most recent. A lateral join rather than a second query, so the list stays
 * at two round trips no matter how many rows it returns.
 */
function currentContractJoin(firmId: string): Prisma.Sql {
  return Prisma.sql`
    LEFT JOIN LATERAL (
      SELECT c."id", c."type", c."endDate", c."startDate", c."isVise", c."status"
      FROM contracts c
      WHERE c."employeeId" = e."id" AND c."firmId" = ${firmId}
      ORDER BY (c."status" = 'ACTIVE') DESC, c."startDate" DESC
      LIMIT 1
    ) cur ON true
  `
}

function orderBy(sort: EmployeeQuery["sort"]): Prisma.Sql {
  const columns: Record<string, string> = {
    name: 'e."lastName"',
    matricule: 'e."matricule"',
    client: 'cli."name"',
    contract: "cur.type",
    ceiling: "used_days",
    seniority: 'e."hireDate"',
    status: 'e."status"',
  }

  const clauses = sort
    .filter((entry) => entry.id in columns)
    .map((entry) =>
      Prisma.raw(`${columns[entry.id]} ${entry.desc ? "DESC" : "ASC"} NULLS LAST`)
    )

  if (clauses.length === 0) {
    // Urgency before alphabet (§4.7): closest to the ceiling first, then the
    // soonest contract end, then by name.
    return Prisma.sql`ORDER BY
      COALESCE(cl.used_days, 0) DESC,
      cur."endDate" ASC NULLS LAST,
      e."lastName" ASC`
  }

  return Prisma.sql`ORDER BY ${Prisma.join(clauses, ", ")}, e."id" ASC`
}

/* ==========================================================================
 * Rows
 * ========================================================================== */

export type EmployeeRow = {
  id: string
  firstName: string
  lastName: string
  matricule: string
  jobTitle: string | null
  status: string
  hireDate: Date
  seniorityDays: number
  phone: string | null
  email: string | null
  cni: string | null
  netSalary: number | null
  client: { id: string; name: string } | null
  department: { id: string; name: string } | null
  documentCount: number
  currentContract: {
    id: string
    type: string
    status: string
    endDate: Date | null
    daysRemaining: number | null
    isVise: boolean
  } | null
  ceiling: {
    applicable: boolean
    usedDays: number
    projectedDays: number
    remainingDays: number
    tone: "brand" | "signal" | "alert"
  }
  /** Gaps a records officer would need to close. */
  missing: string[]
}

type IdRow = {
  id: string
  used_days: bigint | number | null
  projected_days: bigint | number | null
  total_count: bigint | number
}

const toNumber = (value: bigint | number | null | undefined): number =>
  value === null || value === undefined ? 0 : Number(value)

const DAY = 86_400_000

/* ==========================================================================
 * Resolver
 * ========================================================================== */

export async function listEmployees(
  q: EmployeeQuery,
  ctx: FirmContext
): Promise<Paged<EmployeeRow>> {
  const predicates = buildPredicates(q, ctx)
  const offset = (q.page - 1) * q.perPage

  const idRows = await db.$queryRaw<IdRow[]>(Prisma.sql`
    WITH ${interimCeilingCte(ctx.firmId)}
    SELECT
      e."id",
      cl.used_days,
      cl.projected_days,
      COUNT(*) OVER() AS total_count
    FROM employees e
    LEFT JOIN clients cli ON cli."id" = e."assignedClientId"
    LEFT JOIN ceiling cl ON cl.employee_id = e."id"
    ${currentContractJoin(ctx.firmId)}
    WHERE ${whereFrom(predicates)}
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
      facets: await employeeFacets(q, ctx),
    }
  }

  const ids = idRows.map((row) => row.id)
  const measured = new Map(
    idRows.map((row) => [
      row.id,
      { used: toNumber(row.used_days), projected: toNumber(row.projected_days) },
    ])
  )

  const records = await db.employee.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      matricule: true,
      jobTitle: true,
      status: true,
      hireDate: true,
      phone: true,
      email: true,
      cni: true,
      netSalary: true,
      assignedClient: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
      _count: { select: { documents: true } },
      contracts: {
        where: { firmId: ctx.firmId },
        orderBy: [{ status: "asc" }, { startDate: "desc" }],
        take: 4,
        select: {
          id: true,
          type: true,
          status: true,
          endDate: true,
          isVise: true,
          startDate: true,
        },
      },
    },
  })

  const byId = new Map(records.map((record) => [record.id, record]))
  const now = Date.now()

  const rows: EmployeeRow[] = ids.flatMap((id) => {
    const record = byId.get(id)
    if (!record) return []

    const current =
      record.contracts.find((contract) => contract.status === "ACTIVE") ??
      record.contracts[0] ??
      null
    const ceiling = measured.get(id) ?? { used: 0, projected: 0 }
    const applicable = current?.type === "INTERIM"

    const missing: string[] = []
    if (!record.cni) missing.push("CNI")
    if (!record.phone && !record.email) missing.push("contact")
    if (!current) missing.push("contrat")

    return [
      {
        id: record.id,
        firstName: record.firstName,
        lastName: record.lastName,
        matricule: record.matricule,
        jobTitle: record.jobTitle,
        status: record.status,
        hireDate: record.hireDate,
        seniorityDays: Math.max(
          0,
          Math.round((now - record.hireDate.getTime()) / DAY)
        ),
        phone: record.phone,
        email: record.email,
        cni: record.cni,
        netSalary: record.netSalary === null ? null : Number(record.netSalary),
        client: record.assignedClient,
        department: record.department,
        documentCount: record._count.documents,
        currentContract: current
          ? {
              id: current.id,
              type: current.type,
              status: current.status,
              endDate: current.endDate,
              daysRemaining:
                current.endDate === null
                  ? null
                  : Math.round((current.endDate.getTime() - now) / DAY),
              isVise: current.isVise,
            }
          : null,
        ceiling: {
          applicable,
          usedDays: applicable ? ceiling.used : 0,
          projectedDays: applicable ? ceiling.projected : 0,
          remainingDays: applicable
            ? Math.max(0, INTERIM_CEILING_DAYS - ceiling.used)
            : INTERIM_CEILING_DAYS,
          tone: applicable ? toneFor(ceiling.used) : "brand",
        },
        missing,
      },
    ]
  })

  return {
    rows,
    total,
    page: q.page,
    perPage: q.perPage,
    pageCount: Math.ceil(total / q.perPage),
    facets: await employeeFacets(q, ctx),
  }
}

/* ==========================================================================
 * Facets
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
    WITH ${interimCeilingCte(ctx.firmId)}
    SELECT ${valueSql} AS value, ${labelSql} AS label, COUNT(*) AS count
    FROM employees e
    LEFT JOIN clients cli ON cli."id" = e."assignedClientId"
    LEFT JOIN departments dep ON dep."id" = e."departmentId"
    LEFT JOIN ceiling cl ON cl.employee_id = e."id"
    ${currentContractJoin(ctx.firmId)}
    WHERE ${whereFrom(predicates, [exclude])}
    GROUP BY 1, 2
    ORDER BY count DESC
  `)
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Actif",
  INACTIVE: "Inactif",
  SUSPENDED: "Suspendu",
  TERMINATED: "Sorti",
  ON_LEAVE: "En congé",
}

const TYPE_LABELS: Record<string, string> = {
  CDI: "CDI",
  CDD: "CDD",
  INTERIM: "Intérim",
  STAGE: "Stage",
  PRESTATION: "Prestation",
}

export async function employeeFacets(
  q: EmployeeQuery,
  ctx: FirmContext
): Promise<Facets> {
  const predicates = buildPredicates(q, ctx)

  const [statuses, types, clients, departments] = await Promise.all([
    facetCounts(predicates, ctx, "status", Prisma.sql`e."status"::text`, Prisma.sql`e."status"::text`),
    facetCounts(predicates, ctx, "contractType", Prisma.sql`cur.type::text`, Prisma.sql`cur.type::text`),
    facetCounts(predicates, ctx, "client", Prisma.sql`e."assignedClientId"`, Prisma.sql`cli."name"`),
    facetCounts(predicates, ctx, "department", Prisma.sql`e."departmentId"`, Prisma.sql`dep."name"`),
  ])

  return {
    status: statuses.map((row) => ({
      value: row.value ?? "",
      label: STATUS_LABELS[row.value ?? ""] ?? row.value ?? "",
      count: toNumber(row.count),
    })),
    contractType: types
      .filter((row) => row.value !== null)
      .map((row) => ({
        value: row.value ?? "",
        label: TYPE_LABELS[row.value ?? ""] ?? row.value ?? "",
        count: toNumber(row.count),
      })),
    client: clients
      .filter((row) => row.value !== null)
      .map((row) => ({
        value: row.value ?? "",
        label: row.label ?? "—",
        count: toNumber(row.count),
      })),
    department: departments
      .filter((row) => row.value !== null)
      .map((row) => ({
        value: row.value ?? "",
        label: row.label ?? "—",
        count: toNumber(row.count),
      })),
  }
}

/* ==========================================================================
 * Summary
 * ========================================================================== */

export type EmployeeSummary = {
  matching: number
  active: number
  atRisk: number
  overCeiling: number
  incomplete: number
}

export async function employeeSummary(
  q: EmployeeQuery,
  ctx: FirmContext
): Promise<EmployeeSummary> {
  const where = whereFrom(buildPredicates(q, ctx))

  const [row] = await db.$queryRaw<
    {
      matching: bigint
      active: bigint
      at_risk: bigint
      over_ceiling: bigint
      incomplete: bigint
    }[]
  >(Prisma.sql`
    WITH ${interimCeilingCte(ctx.firmId)}
    SELECT
      COUNT(*) AS matching,
      COUNT(*) FILTER (WHERE e."status" = 'ACTIVE') AS active,
      COUNT(*) FILTER (
        WHERE cur.type = 'INTERIM'
          AND COALESCE(cl.used_days, 0) >= ${INTERIM_WARNING_DAYS}
          AND COALESCE(cl.used_days, 0) < ${INTERIM_CEILING_DAYS}
      ) AS at_risk,
      COUNT(*) FILTER (
        WHERE cur.type = 'INTERIM' AND COALESCE(cl.used_days, 0) >= ${INTERIM_CEILING_DAYS}
      ) AS over_ceiling,
      COUNT(*) FILTER (
        WHERE e."cni" IS NULL OR e."cni" = ''
           OR ((e."phone" IS NULL OR e."phone" = '') AND (e."email" IS NULL OR e."email" = ''))
           OR cur."id" IS NULL
      ) AS incomplete
    FROM employees e
    LEFT JOIN clients cli ON cli."id" = e."assignedClientId"
    LEFT JOIN ceiling cl ON cl.employee_id = e."id"
    ${currentContractJoin(ctx.firmId)}
    WHERE ${where}
  `)

  return {
    matching: toNumber(row?.matching),
    active: toNumber(row?.active),
    atRisk: toNumber(row?.at_risk),
    overCeiling: toNumber(row?.over_ceiling),
    incomplete: toNumber(row?.incomplete),
  }
}

/* ==========================================================================
 * Export and selection
 * ========================================================================== */

export async function* streamEmployeesForExport(
  q: EmployeeQuery,
  ctx: FirmContext,
  batchSize = 200
): AsyncGenerator<EmployeeRow[]> {
  let page = 1
  for (;;) {
    const result = await listEmployees(
      { ...q, page, perPage: Math.min(batchSize, 200) },
      ctx
    )
    if (result.rows.length === 0) return
    yield result.rows
    if (result.page >= result.pageCount) return
    page += 1
  }
}

export async function resolveEmployeeSelection(
  selection: Selection<EmployeeQuery>,
  ctx: FirmContext
): Promise<string[]> {
  const query = "ids" in selection ? EMPTY_EMPLOYEE_QUERY : selection.query
  const predicates = buildPredicates(query, ctx)

  const restrict =
    "ids" in selection
      ? Prisma.sql`AND e."id" IN (${Prisma.join(selection.ids)})`
      : selection.except.length
        ? Prisma.sql`AND e."id" NOT IN (${Prisma.join(selection.except)})`
        : Prisma.empty

  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    WITH ${interimCeilingCte(ctx.firmId)}
    SELECT e."id"
    FROM employees e
    LEFT JOIN clients cli ON cli."id" = e."assignedClientId"
    LEFT JOIN ceiling cl ON cl.employee_id = e."id"
    ${currentContractJoin(ctx.firmId)}
    WHERE ${whereFrom(predicates)}
    ${restrict}
  `)

  return rows.map((row) => row.id)
}

/**
 * The ids of the current result, in order, for prev/next navigation on the
 * employee record (§5.5). Capped: the record navigates a working set, not the
 * entire payroll.
 */
export async function employeeIdSequence(
  q: EmployeeQuery,
  ctx: FirmContext,
  limit = 500
): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    WITH ${interimCeilingCte(ctx.firmId)}
    SELECT e."id"
    FROM employees e
    LEFT JOIN clients cli ON cli."id" = e."assignedClientId"
    LEFT JOIN ceiling cl ON cl.employee_id = e."id"
    ${currentContractJoin(ctx.firmId)}
    WHERE ${whereFrom(buildPredicates(q, ctx))}
    ${orderBy(q.sort)}
    LIMIT ${limit}
  `)
  return rows.map((row) => row.id)
}
