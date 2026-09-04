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
 * §5.3 — the dashboard.
 *
 * Every number here is a SQL aggregate. **The dashboard must not fetch rows**:
 * the old one pulled the employee table and counted in JavaScript, which is why
 * it got slower every month. Each panel is an independent function so the page
 * can stream them in parallel behind their own Suspense boundaries.
 *
 * All of them are firm-scoped and role-scoped: a responsable sees a dashboard
 * of their own portfolio, not a blurred version of the firm's.
 */

const toNumber = (value: bigint | number | string | null | undefined): number =>
  value === null || value === undefined ? 0 : Number(value)

/** The caller's client restriction, as a fragment on the employees table. */
function employeeScope(ctx: FirmContext, alias = "e"): Prisma.Sql {
  if (ctx.assignedClientIds === null) return Prisma.empty
  if (ctx.assignedClientIds.length === 0) return Prisma.sql`AND false`
  return Prisma.sql`AND ${Prisma.raw(`${alias}."assignedClientId"`)} IN (${Prisma.join(
    ctx.assignedClientIds
  )})`
}

function contractScope(ctx: FirmContext, alias = "c"): Prisma.Sql {
  if (ctx.assignedClientIds === null) return Prisma.empty
  if (ctx.assignedClientIds.length === 0) return Prisma.sql`AND false`
  return Prisma.sql`AND ${Prisma.raw(`${alias}."clientId"`)} IN (${Prisma.join(
    ctx.assignedClientIds
  )})`
}

/* ==========================================================================
 * KPI strip
 * ========================================================================== */

export type DashboardKpis = {
  headcount: number
  headcountDelta: number
  expiringSoon: number
  expiringDelta: number
  monthlyPayroll: number
  overCeiling: number
  atRisk: number
}

export async function getKpis(ctx: FirmContext): Promise<DashboardKpis> {
  const [row] = await db.$queryRaw<
    {
      headcount: bigint
      hired_90: bigint
      left_90: bigint
      payroll: string | null
      expiring_30: bigint
      expiring_90: bigint
      over_ceiling: bigint
      at_risk: bigint
    }[]
  >(Prisma.sql`
    WITH ${interimCeilingCte(ctx.firmId)}
    SELECT
      COUNT(*) FILTER (WHERE e."status" = 'ACTIVE') AS headcount,
      COUNT(*) FILTER (
        WHERE e."status" = 'ACTIVE' AND e."hireDate" >= now() - INTERVAL '90 days'
      ) AS hired_90,
      COUNT(*) FILTER (
        WHERE e."status" = 'TERMINATED' AND e."updatedAt" >= now() - INTERVAL '90 days'
      ) AS left_90,
      COALESCE(SUM(e."netSalary") FILTER (WHERE e."status" = 'ACTIVE'), 0) AS payroll,
      COUNT(*) FILTER (
        WHERE cur."endDate" IS NOT NULL
          AND cur."endDate" BETWEEN now() AND now() + INTERVAL '30 days'
      ) AS expiring_30,
      COUNT(*) FILTER (
        WHERE cur."endDate" IS NOT NULL
          AND cur."endDate" BETWEEN now() AND now() + INTERVAL '90 days'
      ) AS expiring_90,
      COUNT(*) FILTER (
        WHERE cur."type" = 'INTERIM' AND COALESCE(cl.used_days, 0) >= ${INTERIM_CEILING_DAYS}
      ) AS over_ceiling,
      COUNT(*) FILTER (
        WHERE cur."type" = 'INTERIM'
          AND COALESCE(cl.used_days, 0) >= ${INTERIM_WARNING_DAYS}
          AND COALESCE(cl.used_days, 0) < ${INTERIM_CEILING_DAYS}
      ) AS at_risk
    FROM employees e
    LEFT JOIN ceiling cl ON cl.employee_id = e."id"
    LEFT JOIN LATERAL (
      SELECT c."type", c."endDate"
      FROM contracts c
      WHERE c."employeeId" = e."id" AND c."firmId" = ${ctx.firmId} AND c."status" = 'ACTIVE'
      ORDER BY c."startDate" DESC
      LIMIT 1
    ) cur ON true
    WHERE e."firmId" = ${ctx.firmId}
    ${employeeScope(ctx)}
  `)

  return {
    headcount: toNumber(row?.headcount),
    headcountDelta: toNumber(row?.hired_90) - toNumber(row?.left_90),
    expiringSoon: toNumber(row?.expiring_90),
    expiringDelta: toNumber(row?.expiring_30),
    monthlyPayroll: toNumber(row?.payroll),
    overCeiling: toNumber(row?.over_ceiling),
    atRisk: toNumber(row?.at_risk),
  }
}

/* ==========================================================================
 * Headcount over twelve months
 * ========================================================================== */

export type HeadcountPoint = { month: Date; headcount: number; hired: number; left: number }

/**
 * Headcount at the end of each of the last twelve months.
 *
 * Reconstructed from hire dates rather than stored anywhere — the schema has no
 * headcount history table and §1.1 forbids adding one. An employee counts in a
 * month if they were hired on or before its end and had not been terminated by
 * then; `updatedAt` is the only available proxy for a termination date, which
 * is honest but approximate for anyone edited after leaving.
 */
export async function getHeadcountTrend(ctx: FirmContext): Promise<HeadcountPoint[]> {
  const rows = await db.$queryRaw<
    { month: Date; headcount: bigint; hired: bigint; departed: bigint }[]
  >(Prisma.sql`
    WITH months AS (
      SELECT generate_series(
        date_trunc('month', now()) - INTERVAL '11 months',
        date_trunc('month', now()),
        INTERVAL '1 month'
      ) AS month
    )
    SELECT
      m.month,
      COUNT(e."id") FILTER (
        WHERE e."hireDate" < m.month + INTERVAL '1 month'
          AND (e."status" <> 'TERMINATED' OR e."updatedAt" >= m.month + INTERVAL '1 month')
      ) AS headcount,
      COUNT(e."id") FILTER (
        WHERE e."hireDate" >= m.month AND e."hireDate" < m.month + INTERVAL '1 month'
      ) AS hired,
      COUNT(e."id") FILTER (
        WHERE e."status" = 'TERMINATED'
          AND e."updatedAt" >= m.month
          AND e."updatedAt" < m.month + INTERVAL '1 month'
      ) AS departed
    FROM months m
    LEFT JOIN employees e
      ON e."firmId" = ${ctx.firmId}
      ${employeeScope(ctx)}
    GROUP BY m.month
    ORDER BY m.month
  `)

  return rows.map((row) => ({
    month: row.month,
    headcount: toNumber(row.headcount),
    hired: toNumber(row.hired),
    left: toNumber(row.departed),
  }))
}

/* ==========================================================================
 * Contract expiries, next six months
 * ========================================================================== */

export type ExpiryBucket = { month: Date; interim: number; other: number }

export async function getExpirySchedule(ctx: FirmContext): Promise<ExpiryBucket[]> {
  const rows = await db.$queryRaw<
    { month: Date; interim: bigint; other: bigint }[]
  >(Prisma.sql`
    WITH months AS (
      SELECT generate_series(
        date_trunc('month', now()),
        date_trunc('month', now()) + INTERVAL '5 months',
        INTERVAL '1 month'
      ) AS month
    )
    SELECT
      m.month,
      COUNT(c."id") FILTER (WHERE c."type" = 'INTERIM') AS interim,
      COUNT(c."id") FILTER (WHERE c."type" <> 'INTERIM') AS other
    FROM months m
    LEFT JOIN contracts c
      ON c."firmId" = ${ctx.firmId}
      AND c."status" = 'ACTIVE'
      AND c."endDate" >= m.month
      AND c."endDate" < m.month + INTERVAL '1 month'
      ${contractScope(ctx)}
    GROUP BY m.month
    ORDER BY m.month
  `)

  return rows.map((row) => ({
    month: row.month,
    interim: toNumber(row.interim),
    other: toNumber(row.other),
  }))
}

/* ==========================================================================
 * Headcount by client
 * ========================================================================== */

export type ClientPlacement = { id: string; name: string; placed: number; share: number }

export async function getPlacementsByClient(
  ctx: FirmContext
): Promise<ClientPlacement[]> {
  const rows = await db.$queryRaw<{ id: string; name: string; placed: bigint }[]>(
    Prisma.sql`
      SELECT cli."id", cli."name", COUNT(e."id") AS placed
      FROM clients cli
      JOIN employees e
        ON e."assignedClientId" = cli."id"
        AND e."firmId" = ${ctx.firmId}
        AND e."status" = 'ACTIVE'
      WHERE cli."firmId" = ${ctx.firmId}
      ${employeeScope(ctx)}
      GROUP BY cli."id", cli."name"
      HAVING COUNT(e."id") > 0
      ORDER BY placed DESC
      LIMIT 10
    `
  )

  const total = rows.reduce((sum, row) => sum + toNumber(row.placed), 0)

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    placed: toNumber(row.placed),
    share: total === 0 ? 0 : toNumber(row.placed) / total,
  }))
}

/* ==========================================================================
 * Exposure to the legal ceiling
 * ========================================================================== */

export type CeilingBand = { label: string; min: number; max: number | null; count: number }

export async function getCeilingBands(ctx: FirmContext): Promise<CeilingBand[]> {
  const [row] = await db.$queryRaw<
    { b1: bigint; b2: bigint; b3: bigint; b4: bigint; b5: bigint; b6: bigint }[]
  >(Prisma.sql`
    WITH ${interimCeilingCte(ctx.firmId)}
    SELECT
      COUNT(*) FILTER (WHERE cl.used_days < 180) AS b1,
      COUNT(*) FILTER (WHERE cl.used_days >= 180 AND cl.used_days < 365) AS b2,
      COUNT(*) FILTER (WHERE cl.used_days >= 365 AND cl.used_days < 550) AS b3,
      COUNT(*) FILTER (WHERE cl.used_days >= 550 AND cl.used_days < 650) AS b4,
      COUNT(*) FILTER (WHERE cl.used_days >= 650 AND cl.used_days < 730) AS b5,
      COUNT(*) FILTER (WHERE cl.used_days >= 730) AS b6
    FROM employees e
    JOIN ceiling cl ON cl.employee_id = e."id"
    WHERE e."firmId" = ${ctx.firmId}
      AND e."status" = 'ACTIVE'
      ${employeeScope(ctx)}
  `)

  return [
    { label: "Moins de 180 j", min: 0, max: 179, count: toNumber(row?.b1) },
    { label: "180 – 365 j", min: 180, max: 364, count: toNumber(row?.b2) },
    { label: "365 – 550 j", min: 365, max: 549, count: toNumber(row?.b3) },
    { label: "550 – 650 j", min: 550, max: 649, count: toNumber(row?.b4) },
    { label: "650 – 730 j", min: 650, max: 729, count: toNumber(row?.b5) },
    { label: "Au-delà de 730 j", min: 730, max: null, count: toNumber(row?.b6) },
  ]
}

/* ==========================================================================
 * Contract type mix
 * ========================================================================== */

export type TypeMix = { type: string; count: number }

export async function getContractMix(ctx: FirmContext): Promise<TypeMix[]> {
  const rows = await db.$queryRaw<{ type: string; count: bigint }[]>(Prisma.sql`
    SELECT c."type"::text AS type, COUNT(*) AS count
    FROM contracts c
    WHERE c."firmId" = ${ctx.firmId} AND c."status" = 'ACTIVE'
    ${contractScope(ctx)}
    GROUP BY 1
    ORDER BY count DESC
  `)

  return rows.map((row) => ({ type: row.type, count: toNumber(row.count) }))
}
