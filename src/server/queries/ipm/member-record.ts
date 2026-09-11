import "server-only"

import { db } from "@/lib/db"
import type { FirmContext } from "@/server/auth/require-firm-access"
import {
  isDependentCovered,
  majorityDate,
  type CoverageRefusal,
} from "@/server/domain/ipm/coverage"
import {
  contributionOn,
  currentContribution,
  findOverlaps,
  type ContributionPeriod,
} from "@/server/domain/ipm/contribution"
import { tryResolveRate, type RateRow } from "@/server/domain/ipm/rates"

/**
 * La fiche participant — the record, not a summary.
 *
 * A participant is a place Rokhaya works rather than a row she glances at, so
 * this loads the whole file in one pass: identity, employer, the family, the
 * cotisation history and the taux that actually apply. The rates are resolved
 * here, through the same `resolveRate` the settlement engine will use, so the
 * figure printed on a card and the figure a bon is settled at come from one
 * implementation.
 */

export type DependentEntry = {
  id: string
  matricule: string
  firstName: string
  lastName: string
  photoUrl: string | null
  relation: string
  rank: number
  birthDate: Date | null
  status: string
  coverageStart: Date
  coverageEnd: Date | null
  covered: boolean
  refusal: CoverageRefusal | null
  refusalMessage: string | null
  /** When a child ages out. Null for everyone else. */
  agesOutOn: Date | null
}

export type ContributionEntry = ContributionPeriod & {
  planCode: string | null
  authorName: string | null
  current: boolean
}

export type ResolvedCategoryRate = {
  categoryId: string
  categoryCode: string
  categoryLabel: string
  rate: number | null
  source: "EMPLOYER" | "PLAN" | null
  waitingPeriodDays: number | null
  ceilingPerAct: number | null
  ceilingAnnual: number | null
}

export type MemberRecord = {
  id: string
  matricule: string
  legacyCode: string | null
  status: string
  jobTitle: string | null
  affiliationDate: Date
  terminationDate: Date | null
  person: {
    id: string
    firstName: string
    lastName: string
    birthDate: Date | null
    birthPlace: string | null
    gender: string | null
    nationalId: string | null
    phone: string | null
    email: string | null
    address: string | null
    photoUrl: string | null
  }
  employer: {
    id: string
    name: string
    ageMajority: number
    planId: string | null
    planCode: string | null
    planName: string | null
  }
  /** The HR employment that drives this affiliation, when there is one. */
  employment: { id: string; firmSlug: string; matricule: string } | null
  dependents: DependentEntry[]
  contributions: ContributionEntry[]
  currentContribution: ContributionEntry | null
  /** Non-empty only when the cotisation history is broken. Shown, not hidden. */
  contributionOverlaps: number
  rates: ResolvedCategoryRate[]
}

function toRateRows(
  rows: {
    categoryId: string
    beneficiaryType: string
    rate: unknown
    ceilingPerAct: unknown
    ceilingMonthly: unknown
    ceilingAnnual: unknown
    waitingPeriodDays: number | null
  }[]
): RateRow[] {
  return rows.map((row) => ({
    categoryId: row.categoryId,
    beneficiaryType: row.beneficiaryType as RateRow["beneficiaryType"],
    rate: Number(row.rate),
    ceilingPerAct: row.ceilingPerAct === null ? null : Number(row.ceilingPerAct),
    ceilingMonthly:
      row.ceilingMonthly === null ? null : Number(row.ceilingMonthly),
    ceilingAnnual: row.ceilingAnnual === null ? null : Number(row.ceilingAnnual),
    waitingPeriodDays: row.waitingPeriodDays,
  }))
}

export async function getMemberRecord(
  ctx: FirmContext,
  memberId: string,
  on: Date = new Date()
): Promise<MemberRecord | null> {
  const member = await db.member.findFirst({
    // firmId in the where, not a check after the fetch: a member id from
    // another firm must not resolve at all (§7).
    where: { id: memberId, firmId: ctx.firmId },
    select: {
      id: true,
      matricule: true,
      legacyCode: true,
      status: true,
      jobTitle: true,
      affiliationDate: true,
      terminationDate: true,
      person: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          birthDate: true,
          birthPlace: true,
          gender: true,
          nationalId: true,
          phone: true,
          email: true,
          address: true,
          photoUrl: true,
        },
      },
      employee: {
        select: { id: true, matricule: true, firm: { select: { slug: true } } },
      },
      employer: {
        select: {
          id: true,
          ageMajority: true,
          planId: true,
          organization: { select: { name: true } },
          plan: { select: { id: true, code: true, name: true } },
          rates: {
            select: {
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
      },
      dependents: {
        orderBy: { rank: "asc" },
        select: {
          id: true,
          matricule: true,
          relation: true,
          rank: true,
          status: true,
          coverageStart: true,
          coverageEnd: true,
          person: {
            select: {
              firstName: true,
              lastName: true,
              birthDate: true,
              photoUrl: true,
            },
          },
        },
      },
      contributions: {
        orderBy: { validFrom: "desc" },
        select: {
          id: true,
          monthlyAmount: true,
          employerAmount: true,
          employeeAmount: true,
          validFrom: true,
          validTo: true,
          reason: true,
          planId: true,
          plan: { select: { code: true } },
          createdBy: { select: { name: true, email: true } },
        },
      },
    },
  })

  if (!member) return null

  const [categories, planRates] = await Promise.all([
    db.ipmServiceCategory.findMany({
      where: { firmId: ctx.firmId, active: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: { id: true, code: true, label: true },
    }),
    member.employer.planId
      ? db.ipmPlanRate.findMany({
          where: { firmId: ctx.firmId, planId: member.employer.planId },
          select: {
            categoryId: true,
            beneficiaryType: true,
            rate: true,
            ceilingPerAct: true,
            ceilingMonthly: true,
            ceilingAnnual: true,
            waitingPeriodDays: true,
          },
        })
      : Promise.resolve([]),
  ])

  const employerRateRows = toRateRows(member.employer.rates)
  const planRateRows = toRateRows(planRates)

  const rates: ResolvedCategoryRate[] = categories.map((category) => {
    const resolved = tryResolveRate({
      categoryId: category.id,
      categoryCode: category.code,
      // The participant themselves, not an ayant droit.
      beneficiaryType: "MEMBER",
      employerRates: employerRateRows,
      planRates: planRateRows,
    })

    return {
      categoryId: category.id,
      categoryCode: category.code,
      categoryLabel: category.label,
      rate: resolved?.rate ?? null,
      source: resolved?.source ?? null,
      waitingPeriodDays: resolved?.waitingPeriodDays ?? null,
      ceilingPerAct: resolved?.ceilingPerAct ?? null,
      ceilingAnnual: resolved?.ceilingAnnual ?? null,
    }
  })

  const periods: ContributionPeriod[] = member.contributions.map((row) => ({
    id: row.id,
    monthlyAmount: Number(row.monthlyAmount),
    employerAmount: row.employerAmount === null ? null : Number(row.employerAmount),
    employeeAmount: row.employeeAmount === null ? null : Number(row.employeeAmount),
    validFrom: row.validFrom,
    validTo: row.validTo,
    planId: row.planId,
    reason: row.reason,
  }))

  const open = currentContribution(periods)
  const contributions: ContributionEntry[] = member.contributions.map(
    (row, index) => ({
      ...periods[index],
      planCode: row.plan?.code ?? null,
      authorName: row.createdBy?.name ?? row.createdBy?.email ?? null,
      current: row.id === open?.id,
    })
  )

  const dependents: DependentEntry[] = member.dependents.map((dependent) => {
    const coverage = isDependentCovered(
      {
        memberStatus: member.status,
        relation: dependent.relation,
        dependentStatus: dependent.status,
        coverageStart: dependent.coverageStart,
        coverageEnd: dependent.coverageEnd,
        birthDate: dependent.person.birthDate,
        ageMajority: member.employer.ageMajority,
      },
      on
    )

    return {
      id: dependent.id,
      matricule: dependent.matricule,
      firstName: dependent.person.firstName,
      lastName: dependent.person.lastName,
      photoUrl: dependent.person.photoUrl,
      relation: dependent.relation,
      rank: dependent.rank,
      birthDate: dependent.person.birthDate,
      status: dependent.status,
      coverageStart: dependent.coverageStart,
      coverageEnd: dependent.coverageEnd,
      covered: coverage.covered,
      refusal: coverage.covered ? null : coverage.reason,
      refusalMessage: coverage.covered ? null : coverage.message,
      agesOutOn: majorityDate(
        dependent.relation,
        dependent.person.birthDate,
        member.employer.ageMajority
      ),
    }
  })

  const currentEntry =
    contributions.find((entry) => entry.current) ??
    // A record opened as of a past date shows what applied then, not today's.
    (() => {
      const at = contributionOn(periods, on)
      return at ? (contributions.find((entry) => entry.id === at.id) ?? null) : null
    })()

  return {
    id: member.id,
    matricule: member.matricule,
    legacyCode: member.legacyCode,
    status: member.status,
    jobTitle: member.jobTitle,
    affiliationDate: member.affiliationDate,
    terminationDate: member.terminationDate,
    person: member.person,
    employer: {
      id: member.employer.id,
      name: member.employer.organization.name,
      ageMajority: member.employer.ageMajority,
      planId: member.employer.planId,
      planCode: member.employer.plan?.code ?? null,
      planName: member.employer.plan?.name ?? null,
    },
    employment: member.employee
      ? {
          id: member.employee.id,
          firmSlug: member.employee.firm.slug,
          matricule: member.employee.matricule,
        }
      : null,
    dependents,
    contributions,
    currentContribution: currentEntry,
    contributionOverlaps: findOverlaps(periods).length,
    rates,
  }
}
