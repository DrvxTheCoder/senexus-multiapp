import "server-only"

import type { Prisma } from "@prisma/client"

import { db } from "@/lib/db"
import type { FirmContext } from "@/server/auth/require-firm-access"
import { beneficiaryTypeFor } from "@/server/domain/ipm/coverage"
import type { IssuanceFacts } from "@/server/domain/ipm/issuance"
import { tryResolveRate, type RateRow } from "@/server/domain/ipm/rates"
import {
  VOUCHER_STATUS_LABELS,
  VOUCHER_TYPE_LABELS,
  type VoucherQuery,
} from "@/lib/queries/ipm/voucher-query"
import type { Facets, Paged } from "@/server/queries/types"

/**
 * Bons — the list, and the facts an issuance decision needs.
 *
 * `gatherIssuanceFacts` is the important half. It is the only place that knows
 * how to assemble the seven inputs §5 checks against, and it deliberately
 * returns *facts* rather than a verdict: the decision itself is pure and lives
 * in `decideIssuance`, so the rules can be tested without a database and the
 * same facts can be shown to the operator before they commit.
 */

const toRateRows = (
  rows: {
    categoryId: string
    beneficiaryType: string
    rate: unknown
    ceilingPerAct: unknown
    ceilingMonthly: unknown
    ceilingAnnual: unknown
    waitingPeriodDays: number | null
  }[]
): RateRow[] =>
  rows.map((row) => ({
    categoryId: row.categoryId,
    beneficiaryType: row.beneficiaryType as RateRow["beneficiaryType"],
    rate: Number(row.rate),
    ceilingPerAct: row.ceilingPerAct === null ? null : Number(row.ceilingPerAct),
    ceilingMonthly:
      row.ceilingMonthly === null ? null : Number(row.ceilingMonthly),
    ceilingAnnual: row.ceilingAnnual === null ? null : Number(row.ceilingAnnual),
    waitingPeriodDays: row.waitingPeriodDays,
  }))

/** `member:<id>` or `dependent:<id>` — what consumption accumulates against. */
export function beneficiaryRef(
  memberId: string,
  dependentId: string | null
): string {
  return dependentId ? `dependent:${dependentId}` : `member:${memberId}`
}

export type IssuanceContext = {
  facts: IssuanceFacts
  /** Resolved alongside the rate, so the voucher can record where it came from. */
  rateSource: "EMPLOYER" | "PLAN" | null
  categoryId: string
  categoryLabel: string
  beneficiaryName: string
  beneficiaryType: RateRow["beneficiaryType"]
  memberMatricule: string
  employerName: string
}

/**
 * Everything §5 needs, in one pass.
 *
 * Reads at a point in time and hands the caller a plain object. Nothing here
 * decides; `decideIssuance` does, which is what keeps the rules testable.
 */
export async function gatherIssuanceFacts(
  ctx: FirmContext,
  input: {
    memberId: string
    dependentId: string | null
    providerId: string
    serviceTypeId: string
    totalAmount: number
    on?: Date
  },
  client: Prisma.TransactionClient | typeof db = db
): Promise<IssuanceContext | null> {
  const on = input.on ?? new Date()

  const [member, provider, serviceType] = await Promise.all([
    client.member.findFirst({
      where: { id: input.memberId, firmId: ctx.firmId },
      select: {
        id: true,
        matricule: true,
        status: true,
        person: { select: { firstName: true, lastName: true } },
        employer: {
          select: {
            ageMajority: true,
            planId: true,
            reminderDelayDays: true,
            suspensionDelayDays: true,
            organization: { select: { name: true } },
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
        // Always selected, narrowed by the predicate rather than by making the
        // whole relation conditional: a conditional `select` gives Prisma a
        // union type the caller cannot narrow. When no ayant droit is named,
        // the filter matches nothing and the list comes back empty.
        //
        // Scoping on `id` *within the member's own dependents* is also the
        // check that an id belonging to another family cannot resolve here.
        dependents: {
          where: { id: input.dependentId ?? "" },
          select: {
            id: true,
            relation: true,
            status: true,
            coverageStart: true,
            coverageEnd: true,
            person: {
              select: { firstName: true, lastName: true, birthDate: true },
            },
          },
        },
      },
    }),
    client.ipmProvider.findFirst({
      where: { id: input.providerId, firmId: ctx.firmId },
      select: {
        id: true,
        accredited: true,
        status: true,
        agreements: {
          where: {
            status: "ACTIVE",
            startDate: { lte: on },
            OR: [{ endDate: null }, { endDate: { gte: on } }],
          },
          select: { id: true },
          take: 1,
        },
      },
    }),
    client.ipmServiceType.findFirst({
      where: { id: input.serviceTypeId, firmId: ctx.firmId },
      select: {
        id: true,
        categoryId: true,
        category: { select: { id: true, code: true, label: true } },
      },
    }),
  ])

  if (!member || !provider || !serviceType) return null

  const dependent =
    input.dependentId && member.dependents.length ? member.dependents[0] : null

  // An id that belongs to another family must not resolve as this family's.
  if (input.dependentId && !dependent) return null

  const beneficiaryType = dependent
    ? beneficiaryTypeFor(dependent.relation)
    : ("MEMBER" as const)

  const planRates = member.employer.planId
    ? await client.ipmPlanRate.findMany({
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
    : []

  const resolved = tryResolveRate({
    categoryId: serviceType.categoryId,
    categoryCode: serviceType.category.code,
    beneficiaryType,
    employerRates: toRateRows(member.employer.rates),
    planRates: toRateRows(planRates),
  })

  const ref = beneficiaryRef(member.id, dependent?.id ?? null)
  const year = on.getFullYear()
  const month = on.getMonth() + 1

  const [monthConsumed, yearConsumed, lastInCategory, lastPaid] =
    await Promise.all([
      client.ipmConsumption.aggregate({
        where: {
          firmId: ctx.firmId,
          beneficiaryRef: ref,
          categoryId: serviceType.categoryId,
          periodYear: year,
          periodMonth: month,
        },
        _sum: { insurerShare: true },
      }),
      client.ipmConsumption.aggregate({
        where: {
          firmId: ctx.firmId,
          beneficiaryRef: ref,
          categoryId: serviceType.categoryId,
          periodYear: year,
        },
        _sum: { insurerShare: true },
      }),
      client.ipmVoucher.findFirst({
        where: {
          firmId: ctx.firmId,
          memberId: member.id,
          dependentId: dependent?.id ?? null,
          categoryId: serviceType.categoryId,
          status: { notIn: ["CANCELLED", "EXPIRED"] },
        },
        orderBy: { issueDate: "desc" },
        select: { issueDate: true },
      }),
      // The cotisation the family is settled through. Phase 3 replaces this
      // with the ledger; today it is the end of the last closed period.
      client.ipmMemberContribution.findFirst({
        where: { firmId: ctx.firmId, memberId: member.id },
        orderBy: { validFrom: "desc" },
        select: { validFrom: true },
      }),
    ])

  const facts: IssuanceFacts = {
    on,
    memberStatus: member.status,
    dependent: dependent
      ? {
          memberStatus: member.status,
          relation: dependent.relation,
          dependentStatus: dependent.status,
          coverageStart: dependent.coverageStart,
          coverageEnd: dependent.coverageEnd,
          birthDate: dependent.person.birthDate,
          ageMajority: member.employer.ageMajority,
        }
      : null,
    reminderDelayDays: member.employer.reminderDelayDays,
    suspensionDelayDays: member.employer.suspensionDelayDays,
    contributionsPaidThrough: lastPaid?.validFrom ?? null,
    provider: {
      accredited: provider.accredited,
      status: provider.status,
      hasLiveAgreement: provider.agreements.length > 0,
    },
    rate: resolved?.rate ?? null,
    totalAmount: input.totalAmount,
    ceilings: {
      perAct: resolved?.ceilingPerAct ?? null,
      monthly: resolved?.ceilingMonthly ?? null,
      annual: resolved?.ceilingAnnual ?? null,
    },
    consumed: {
      month: Number(monthConsumed._sum.insurerShare ?? 0),
      year: Number(yearConsumed._sum.insurerShare ?? 0),
    },
    waitingPeriodDays: resolved?.waitingPeriodDays ?? 0,
    lastIssuedInCategory: lastInCategory?.issueDate ?? null,
  }

  return {
    facts,
    rateSource: resolved?.source ?? null,
    categoryId: serviceType.categoryId,
    categoryLabel: serviceType.category.label,
    beneficiaryName: dependent
      ? `${dependent.person.lastName.toUpperCase()} ${dependent.person.firstName}`
      : `${member.person.lastName.toUpperCase()} ${member.person.firstName}`,
    beneficiaryType,
    memberMatricule: member.matricule,
    employerName: member.employer.organization.name,
  }
}

/* ==========================================================================
 * Liste
 * ========================================================================== */

export type VoucherRow = {
  id: string
  number: string
  type: string
  status: string
  issueDate: Date
  expiryDate: Date
  beneficiaryName: string
  memberId: string
  memberMatricule: string
  providerName: string
  categoryLabel: string
  totalAmount: number
  insurerShare: number
  memberShare: number
  appliedRate: number
  /** True when the bon is past its expiry and still in circulation. */
  lapsed: boolean
}

function where(q: VoucherQuery, ctx: FirmContext): Prisma.IpmVoucherWhereInput {
  const clauses: Prisma.IpmVoucherWhereInput = { firmId: ctx.firmId }

  if (q.search) {
    const contains = { contains: q.search, mode: "insensitive" as const }
    clauses.OR = [
      { number: contains },
      { beneficiaryName: contains },
      { member: { matricule: contains } },
      // The WebLamps form too, so a number read off an old document finds it.
      { member: { legacyCode: contains } },
      { provider: { name: contains } },
    ]
  }

  if (q.status?.length) clauses.status = { in: q.status }
  if (q.type?.length) clauses.type = { in: q.type }
  if (q.providerId?.length) clauses.providerId = { in: q.providerId }
  if (q.categoryId?.length) clauses.categoryId = { in: q.categoryId }
  if (q.memberId) clauses.memberId = q.memberId

  if (q.from || q.to) {
    clauses.issueDate = {
      ...(q.from ? { gte: new Date(`${q.from}T00:00:00.000Z`) } : {}),
      ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999Z`) } : {}),
    }
  }

  return clauses
}

function orderBy(
  sort: VoucherQuery["sort"]
): Prisma.IpmVoucherOrderByWithRelationInput[] {
  const columns: Record<
    string,
    (d: "asc" | "desc") => Prisma.IpmVoucherOrderByWithRelationInput
  > = {
    number: (d) => ({ number: d }),
    issueDate: (d) => ({ issueDate: d }),
    beneficiary: (d) => ({ beneficiaryName: d }),
    provider: (d) => ({ provider: { name: d } }),
    totalAmount: (d) => ({ totalAmount: d }),
    insurerShare: (d) => ({ insurerShare: d }),
    status: (d) => ({ status: d }),
  }

  const clauses = sort
    .filter((entry) => entry.id in columns)
    .map((entry) => columns[entry.id](entry.desc ? "desc" : "asc"))

  // Most recent first: a bons list is read from the top by recency.
  if (clauses.length === 0) return [{ issueDate: "desc" }, { number: "desc" }]
  return [...clauses, { number: "desc" }]
}

/**
 * Facet counts exclude their own filter, so a chip still reports how many rows
 * it would bring back rather than the count of what is already selected.
 */
async function voucherFacets(
  ctx: FirmContext,
  q: VoucherQuery
): Promise<Facets> {
  const { status: _s, type: _t, providerId: _p, categoryId: _c, ...rest } = q

  const [byStatus, byType, byProvider, byCategory, providers, categories] =
    await Promise.all([
      db.ipmVoucher.groupBy({
        by: ["status"],
        where: where({ ...rest, type: q.type, providerId: q.providerId, categoryId: q.categoryId } as VoucherQuery, ctx),
        _count: { _all: true },
      }),
      db.ipmVoucher.groupBy({
        by: ["type"],
        where: where({ ...rest, status: q.status, providerId: q.providerId, categoryId: q.categoryId } as VoucherQuery, ctx),
        _count: { _all: true },
      }),
      db.ipmVoucher.groupBy({
        by: ["providerId"],
        where: where({ ...rest, status: q.status, type: q.type, categoryId: q.categoryId } as VoucherQuery, ctx),
        _count: { _all: true },
      }),
      db.ipmVoucher.groupBy({
        by: ["categoryId"],
        where: where({ ...rest, status: q.status, type: q.type, providerId: q.providerId } as VoucherQuery, ctx),
        _count: { _all: true },
      }),
      db.ipmProvider.findMany({
        where: { firmId: ctx.firmId },
        select: { id: true, name: true },
      }),
      db.ipmServiceCategory.findMany({
        where: { firmId: ctx.firmId },
        select: { id: true, label: true },
      }),
    ])

  const providerName = new Map(providers.map((p) => [p.id, p.name]))
  const categoryLabel = new Map(categories.map((c) => [c.id, c.label]))

  return {
    status: byStatus.map((bucket) => ({
      value: bucket.status,
      label: VOUCHER_STATUS_LABELS[bucket.status] ?? bucket.status,
      count: bucket._count._all,
    })),
    type: byType.map((bucket) => ({
      value: bucket.type,
      label: VOUCHER_TYPE_LABELS[bucket.type] ?? bucket.type,
      count: bucket._count._all,
    })),
    provider: byProvider
      .map((bucket) => ({
        value: bucket.providerId,
        label: providerName.get(bucket.providerId) ?? "—",
        count: bucket._count._all,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr")),
    category: byCategory
      .map((bucket) => ({
        value: bucket.categoryId,
        label: categoryLabel.get(bucket.categoryId) ?? "—",
        count: bucket._count._all,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr")),
  }
}

export async function listVouchers(
  ctx: FirmContext,
  q: VoucherQuery
): Promise<Paged<VoucherRow>> {
  const clauses = where(q, ctx)
  const now = new Date()

  const [total, rows, facets] = await Promise.all([
    db.ipmVoucher.count({ where: clauses }),
    db.ipmVoucher.findMany({
      where: clauses,
      orderBy: orderBy(q.sort),
      skip: (q.page - 1) * q.perPage,
      take: q.perPage,
      select: {
        id: true,
        number: true,
        type: true,
        status: true,
        issueDate: true,
        expiryDate: true,
        beneficiaryName: true,
        memberId: true,
        totalAmount: true,
        insurerShare: true,
        memberShare: true,
        appliedRate: true,
        member: { select: { matricule: true } },
        provider: { select: { name: true } },
        category: { select: { label: true } },
      },
    }),
    voucherFacets(ctx, q),
  ])

  return {
    rows: rows.map((row) => ({
      id: row.id,
      number: row.number,
      type: row.type,
      status: row.status,
      issueDate: row.issueDate,
      expiryDate: row.expiryDate,
      beneficiaryName: row.beneficiaryName,
      memberId: row.memberId,
      memberMatricule: row.member.matricule,
      providerName: row.provider.name,
      categoryLabel: row.category.label,
      totalAmount: Number(row.totalAmount),
      insurerShare: Number(row.insurerShare),
      memberShare: Number(row.memberShare),
      appliedRate: Number(row.appliedRate),
      // Derived, never stored: a bon does not lapse by being written to, it
      // lapses by a date passing.
      lapsed:
        row.expiryDate < now &&
        ["ISSUED", "PRESENTED"].includes(row.status),
    })),
    total,
    page: q.page,
    perPage: q.perPage,
    pageCount: Math.max(1, Math.ceil(total / q.perPage)),
    facets,
  }
}

export type VoucherSummary = {
  issued: number
  settled: number
  /** Insurer share committed but not yet settled — the open exposure. */
  outstanding: number
  settledThisMonth: number
}

export async function voucherSummary(ctx: FirmContext): Promise<VoucherSummary> {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const [issued, settled, outstanding, month] = await Promise.all([
    db.ipmVoucher.count({
      where: { firmId: ctx.firmId, status: { in: ["ISSUED", "PRESENTED"] } },
    }),
    db.ipmVoucher.count({
      where: { firmId: ctx.firmId, status: { in: ["SETTLED", "INVOICED"] } },
    }),
    db.ipmVoucher.aggregate({
      where: { firmId: ctx.firmId, status: { in: ["ISSUED", "PRESENTED"] } },
      _sum: { insurerShare: true },
    }),
    db.ipmVoucher.aggregate({
      where: {
        firmId: ctx.firmId,
        status: { in: ["SETTLED", "INVOICED"] },
        settledAt: { gte: monthStart },
      },
      _sum: { insurerShare: true },
    }),
  ])

  return {
    issued,
    settled,
    outstanding: Number(outstanding._sum.insurerShare ?? 0),
    settledThisMonth: Number(month._sum.insurerShare ?? 0),
  }
}

export async function getVoucher(ctx: FirmContext, voucherId: string) {
  return db.ipmVoucher.findFirst({
    where: { id: voucherId, firmId: ctx.firmId },
    select: {
      id: true,
      number: true,
      type: true,
      status: true,
      issueDate: true,
      expiryDate: true,
      beneficiaryName: true,
      beneficiaryType: true,
      totalAmount: true,
      insurerShare: true,
      memberShare: true,
      appliedRate: true,
      rateSource: true,
      settledAt: true,
      cancelledAt: true,
      cancelReason: true,
      qrToken: true,
      member: {
        select: {
          id: true,
          matricule: true,
          person: { select: { firstName: true, lastName: true } },
        },
      },
      provider: { select: { id: true, name: true } },
      category: { select: { label: true } },
      serviceType: { select: { code: true, label: true } },
      issuedBy: { select: { name: true, email: true } },
      settledBy: { select: { name: true, email: true } },
      lines: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          label: true,
          quantity: true,
          unitPrice: true,
          amount: true,
        },
      },
    },
  })
}
