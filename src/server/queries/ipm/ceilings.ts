import "server-only"

import type { Prisma } from "@prisma/client"

import { db } from "@/lib/db"
import {
  tryResolveRate,
  type CeilingSource,
  type MemberCeilingRow,
  type RateRow,
} from "@/server/domain/ipm/rates"

/**
 * Plafonds particuliers in force on a date — the rows `resolveRate` takes as
 * `memberCeilings`. One loader, so issuance, the fiche and the portal agree on
 * which row is "in force": `validFrom <= on < validTo`.
 */
export async function memberCeilingsOn(
  firmId: string,
  memberId: string,
  on: Date,
  client: Prisma.TransactionClient | typeof db = db
): Promise<MemberCeilingRow[]> {
  const rows = await client.ipmMemberCeiling.findMany({
    where: {
      firmId,
      memberId,
      validFrom: { lte: on },
      OR: [{ validTo: null }, { validTo: { gt: on } }],
    },
    orderBy: { validFrom: "desc" },
    select: {
      categoryId: true,
      ceilingPerAct: true,
      ceilingMonthly: true,
      ceilingAnnual: true,
    },
  })

  // One per category; the most recent wins if periods were ever left to overlap.
  const seen = new Set<string>()
  const result: MemberCeilingRow[] = []
  for (const row of rows) {
    if (seen.has(row.categoryId)) continue
    seen.add(row.categoryId)
    result.push({
      categoryId: row.categoryId,
      ceilingPerAct: row.ceilingPerAct === null ? null : Number(row.ceilingPerAct),
      ceilingMonthly: row.ceilingMonthly === null ? null : Number(row.ceilingMonthly),
      ceilingAnnual: row.ceilingAnnual === null ? null : Number(row.ceilingAnnual),
    })
  }
  return result
}

/* ==========================================================================
 * The barème as screens show it
 * ========================================================================== */

export type CeilingCell = { value: number | null; source: CeilingSource | null }

export type LevelValues = {
  rate: number | null
  ceilingPerAct: number | null
  ceilingMonthly: number | null
  ceilingAnnual: number | null
  waitingPeriodDays: number | null
}

export type CategoryCoverage = {
  categoryId: string
  categoryCode: string
  categoryLabel: string
  /** The formule's catch-all row, if the employer has a formule. */
  plan: LevelValues | null
  /** The employer's catch-all dérogation, if any. */
  employer: (LevelValues & { id: string }) | null
  /** Resolved for the participant themselves, without any plafond particulier. */
  inherited: Resolved | null
  /** Resolved with the plafonds particuliers — what a bon is checked against. */
  effective: Resolved | null
  /** The plafond particulier in force, if any. */
  member: {
    id: string
    ceilingPerAct: number | null
    ceilingMonthly: number | null
    ceilingAnnual: number | null
    reason: string
    validFrom: Date
    authorName: string | null
  } | null
}

type Resolved = {
  rate: number
  rateSource: "EMPLOYER" | "PLAN"
  perAct: CeilingCell
  monthly: CeilingCell
  annual: CeilingCell
  waitingPeriodDays: number
}

const RATE_SELECT = {
  categoryId: true,
  beneficiaryType: true,
  rate: true,
  ceilingPerAct: true,
  ceilingMonthly: true,
  ceilingAnnual: true,
  waitingPeriodDays: true,
} as const

const n = (value: Prisma.Decimal | null) => (value === null ? null : Number(value))

function toRows(
  rows: {
    categoryId: string
    beneficiaryType: RateRow["beneficiaryType"]
    rate: Prisma.Decimal
    ceilingPerAct: Prisma.Decimal | null
    ceilingMonthly: Prisma.Decimal | null
    ceilingAnnual: Prisma.Decimal | null
    waitingPeriodDays: number | null
  }[]
): RateRow[] {
  return rows.map((row) => ({
    categoryId: row.categoryId,
    beneficiaryType: row.beneficiaryType,
    rate: Number(row.rate),
    ceilingPerAct: n(row.ceilingPerAct),
    ceilingMonthly: n(row.ceilingMonthly),
    ceilingAnnual: n(row.ceilingAnnual),
    waitingPeriodDays: row.waitingPeriodDays,
  }))
}

function levelOf(row: RateRow | undefined): LevelValues | null {
  if (!row) return null
  return {
    rate: row.rate,
    ceilingPerAct: row.ceilingPerAct,
    ceilingMonthly: row.ceilingMonthly,
    ceilingAnnual: row.ceilingAnnual,
    waitingPeriodDays: row.waitingPeriodDays,
  }
}

function resolveFor(
  category: { id: string; code: string },
  employerRates: RateRow[],
  planRates: RateRow[],
  memberCeilings: MemberCeilingRow[]
): Resolved | null {
  const resolved = tryResolveRate({
    categoryId: category.id,
    categoryCode: category.code,
    beneficiaryType: "MEMBER",
    employerRates,
    planRates,
    memberCeilings,
  })
  if (!resolved) return null
  return {
    rate: resolved.rate,
    rateSource: resolved.source,
    perAct: { value: resolved.ceilingPerAct, source: resolved.ceilingSource.perAct },
    monthly: { value: resolved.ceilingMonthly, source: resolved.ceilingSource.monthly },
    annual: { value: resolved.ceilingAnnual, source: resolved.ceilingSource.annual },
    waitingPeriodDays: resolved.waitingPeriodDays,
  }
}

/**
 * Per category: each level's own values and the resolved result. Both screens
 * — the employer's barème and the participant's plafonds particuliers — read
 * this, and both resolve through `resolveRate`, so what they show is what a bon
 * is checked against.
 */
export async function coverageFor(
  ctx: { firmId: string },
  args: { employerId: string; memberId?: string },
  on: Date = new Date()
): Promise<CategoryCoverage[] | null> {
  const employer = await db.ipmEmployer.findFirst({
    where: { id: args.employerId, firmId: ctx.firmId },
    select: { id: true, planId: true, rates: { select: { id: true, ...RATE_SELECT } } },
  })
  if (!employer) return null

  const [categories, planRates, memberRows] = await Promise.all([
    db.ipmServiceCategory.findMany({
      where: { firmId: ctx.firmId, active: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: { id: true, code: true, label: true },
    }),
    employer.planId
      ? db.ipmPlanRate.findMany({
          where: { firmId: ctx.firmId, planId: employer.planId },
          select: RATE_SELECT,
        })
      : Promise.resolve([]),
    args.memberId
      ? db.ipmMemberCeiling.findMany({
          where: {
            firmId: ctx.firmId,
            memberId: args.memberId,
            validFrom: { lte: on },
            OR: [{ validTo: null }, { validTo: { gt: on } }],
          },
          orderBy: { validFrom: "desc" },
          select: {
            id: true,
            categoryId: true,
            ceilingPerAct: true,
            ceilingMonthly: true,
            ceilingAnnual: true,
            reason: true,
            validFrom: true,
            createdBy: { select: { name: true, email: true } },
          },
        })
      : Promise.resolve([]),
  ])

  const employerRows = toRows(employer.rates)
  const planRows = toRows(planRates)
  const memberCeilings: MemberCeilingRow[] = memberRows.map((row) => ({
    categoryId: row.categoryId,
    ceilingPerAct: n(row.ceilingPerAct),
    ceilingMonthly: n(row.ceilingMonthly),
    ceilingAnnual: n(row.ceilingAnnual),
  }))

  return categories.map((category) => {
    const employerAll = employer.rates.find(
      (row) => row.categoryId === category.id && row.beneficiaryType === "ALL"
    )
    const member = memberRows.find((row) => row.categoryId === category.id)
    return {
      categoryId: category.id,
      categoryCode: category.code,
      categoryLabel: category.label,
      plan: levelOf(
        planRows.find((row) => row.categoryId === category.id && row.beneficiaryType === "ALL")
      ),
      employer: employerAll
        ? { id: employerAll.id, ...levelOf(toRows([employerAll])[0])! }
        : null,
      inherited: resolveFor(category, employerRows, planRows, []),
      effective: resolveFor(category, employerRows, planRows, memberCeilings),
      member: member
        ? {
            id: member.id,
            ceilingPerAct: n(member.ceilingPerAct),
            ceilingMonthly: n(member.ceilingMonthly),
            ceilingAnnual: n(member.ceilingAnnual),
            reason: member.reason,
            validFrom: member.validFrom,
            authorName: member.createdBy?.name ?? member.createdBy?.email ?? null,
          }
        : null,
    }
  })
}
