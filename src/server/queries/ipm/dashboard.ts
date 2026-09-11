import "server-only"

import { db } from "@/lib/db"
import type { FirmContext } from "@/server/auth/require-firm-access"
import { buildAlerts, contributionRatio, type Alert } from "@/server/domain/ipm/alerts"
import { listCards } from "@/server/queries/ipm/cards"

/**
 * Tableau de bord direction — plan §5 (phase 5).
 *
 * Every panel is an independent aggregate, and **no panel fetches rows** — the
 * same rule the HR dashboard follows. What the direction is actually asking
 * for, per §4.8quater, is one number they have never had: the ratio of
 * cotisations to consumption, per employer.
 *
 * Where a figure rests on data that is not there — a register with no opening
 * balance — the panel says so rather than presenting a total that happens to
 * start from zero.
 */

export type EmployerPerformance = {
  employerId: string
  employerName: string
  memberCount: number
  contributions: number
  consumption: number
  ratio: number | null
  balance: number
  unopenedLedgers: number
  overConsumptionCeiling: boolean
}

export type MonthlyPoint = {
  year: number
  month: number
  contributions: number
  consumption: number
}

export type IpmDashboard = {
  alerts: Alert[]
  headline: {
    activeMembers: number
    dependents: number
    monthlyContributions: number
    /** Insurer share committed on bons not yet settled. */
    outstandingCommitment: number
    ratio: number | null
  }
  employers: EmployerPerformance[]
  monthly: MonthlyPoint[]
  topCategories: { label: string; insurerShare: number; count: number }[]
  /** True when any register lacks an opening balance — every total is partial. */
  incompleteData: boolean
}

export async function ipmDashboard(
  ctx: FirmContext,
  firmSlug: string
): Promise<IpmDashboard> {
  const now = new Date()

  const [
    activeMembers,
    dependents,
    monthlyContributions,
    outstanding,
    employers,
    ledgerByMemberType,
    openedMemberIds,
    monthlyRows,
    categoryRows,
    overdueInvoices,
    varianceInvoices,
  ] = await Promise.all([
    db.member.count({ where: { firmId: ctx.firmId, status: "ACTIVE" } }),
    db.dependent.count({ where: { firmId: ctx.firmId, status: "ACTIVE" } }),
    db.ipmMemberContribution.aggregate({
      where: { firmId: ctx.firmId, validTo: null },
      _sum: { monthlyAmount: true },
    }),
    db.ipmVoucher.aggregate({
      where: { firmId: ctx.firmId, status: { in: ["ISSUED", "PRESENTED"] } },
      _sum: { insurerShare: true },
    }),
    db.ipmEmployer.findMany({
      where: { firmId: ctx.firmId },
      orderBy: { organization: { name: "asc" } },
      select: {
        id: true,
        consumptionCeiling: true,
        debtCeiling: true,
        organization: { select: { name: true } },
        members: { select: { id: true, currentBalance: true } },
      },
    }),
    db.ipmLedgerEntry.groupBy({
      by: ["memberId", "type"],
      where: { firmId: ctx.firmId },
      _sum: { credit: true, debit: true },
    }),
    db.ipmLedgerEntry.findMany({
      where: { firmId: ctx.firmId, type: "OPENING" },
      select: { memberId: true },
      distinct: ["memberId"],
    }),
    db.ipmLedgerEntry.groupBy({
      by: ["periodYear", "periodMonth", "type"],
      where: { firmId: ctx.firmId, type: { in: ["CONTRIBUTION", "CONSUMPTION"] } },
      _sum: { credit: true, debit: true },
    }),
    db.ipmVoucher.groupBy({
      by: ["categoryId"],
      where: { firmId: ctx.firmId, status: { not: "CANCELLED" } },
      _sum: { insurerShare: true },
      _count: { _all: true },
    }),
    db.ipmEmployerInvoice.findMany({
      where: {
        firmId: ctx.firmId,
        status: { notIn: ["PAID", "CANCELLED"] },
        dueDate: { lt: now },
      },
      select: { totalAmount: true, paidAmount: true },
    }),
    db.ipmProviderInvoice.findMany({
      where: { firmId: ctx.firmId, status: { in: ["RECEIVED", "CHECKED"] } },
      select: { totalAmount: true, matchedAmount: true },
    }),
  ])

  const opened = new Set(openedMemberIds.map((row) => row.memberId))

  const contributionsByMember = new Map<string, number>()
  const consumptionByMember = new Map<string, number>()
  for (const bucket of ledgerByMemberType) {
    if (bucket.type === "CONSUMPTION") {
      consumptionByMember.set(
        bucket.memberId,
        Number(bucket._sum.debit ?? 0)
      )
    } else if (bucket.type === "CONTRIBUTION") {
      contributionsByMember.set(
        bucket.memberId,
        Number(bucket._sum.credit ?? 0)
      )
    }
  }

  const employerRows: EmployerPerformance[] = employers.map((employer) => {
    const contributions = employer.members.reduce(
      (sum, member) => sum + (contributionsByMember.get(member.id) ?? 0),
      0
    )
    const consumption = employer.members.reduce(
      (sum, member) => sum + (consumptionByMember.get(member.id) ?? 0),
      0
    )
    const ceiling = employer.consumptionCeiling
      ? Number(employer.consumptionCeiling)
      : null

    return {
      employerId: employer.id,
      employerName: employer.organization.name,
      memberCount: employer.members.length,
      contributions,
      consumption,
      ratio: contributionRatio(contributions, consumption),
      balance: employer.members.reduce(
        (sum, member) => sum + Number(member.currentBalance),
        0
      ),
      unopenedLedgers: employer.members.filter(
        (member) => !opened.has(member.id)
      ).length,
      overConsumptionCeiling: ceiling !== null && consumption > ceiling,
    }
  })

  const monthly = new Map<string, MonthlyPoint>()
  for (const bucket of monthlyRows) {
    const key = `${bucket.periodYear}-${bucket.periodMonth}`
    const point =
      monthly.get(key) ??
      ({
        year: bucket.periodYear,
        month: bucket.periodMonth,
        contributions: 0,
        consumption: 0,
      } satisfies MonthlyPoint)

    if (bucket.type === "CONSUMPTION") {
      point.consumption += Number(bucket._sum.debit ?? 0)
    } else {
      point.contributions += Number(bucket._sum.credit ?? 0)
    }
    monthly.set(key, point)
  }

  const categories = await db.ipmServiceCategory.findMany({
    where: { firmId: ctx.firmId },
    select: { id: true, label: true },
  })
  const categoryLabel = new Map(
    categories.map((category) => [category.id, category.label])
  )

  const totalContributions = employerRows.reduce(
    (sum, row) => sum + row.contributions,
    0
  )
  const totalConsumption = employerRows.reduce(
    (sum, row) => sum + row.consumption,
    0
  )

  const unopenedTotal = employerRows.reduce(
    (sum, row) => sum + row.unopenedLedgers,
    0
  )

  // Cheap sweep for cached balances that no longer match their register.
  const [drifted] = await db.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM (
      SELECT m."id"
      FROM "ipm_members" m
      LEFT JOIN "ipm_ledger_entries" l ON l."memberId" = m."id"
      WHERE m."firmId" = ${ctx.firmId}
      GROUP BY m."id", m."currentBalance"
      HAVING COALESCE(SUM(l."credit" - l."debit"), 0) <> m."currentBalance"
    ) t
  `

  const staleCards = await countStaleCards(ctx)

  const belowOne = employerRows.filter(
    (row) => row.ratio !== null && row.ratio < 1
  )

  return {
    alerts: buildAlerts({
      firmSlug,
      membersOverDebtCeiling: debtCeilingBreaches(employers),
      employersOverConsumptionCeiling: {
        count: employerRows.filter((row) => row.overConsumptionCeiling).length,
        names: employerRows
          .filter((row) => row.overConsumptionCeiling)
          .map((row) => row.employerName),
      },
      employersRatioBelowOne: {
        count: belowOne.length,
        worst:
          belowOne.length > 0
            ? [...belowOne].sort((a, b) => (a.ratio ?? 0) - (b.ratio ?? 0))[0]
                .employerName
            : null,
      },
      overdueInvoices: {
        count: overdueInvoices.length,
        total: overdueInvoices.reduce(
          (sum, invoice) =>
            sum + Number(invoice.totalAmount) - Number(invoice.paidAmount),
          0
        ),
      },
      unopenedLedgers: unopenedTotal,
      incoherentLedgers: drifted?.n ?? 0,
      invoicesWithVariance: {
        count: varianceInvoices.filter(
          (invoice) =>
            Number(invoice.totalAmount) !== Number(invoice.matchedAmount)
        ).length,
        total: varianceInvoices.reduce(
          (sum, invoice) =>
            sum + Number(invoice.totalAmount) - Number(invoice.matchedAmount),
          0
        ),
      },
      staleCards,
    }),
    headline: {
      activeMembers,
      dependents,
      monthlyContributions: Number(monthlyContributions._sum.monthlyAmount ?? 0),
      outstandingCommitment: Number(outstanding._sum.insurerShare ?? 0),
      ratio: contributionRatio(totalContributions, totalConsumption),
    },
    employers: employerRows,
    monthly: [...monthly.values()].sort(
      (a, b) => a.year - b.year || a.month - b.month
    ),
    topCategories: categoryRows
      .map((bucket) => ({
        label: categoryLabel.get(bucket.categoryId) ?? "—",
        insurerShare: Number(bucket._sum.insurerShare ?? 0),
        count: bucket._count._all,
      }))
      .sort((a, b) => b.insurerShare - a.insurerShare),
    incompleteData: unopenedTotal > 0,
  }
}

function debtCeilingBreaches(
  employers: {
    debtCeiling: unknown
    members: { currentBalance: unknown }[]
  }[]
): { count: number; total: number } {
  let count = 0
  let total = 0

  for (const employer of employers) {
    const ceiling = employer.debtCeiling ? Number(employer.debtCeiling) : null
    if (ceiling === null) continue
    for (const member of employer.members) {
      const balance = Number(member.currentBalance)
      if (balance < -ceiling) {
        count += 1
        total += -balance
      }
    }
  }

  return { count, total }
}

/**
 * Cards whose printed content has moved on.
 *
 * Delegates to `listCards`, which is the one implementation that knows what a
 * card prints — rates included. Recomputing the hash here from a subset of
 * those fields would be cheaper and always wrong: every card would differ from
 * its stored hash, and the dashboard would report the entire roster as stale
 * for ever.
 */
async function countStaleCards(ctx: FirmContext): Promise<number> {
  const cards = await listCards(ctx)
  return cards.filter((card) => card.state === "STALE").length
}
