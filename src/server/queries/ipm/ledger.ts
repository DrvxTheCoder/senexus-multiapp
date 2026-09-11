import "server-only"

import { db } from "@/lib/db"
import type { FirmContext } from "@/server/auth/require-firm-access"
import {
  balanceOf,
  findIncoherences,
  openingState,
  type LedgerEntry,
  type LedgerIncoherence,
} from "@/server/domain/ipm/ledger"

/**
 * Le registre, et le relevé par employeur — plan §4.8bis et §4.8quater.
 *
 * The statement is the document the plan says is missing today and that
 * justifies keeping the register at all: cotisations against consumption, per
 * participant, per employer. It is computed on demand as an aggregate rather
 * than stored, because a stored report is a second copy of the truth that
 * starts drifting the moment an adjustment is posted.
 */

export type LedgerRow = LedgerEntry & {
  sourceType: string
  sourceId: string | null
  note: string | null
  balanceAfter: number
  authorName: string | null
}

export type MemberLedger = {
  memberId: string
  matricule: string
  memberName: string
  employerName: string
  entries: LedgerRow[]
  balance: number
  /** Null when the register was never opened — §11 Q11. */
  openingAmount: number | null
  opened: boolean
  incoherences: LedgerIncoherence[]
}

export async function memberLedger(
  ctx: FirmContext,
  memberId: string
): Promise<MemberLedger | null> {
  const member = await db.member.findFirst({
    where: { id: memberId, firmId: ctx.firmId },
    select: {
      id: true,
      matricule: true,
      currentBalance: true,
      person: { select: { firstName: true, lastName: true } },
      employer: { select: { organization: { select: { name: true } } } },
      ledgerEntries: {
        orderBy: [
          { periodYear: "asc" },
          { periodMonth: "asc" },
          { createdAt: "asc" },
        ],
        select: {
          id: true,
          periodYear: true,
          periodMonth: true,
          type: true,
          sourceType: true,
          sourceId: true,
          credit: true,
          debit: true,
          balanceAfter: true,
          note: true,
          createdAt: true,
          createdBy: { select: { name: true, email: true } },
        },
      },
    },
  })

  if (!member) return null

  const entries: LedgerRow[] = member.ledgerEntries.map((row) => ({
    id: row.id,
    periodYear: row.periodYear,
    periodMonth: row.periodMonth,
    type: row.type,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    credit: Number(row.credit),
    debit: Number(row.debit),
    balanceAfter: Number(row.balanceAfter),
    note: row.note,
    createdAt: row.createdAt,
    authorName: row.createdBy?.name ?? row.createdBy?.email ?? null,
  }))

  const opening = openingState(entries)

  return {
    memberId: member.id,
    matricule: member.matricule,
    memberName: `${member.person.lastName.toUpperCase()} ${member.person.firstName}`,
    employerName: member.employer.organization.name,
    entries,
    balance: balanceOf(entries),
    openingAmount: opening.status === "SET" ? opening.amount : null,
    opened: opening.status === "SET",
    // Surfaced, never swallowed: the cached balance exists only because it can
    // be rebuilt and compared.
    incoherences: findIncoherences(entries, Number(member.currentBalance)),
  }
}

/* ==========================================================================
 * Relevé par employeur — §4.8quater
 * ========================================================================== */

export type StatementLine = {
  memberId: string
  matricule: string
  memberName: string
  dependentCount: number
  contributions: number
  consumption: number
  balance: number
  /** True when this member's register was never opened. */
  unopened: boolean
  /** True when the member is past the employer's debt ceiling. */
  overDebtCeiling: boolean
}

export type EmployerStatement = {
  employerId: string
  employerName: string
  from: { year: number; month: number }
  to: { year: number; month: number }
  lines: StatementLine[]
  totals: {
    members: number
    contributions: number
    consumption: number
    balance: number
    /** Cotisations ÷ consommation. Null when nothing was consumed. */
    ratio: number | null
  }
  debtCeiling: number | null
  unopenedCount: number
}

/**
 * Le relevé.
 *
 * One aggregate over the register, grouped per member, rather than a query per
 * participant — the 265 real members would otherwise be 265 round trips for a
 * document somebody prints monthly.
 *
 * Members whose register was never opened are counted and flagged rather than
 * quietly shown with a plausible-looking balance (§11 Q11).
 */
export async function employerStatement(
  ctx: FirmContext,
  employerId: string,
  range: { fromYear: number; fromMonth: number; toYear: number; toMonth: number }
): Promise<EmployerStatement | null> {
  const employer = await db.ipmEmployer.findFirst({
    where: { id: employerId, firmId: ctx.firmId },
    select: {
      id: true,
      debtCeiling: true,
      organization: { select: { name: true } },
    },
  })
  if (!employer) return null

  const members = await db.member.findMany({
    where: { firmId: ctx.firmId, employerId },
    orderBy: { matricule: "asc" },
    select: {
      id: true,
      matricule: true,
      person: { select: { firstName: true, lastName: true } },
      _count: { select: { dependents: true } },
    },
  })

  const memberIds = members.map((member) => member.id)
  if (memberIds.length === 0) {
    return {
      employerId: employer.id,
      employerName: employer.organization.name,
      from: { year: range.fromYear, month: range.fromMonth },
      to: { year: range.toYear, month: range.toMonth },
      lines: [],
      totals: { members: 0, contributions: 0, consumption: 0, balance: 0, ratio: null },
      debtCeiling: employer.debtCeiling ? Number(employer.debtCeiling) : null,
      unopenedCount: 0,
    }
  }

  // The period is expressed as (year, month) pairs, so the filter is on the
  // composite rather than on a date — the register has no day resolution.
  const inRange = {
    OR: [
      {
        periodYear: { gt: range.fromYear, lt: range.toYear },
      },
      {
        periodYear: range.fromYear,
        periodMonth: { gte: range.fromMonth },
        ...(range.fromYear === range.toYear
          ? { periodMonth: { gte: range.fromMonth, lte: range.toMonth } }
          : {}),
      },
      ...(range.fromYear === range.toYear
        ? []
        : [{ periodYear: range.toYear, periodMonth: { lte: range.toMonth } }]),
    ],
  }

  const [periodTotals, allEntries] = await Promise.all([
    db.ipmLedgerEntry.groupBy({
      by: ["memberId", "type"],
      where: { firmId: ctx.firmId, memberId: { in: memberIds }, ...inRange },
      _sum: { credit: true, debit: true },
    }),
    // The balance is cumulative, so it is taken over the whole register rather
    // than the period: a statement that showed only the period's movement
    // would report a balance that is not the participant's balance.
    db.ipmLedgerEntry.groupBy({
      by: ["memberId"],
      where: { firmId: ctx.firmId, memberId: { in: memberIds } },
      _sum: { credit: true, debit: true },
    }),
  ])

  const openedIds = new Set(
    (
      await db.ipmLedgerEntry.findMany({
        where: {
          firmId: ctx.firmId,
          memberId: { in: memberIds },
          type: "OPENING",
        },
        select: { memberId: true },
      })
    ).map((row) => row.memberId)
  )

  const balanceByMember = new Map(
    allEntries.map((bucket) => [
      bucket.memberId,
      Number(bucket._sum.credit ?? 0) - Number(bucket._sum.debit ?? 0),
    ])
  )

  const contributionsByMember = new Map<string, number>()
  const consumptionByMember = new Map<string, number>()
  for (const bucket of periodTotals) {
    if (bucket.type === "CONSUMPTION") {
      consumptionByMember.set(
        bucket.memberId,
        (consumptionByMember.get(bucket.memberId) ?? 0) +
          Number(bucket._sum.debit ?? 0)
      )
    } else {
      contributionsByMember.set(
        bucket.memberId,
        (contributionsByMember.get(bucket.memberId) ?? 0) +
          Number(bucket._sum.credit ?? 0)
      )
    }
  }

  const debtCeiling = employer.debtCeiling ? Number(employer.debtCeiling) : null

  const lines: StatementLine[] = members.map((member) => {
    const balance = balanceByMember.get(member.id) ?? 0
    return {
      memberId: member.id,
      matricule: member.matricule,
      memberName: `${member.person.lastName.toUpperCase()} ${member.person.firstName}`,
      dependentCount: member._count.dependents,
      contributions: contributionsByMember.get(member.id) ?? 0,
      consumption: consumptionByMember.get(member.id) ?? 0,
      balance,
      unopened: !openedIds.has(member.id),
      // A negative balance beyond the ceiling. The plan is explicit that this
      // raises an alert and never blocks automatically — the decision stays
      // human.
      overDebtCeiling: debtCeiling !== null && balance < -debtCeiling,
    }
  })

  const contributions = lines.reduce((sum, line) => sum + line.contributions, 0)
  const consumption = lines.reduce((sum, line) => sum + line.consumption, 0)

  return {
    employerId: employer.id,
    employerName: employer.organization.name,
    from: { year: range.fromYear, month: range.fromMonth },
    to: { year: range.toYear, month: range.toMonth },
    lines,
    totals: {
      members: lines.length,
      contributions,
      consumption,
      balance: lines.reduce((sum, line) => sum + line.balance, 0),
      ratio: consumption > 0 ? contributions / consumption : null,
    },
    debtCeiling,
    unopenedCount: lines.filter((line) => line.unopened).length,
  }
}

/* ==========================================================================
 * Factures employeur
 * ========================================================================== */

export type InvoiceRow = {
  id: string
  number: string
  employerName: string
  periodYear: number
  periodMonth: number
  issueDate: Date
  dueDate: Date
  memberCount: number
  totalAmount: number
  paidAmount: number
  status: string
  overdue: boolean
}

export async function listInvoices(ctx: FirmContext): Promise<InvoiceRow[]> {
  const now = new Date()
  const rows = await db.ipmEmployerInvoice.findMany({
    where: { firmId: ctx.firmId },
    orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }, { number: "desc" }],
    take: 200,
    select: {
      id: true,
      number: true,
      periodYear: true,
      periodMonth: true,
      issueDate: true,
      dueDate: true,
      memberCount: true,
      totalAmount: true,
      paidAmount: true,
      status: true,
      employer: { select: { organization: { select: { name: true } } } },
    },
  })

  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    employerName: row.employer.organization.name,
    periodYear: row.periodYear,
    periodMonth: row.periodMonth,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    memberCount: row.memberCount,
    totalAmount: Number(row.totalAmount),
    paidAmount: Number(row.paidAmount),
    status: row.status,
    // Derived rather than stored: a row does not become overdue by being
    // written to, it becomes overdue by the date passing.
    overdue:
      row.dueDate < now &&
      !["PAID", "CANCELLED"].includes(row.status),
  }))
}

export type ContributionSummary = {
  membersWithoutOpening: number
  totalMembers: number
  monthlyDue: number
  invoicedThisMonth: number
  outstanding: number
  incoherentLedgers: number
}

export async function contributionSummary(
  ctx: FirmContext
): Promise<ContributionSummary> {
  const now = new Date()

  const [totalMembers, opened, monthly, invoices] = await Promise.all([
    db.member.count({ where: { firmId: ctx.firmId, status: "ACTIVE" } }),
    db.ipmLedgerEntry.findMany({
      where: { firmId: ctx.firmId, type: "OPENING" },
      select: { memberId: true },
      distinct: ["memberId"],
    }),
    db.ipmMemberContribution.aggregate({
      where: { firmId: ctx.firmId, validTo: null },
      _sum: { monthlyAmount: true },
    }),
    db.ipmEmployerInvoice.findMany({
      where: { firmId: ctx.firmId, status: { notIn: ["CANCELLED"] } },
      select: {
        totalAmount: true,
        paidAmount: true,
        periodYear: true,
        periodMonth: true,
      },
    }),
  ])

  const invoicedThisMonth = invoices
    .filter(
      (invoice) =>
        invoice.periodYear === now.getFullYear() &&
        invoice.periodMonth === now.getMonth() + 1
    )
    .reduce((sum, invoice) => sum + Number(invoice.totalAmount), 0)

  const outstanding = invoices.reduce(
    (sum, invoice) =>
      sum + Number(invoice.totalAmount) - Number(invoice.paidAmount),
    0
  )

  // A cheap coherence sweep: any member whose cached balance disagrees with
  // the sum of their register. Reported as a number the screen can act on.
  const drifted = await db.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM (
      SELECT m."id"
      FROM "ipm_members" m
      LEFT JOIN "ipm_ledger_entries" l ON l."memberId" = m."id"
      WHERE m."firmId" = ${ctx.firmId}
      GROUP BY m."id", m."currentBalance"
      HAVING COALESCE(SUM(l."credit" - l."debit"), 0) <> m."currentBalance"
    ) t
  `

  return {
    membersWithoutOpening: totalMembers - opened.length,
    totalMembers,
    monthlyDue: Number(monthly._sum.monthlyAmount ?? 0),
    invoicedThisMonth,
    outstanding,
    incoherentLedgers: drifted[0]?.n ?? 0,
  }
}
