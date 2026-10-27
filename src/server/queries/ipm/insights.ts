import "server-only"

import { cache } from "react"

import { db } from "@/lib/db"
import type { FirmContext } from "@/server/auth/require-firm-access"

/**
 * The IPM's charts — Vue d'ensemble and Pilotage.
 *
 * Same rule as the HR dashboard: **every figure is a SQL aggregate and no
 * panel fetches rows**. Each function feeds one panel, so the pages can
 * stream them behind their own Suspense boundaries; the ones two panels share
 * are wrapped in `cache()` and run once per request.
 *
 * Two sources, deliberately kept apart and labelled as such on the page:
 *
 *   - the **bons** are the operational truth — what the counter issued and
 *     what the IPM committed to pay (`insurerShare`), by issue date;
 *   - the **registre** (`ipm_ledger_entries`) is the accounting truth —
 *     cotisations credited and consommation debited per participant, by
 *     period. The ratio and the balances rest on it.
 *
 * They do not have to agree month by month (a bon is debited when it is
 * consumed, not when it is printed), so a panel never mixes them.
 *
 * The window is the **twelve months ending with the current one**. A bon
 * cancelled or refused never committed anything and is left out everywhere.
 */

const WINDOW = 12

const MONTHS_LONG = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
]
const MONTHS_SHORT = [
  "janv.", "févr.", "mars", "avr.", "mai", "juin",
  "juil.", "août", "sept.", "oct.", "nov.", "déc.",
]

export type MonthBucket = {
  year: number
  month: number
  /** `octobre 2026`, for tooltips. */
  label: string
  /** `oct.`, for axes. */
  short: string
}

/** The window, oldest first. */
export function monthWindow(now = new Date(), count = WINDOW): MonthBucket[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (count - 1 - index), 1))
    const month = date.getUTCMonth() + 1
    return {
      year: date.getUTCFullYear(),
      month,
      label: `${MONTHS_LONG[month - 1]} ${date.getUTCFullYear()}`,
      short: MONTHS_SHORT[month - 1],
    }
  })
}

function windowStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (WINDOW - 1), 1))
}

/** `year * 12 + month`, the comparable form of a period. */
const periodKey = (year: number, month: number) => year * 12 + month

function indexOfPeriod(months: MonthBucket[], year: number, month: number): number {
  return months.findIndex((bucket) => bucket.year === year && bucket.month === month)
}

/**
 * The window's first instant, computed **in SQL and in UTC**.
 *
 * The columns are `timestamp` without zone, written in UTC, but the session
 * runs in the server's zone (Europe/Paris locally). A JS `Date` bound as a
 * parameter, or a bare `now()`, is shifted by that offset — enough to push
 * the first of the month into the previous one and leave the current month
 * empty. Everything date-shaped below goes through `now() AT TIME ZONE 'UTC'`.
 */
const UTC_NOW = `(now() AT TIME ZONE 'UTC')`
const WINDOW_START = `(date_trunc('month', ${UTC_NOW}) - interval '${WINDOW - 1} months')`

/** Bons that committed something: everything but a cancelled or refused one. */
const LIVE_VOUCHER = `status::text NOT IN ('CANCELLED', 'REJECTED')`

/* ==========================================================================
 * Bons, month by month
 * ========================================================================== */

export type VoucherMonthly = {
  months: MonthBucket[]
  count: number[]
  /** Part IPM engagée. */
  insurerShare: number[]
  /** Montant total des actes, part participant comprise. */
  totalAmount: number[]
  byType: Record<"PHARMACY" | "GUARANTEE" | "OPTICAL" | "HOSPITALIZATION", number[]>
  portal: number
  total: number
}

export const voucherMonthly = cache(async (ctx: FirmContext): Promise<VoucherMonthly> => {
  const months = monthWindow()
  const rows = await db.$queryRawUnsafe<
    { y: number; m: number; type: string; origin: string; n: number; share: number; total: number }[]
  >(
    `SELECT EXTRACT(YEAR FROM "issueDate")::int AS y,
            EXTRACT(MONTH FROM "issueDate")::int AS m,
            type::text AS type,
            origin::text AS origin,
            count(*)::int AS n,
            COALESCE(sum("insurerShare"), 0)::float8 AS share,
            COALESCE(sum("totalAmount"), 0)::float8 AS total
       FROM ipm_vouchers
      WHERE "firmId" = $1 AND "issueDate" >= ${WINDOW_START} AND ${LIVE_VOUCHER}
      GROUP BY 1, 2, 3, 4`,
    ctx.firmId
  )

  const zeros = () => months.map(() => 0)
  const result: VoucherMonthly = {
    months,
    count: zeros(),
    insurerShare: zeros(),
    totalAmount: zeros(),
    byType: { PHARMACY: zeros(), GUARANTEE: zeros(), OPTICAL: zeros(), HOSPITALIZATION: zeros() },
    portal: 0,
    total: 0,
  }

  for (const row of rows) {
    const index = indexOfPeriod(months, row.y, row.m)
    if (index < 0) continue
    result.count[index] += row.n
    result.insurerShare[index] += row.share
    result.totalAmount[index] += row.total
    const type = row.type as keyof VoucherMonthly["byType"]
    if (type in result.byType) result.byType[type][index] += row.n
    if (row.origin === "PORTAL") result.portal += row.n
    result.total += row.n
  }

  return result
})

/* ==========================================================================
 * The register, month by month
 * ========================================================================== */

export type LedgerMonthly = {
  months: MonthBucket[]
  contributions: number[]
  consumption: number[]
}

export const ledgerMonthly = cache(async (ctx: FirmContext): Promise<LedgerMonthly> => {
  const months = monthWindow()
  const first = months[0]
  const rows = await db.$queryRaw<{ y: number; m: number; type: string; amount: number }[]>`
    SELECT "periodYear" AS y,
           "periodMonth" AS m,
           type::text AS type,
           (CASE WHEN type::text = 'CONSUMPTION' THEN COALESCE(sum(debit), 0)
                 ELSE COALESCE(sum(credit), 0) END)::float8 AS amount
      FROM ipm_ledger_entries
     WHERE "firmId" = ${ctx.firmId}
       AND type::text IN ('CONTRIBUTION', 'CONSUMPTION')
       AND ("periodYear" * 12 + "periodMonth") >= ${periodKey(first.year, first.month)}
     GROUP BY 1, 2, 3
  `

  const contributions = months.map(() => 0)
  const consumption = months.map(() => 0)
  for (const row of rows) {
    const index = indexOfPeriod(months, row.y, row.m)
    if (index < 0) continue
    if (row.type === "CONSUMPTION") consumption[index] += row.amount
    else contributions[index] += row.amount
  }
  return { months, contributions, consumption }
})

/* ==========================================================================
 * Couverture
 * ========================================================================== */

export type CoverageTrend = {
  months: MonthBucket[]
  /** Participants covered at the end of each month. */
  members: number[]
  /** Ayants droit covered at the end of each month. */
  dependents: number[]
}

/**
 * Who was covered at each month end, rebuilt from affiliation and coverage
 * dates — not from today's status, which would draw every past month with
 * today's roster. A participant still `PENDING` was never covered.
 */
export const coverageTrend = cache(async (ctx: FirmContext): Promise<CoverageTrend> => {
  const months = monthWindow()
  const rows = await db.$queryRawUnsafe<{ y: number; m: number; members: number; dependents: number }[]>(
    `WITH bounds AS (
      SELECT LEAST(gs + interval '1 month', ${UTC_NOW}) AS boundary, gs
        FROM generate_series(${WINDOW_START}, date_trunc('month', ${UTC_NOW}), interval '1 month') gs
    )
    SELECT EXTRACT(YEAR FROM b.gs)::int AS y,
           EXTRACT(MONTH FROM b.gs)::int AS m,
           (SELECT count(*) FROM ipm_members m
             WHERE m."firmId" = $1
               AND m.status::text <> 'PENDING'
               AND m."affiliationDate" < b.boundary
               AND (m."terminationDate" IS NULL OR m."terminationDate" >= b.boundary))::int AS members,
           (SELECT count(*) FROM ipm_dependents d
             WHERE d."firmId" = $1
               AND d."coverageStart" < b.boundary
               AND (d."coverageEnd" IS NULL OR d."coverageEnd" >= b.boundary))::int AS dependents
      FROM bounds b
     ORDER BY b.gs`,
    ctx.firmId
  )

  const members = months.map(() => 0)
  const dependents = months.map(() => 0)
  for (const row of rows) {
    const index = indexOfPeriod(months, row.y, row.m)
    if (index < 0) continue
    members[index] = row.members
    dependents[index] = row.dependents
  }
  return { months, members, dependents }
})

export type BeneficiaryMix = {
  members: number
  spouses: number
  children: number
  ascendants: number
  others: number
}

/** Today's covered heads, by relation to the participant. */
export async function beneficiaryMix(ctx: FirmContext): Promise<BeneficiaryMix> {
  const [members, dependents] = await Promise.all([
    db.member.count({ where: { firmId: ctx.firmId, status: "ACTIVE" } }),
    db.dependent.groupBy({
      by: ["relation"],
      where: { firmId: ctx.firmId, status: "ACTIVE" },
      _count: { _all: true },
    }),
  ])
  const of = (...relations: string[]) =>
    dependents
      .filter((row) => relations.includes(row.relation))
      .reduce((sum, row) => sum + row._count._all, 0)

  return {
    members,
    spouses: of("SPOUSE_F", "SPOUSE_M"),
    children: of("CHILD"),
    ascendants: of("ASCENDANT"),
    others: of("OTHER"),
  }
}

/* ==========================================================================
 * Cycle des bons
 * ========================================================================== */

export type VoucherPipeline = Record<
  | "AWAITING_AMOUNT"
  | "PENDING_REVIEW"
  | "ISSUED"
  | "PRESENTED"
  | "SETTLED"
  | "INVOICED"
  | "CANCELLED"
  | "EXPIRED"
  | "REJECTED",
  number
>

/** Bons issued in the window, by where they are now. */
export async function voucherPipeline(ctx: FirmContext): Promise<VoucherPipeline> {
  const rows = await db.ipmVoucher.groupBy({
    by: ["status"],
    where: { firmId: ctx.firmId, issueDate: { gte: windowStart() } },
    _count: { _all: true },
  })
  const result: VoucherPipeline = {
    AWAITING_AMOUNT: 0,
    PENDING_REVIEW: 0,
    ISSUED: 0,
    PRESENTED: 0,
    SETTLED: 0,
    INVOICED: 0,
    CANCELLED: 0,
    EXPIRED: 0,
    REJECTED: 0,
  }
  for (const row of rows) result[row.status] = row._count._all
  return result
}

/* ==========================================================================
 * Rythme d'émission
 * ========================================================================== */

/**
 * Bons per day for the last `weeks` weeks, contiguous and starting on a
 * Monday — the calendar heatmap's grid, built here so the client never has to
 * reason about calendars. Days after today are not emitted.
 */
export async function voucherDaily(
  ctx: FirmContext,
  weeks = 26
): Promise<{ date: string; value: number }[]> {
  const today = new Date()
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const weekday = (today.getUTCDay() + 6) % 7 // Monday = 0
  const start = new Date(todayUtc - (weekday + (weeks - 1) * 7) * 86_400_000)

  const rows = await db.$queryRawUnsafe<{ d: string; n: number }[]>(
    `SELECT to_char("issueDate" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, count(*)::int AS n
       FROM ipm_vouchers
      WHERE "firmId" = $1 AND "issueDate" >= $2::timestamp AND ${LIVE_VOUCHER}
      GROUP BY 1`,
    ctx.firmId,
    // A plain date string, read as a zoneless timestamp — see WINDOW_START.
    start.toISOString().slice(0, 10)
  )
  const byDay = new Map(rows.map((row) => [row.d, row.n]))

  const days: { date: string; value: number }[] = []
  for (let time = start.getTime(); time <= todayUtc; time += 86_400_000) {
    const date = new Date(time).toISOString().slice(0, 10)
    days.push({ date, value: byDay.get(date) ?? 0 })
  }
  return days
}

/* ==========================================================================
 * Prestataires et catégories
 * ========================================================================== */

export type ProviderShare = {
  id: string
  name: string
  count: number
  insurerShare: number
}

/** The providers the IPM pays most, over the window. */
export async function topProviders(ctx: FirmContext, limit = 6): Promise<ProviderShare[]> {
  return db.$queryRawUnsafe<ProviderShare[]>(
    `SELECT p.id, p.name,
            count(v.id)::int AS count,
            COALESCE(sum(v."insurerShare"), 0)::float8 AS "insurerShare"
       FROM ipm_vouchers v
       JOIN ipm_providers p ON p.id = v."providerId"
      WHERE v."firmId" = $1 AND v."issueDate" >= ${WINDOW_START} AND v.${LIVE_VOUCHER}
      GROUP BY p.id, p.name
      ORDER BY "insurerShare" DESC
      LIMIT $2`,
    ctx.firmId,
    limit
  )
}

export type CategoryShare = {
  id: string
  label: string
  count: number
  insurerShare: number
}

/** Where the part IPM goes, by catégorie de soins, over the window. */
export async function categoryShare(ctx: FirmContext): Promise<CategoryShare[]> {
  return db.$queryRawUnsafe<CategoryShare[]>(
    `SELECT c.id, c.label,
            count(v.id)::int AS count,
            COALESCE(sum(v."insurerShare"), 0)::float8 AS "insurerShare"
       FROM ipm_vouchers v
       JOIN ipm_service_categories c ON c.id = v."categoryId"
      WHERE v."firmId" = $1 AND v."issueDate" >= ${WINDOW_START} AND v.${LIVE_VOUCHER}
      GROUP BY c.id, c.label
      ORDER BY "insurerShare" DESC`,
    ctx.firmId
  )
}

/* ==========================================================================
 * Recouvrement et règlements
 * ========================================================================== */

export type Settlement = {
  /** Factures employeurs émises (hors brouillons et annulées). */
  employerBilled: number
  employerCollected: number
  /** Reste dû, dont la part échue. */
  employerOutstanding: number
  employerOverdue: number
  /** Factures prestataires reçues (hors rejetées). */
  providerReceived: number
  providerPaid: number
  /** Remboursements accordés (approuvés ou payés). */
  reimbursementGranted: number
  reimbursementPaid: number
}

export const settlement = cache(async (ctx: FirmContext): Promise<Settlement> => {
  const [row] = await db.$queryRaw<Settlement[]>`
    SELECT
      (SELECT COALESCE(sum("totalAmount"), 0) FROM ipm_employer_invoices
        WHERE "firmId" = ${ctx.firmId} AND status::text NOT IN ('DRAFT', 'CANCELLED'))::float8 AS "employerBilled",
      (SELECT COALESCE(sum("paidAmount"), 0) FROM ipm_employer_invoices
        WHERE "firmId" = ${ctx.firmId} AND status::text NOT IN ('DRAFT', 'CANCELLED'))::float8 AS "employerCollected",
      (SELECT COALESCE(sum("totalAmount" - "paidAmount"), 0) FROM ipm_employer_invoices
        WHERE "firmId" = ${ctx.firmId} AND status::text NOT IN ('DRAFT', 'CANCELLED', 'PAID'))::float8 AS "employerOutstanding",
      (SELECT COALESCE(sum("totalAmount" - "paidAmount"), 0) FROM ipm_employer_invoices
        WHERE "firmId" = ${ctx.firmId} AND status::text NOT IN ('DRAFT', 'CANCELLED', 'PAID')
          AND "dueDate" < (now() AT TIME ZONE 'UTC'))::float8 AS "employerOverdue",
      (SELECT COALESCE(sum("totalAmount"), 0) FROM ipm_provider_invoices
        WHERE "firmId" = ${ctx.firmId} AND status::text <> 'REJECTED')::float8 AS "providerReceived",
      (SELECT COALESCE(sum("totalAmount"), 0) FROM ipm_provider_invoices
        WHERE "firmId" = ${ctx.firmId} AND status::text = 'PAID')::float8 AS "providerPaid",
      (SELECT COALESCE(sum("insurerShare"), 0) FROM ipm_reimbursements
        WHERE "firmId" = ${ctx.firmId} AND status::text IN ('APPROVED', 'PAID'))::float8 AS "reimbursementGranted",
      (SELECT COALESCE(sum("insurerShare"), 0) FROM ipm_reimbursements
        WHERE "firmId" = ${ctx.firmId} AND status::text = 'PAID')::float8 AS "reimbursementPaid"
  `
  return row
})
