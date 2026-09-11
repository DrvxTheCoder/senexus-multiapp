import "server-only"

import { db } from "@/lib/db"
import type { FirmContext } from "@/server/auth/require-firm-access"

/**
 * Formules et barèmes.
 *
 * The screen is a matrix: formules down, catégories across, a taux in each
 * cell. What matters is that an **empty cell is shown as empty**, not as zero
 * — optique and hospitalisation have no barème yet (§8: 23 non-exportable
 * pages awaiting manual re-entry), and a zero would read as "nothing is
 * covered" rather than "nobody has told us yet". The settlement engine makes
 * the same distinction: a missing rate is an error, never a default.
 */

export type CategoryRef = {
  id: string
  code: string
  label: string
  sortOrder: number
  active: boolean
}

export type PlanRateCell = {
  id: string
  categoryId: string
  beneficiaryType: string
  rate: number
  ceilingPerAct: number | null
  ceilingMonthly: number | null
  ceilingAnnual: number | null
  waitingPeriodDays: number
}

export type PlanRow = {
  id: string
  code: string
  name: string
  monthlyPrice: number
  validFrom: Date
  validTo: Date | null
  active: boolean
  employerCount: number
  memberCount: number
  rates: PlanRateCell[]
  /** Categories with no rate at all. The gap, counted. */
  missingCategoryIds: string[]
}

export async function listCategories(ctx: FirmContext): Promise<CategoryRef[]> {
  return db.ipmServiceCategory.findMany({
    where: { firmId: ctx.firmId },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    select: { id: true, code: true, label: true, sortOrder: true, active: true },
  })
}

export async function listPlans(ctx: FirmContext): Promise<PlanRow[]> {
  const [categories, plans, memberCounts] = await Promise.all([
    listCategories(ctx),
    db.ipmPlan.findMany({
      where: { firmId: ctx.firmId },
      orderBy: [{ monthlyPrice: "desc" }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        monthlyPrice: true,
        validFrom: true,
        validTo: true,
        active: true,
        _count: { select: { employers: true } },
        rates: {
          select: {
            id: true,
            categoryId: true,
            beneficiaryType: true,
            rate: true,
            ceilingPerAct: true,
            ceilingMonthly: true,
            ceilingAnnual: true,
            waitingPeriodDays: true,
          },
        },
      },
    }),
    // Members reach a formule through their employer, so this is grouped on
    // the employer and folded in rather than counted per plan.
    db.member.groupBy({
      by: ["employerId"],
      where: { firmId: ctx.firmId },
      _count: { _all: true },
    }),
  ])

  const employers = await db.ipmEmployer.findMany({
    where: { firmId: ctx.firmId },
    select: { id: true, planId: true },
  })
  const membersByEmployer = new Map(
    memberCounts.map((bucket) => [bucket.employerId, bucket._count._all])
  )
  const membersByPlan = new Map<string, number>()
  for (const employer of employers) {
    if (!employer.planId) continue
    membersByPlan.set(
      employer.planId,
      (membersByPlan.get(employer.planId) ?? 0) +
        (membersByEmployer.get(employer.id) ?? 0)
    )
  }

  const activeCategoryIds = categories
    .filter((category) => category.active)
    .map((category) => category.id)

  return plans.map((plan) => {
    const rates = plan.rates.map((rate) => ({
      id: rate.id,
      categoryId: rate.categoryId,
      beneficiaryType: rate.beneficiaryType,
      rate: Number(rate.rate),
      ceilingPerAct: rate.ceilingPerAct ? Number(rate.ceilingPerAct) : null,
      ceilingMonthly: rate.ceilingMonthly ? Number(rate.ceilingMonthly) : null,
      ceilingAnnual: rate.ceilingAnnual ? Number(rate.ceilingAnnual) : null,
      waitingPeriodDays: rate.waitingPeriodDays,
    }))

    const covered = new Set(rates.map((rate) => rate.categoryId))

    return {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      monthlyPrice: Number(plan.monthlyPrice),
      validFrom: plan.validFrom,
      validTo: plan.validTo,
      active: plan.active,
      employerCount: plan._count.employers,
      memberCount: membersByPlan.get(plan.id) ?? 0,
      rates,
      missingCategoryIds: activeCategoryIds.filter((id) => !covered.has(id)),
    }
  })
}

export type EmployerRateRow = {
  employerId: string
  employerName: string
  rates: PlanRateCell[]
}

/** Dérogations, grouped by employer — they win over the formule (§5). */
export async function listEmployerRates(
  ctx: FirmContext
): Promise<EmployerRateRow[]> {
  const rows = await db.ipmEmployerRate.findMany({
    where: { firmId: ctx.firmId },
    orderBy: [{ employer: { organization: { name: "asc" } } }],
    select: {
      id: true,
      employerId: true,
      categoryId: true,
      beneficiaryType: true,
      rate: true,
      ceilingPerAct: true,
      ceilingMonthly: true,
      ceilingAnnual: true,
      waitingPeriodDays: true,
      employer: { select: { organization: { select: { name: true } } } },
    },
  })

  const byEmployer = new Map<string, EmployerRateRow>()
  for (const row of rows) {
    const entry = byEmployer.get(row.employerId) ?? {
      employerId: row.employerId,
      employerName: row.employer.organization.name,
      rates: [],
    }
    entry.rates.push({
      id: row.id,
      categoryId: row.categoryId,
      beneficiaryType: row.beneficiaryType,
      rate: Number(row.rate),
      ceilingPerAct: row.ceilingPerAct ? Number(row.ceilingPerAct) : null,
      ceilingMonthly: row.ceilingMonthly ? Number(row.ceilingMonthly) : null,
      ceilingAnnual: row.ceilingAnnual ? Number(row.ceilingAnnual) : null,
      waitingPeriodDays: row.waitingPeriodDays ?? 0,
    })
    byEmployer.set(row.employerId, entry)
  }

  return [...byEmployer.values()]
}
