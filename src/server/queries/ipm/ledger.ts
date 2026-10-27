import "server-only"

import { Prisma } from "@prisma/client"

import { db } from "@/lib/db"
import type { FirmContext } from "@/server/auth/require-firm-access"
import {
  balanceOf,
  findIncoherences,
  openingState,
  type LedgerEntry,
  type LedgerIncoherence,
} from "@/server/domain/ipm/ledger"
import { searchWhere } from "@/server/queries/search-where"

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
  /** Balance carried into the period, opening figure included. */
  startBalance: number
  contributions: number
  consumption: number
  /** Manual adjustments and reversals not tied to a bon or an invoice. */
  adjustments: number
  /** Balance at the end of the period — not today's balance. */
  endBalance: number
  /** True when this member's register was not opened by the end of the period. */
  unopened: boolean
  /** True when the member is past the employer's debt ceiling. */
  overDebtCeiling: boolean
}

type StatementFigures = Pick<
  StatementLine,
  "startBalance" | "contributions" | "consumption" | "adjustments" | "endBalance"
>

export type EmployerStatement = {
  employerId: string
  employerName: string
  from: { year: number; month: number }
  to: { year: number; month: number }
  /** One page of the participants matching the search; totals cover all. */
  lines: StatementLine[]
  /** Participants matching the search — what the pages are cut from. */
  matching: number
  page: number
  perPage: number
  pageCount: number
  totals: StatementFigures & {
    members: number
    /** Cotisations ÷ consommation. Null when nothing was consumed. */
    ratio: number | null
  }
  debtCeiling: number | null
  unopenedCount: number
  overCeilingCount: number
}

type RawFigures = {
  startBalance: Prisma.Decimal | null
  contributions: Prisma.Decimal | null
  consumption: Prisma.Decimal | null
  adjustments: Prisma.Decimal | null
  endBalance: Prisma.Decimal | null
}

/**
 * The per-member figures of a relevé, as a CTE named `figures`.
 *
 * Every line reconciles on its own: start + cotisations − consommation ±
 * ajustements = end. Entries after the period are left out, so a relevé for
 * janvier–mars says the same thing in March and in December; a closing balance
 * that kept moving after the period ended would not be the period's balance.
 *
 * The register has no day resolution, so periods compare as month indices.
 * The opening figure belongs to the start balance even when the register was
 * opened inside the period: it is a balance carried over, not money paid in,
 * and counting it as a cotisation would inflate the ratio. A bon's corrections
 * and voids carry the bon as source, so they net against its consumption and
 * the column reads as what was actually consumed.
 */
function statementFigures(
  firmId: string,
  members: Prisma.Sql,
  fromKey: number,
  toKey: number
) {
  const key = Prisma.sql`(l."periodYear" * 12 + l."periodMonth")`
  const inPeriod = Prisma.sql`${key} >= ${fromKey} AND l."type" <> 'OPENING'`
  const net = Prisma.sql`(l."credit" - l."debit")`

  return Prisma.sql`
    WITH figures AS (
      SELECT
        l."memberId",
        SUM(CASE WHEN NOT (${inPeriod}) THEN ${net} ELSE 0 END) AS "startBalance",
        SUM(CASE WHEN ${inPeriod} AND l."sourceType" = 'INVOICE'
          THEN ${net} ELSE 0 END) AS "contributions",
        SUM(CASE WHEN ${inPeriod} AND l."sourceType" IN ('VOUCHER', 'REIMBURSEMENT')
          THEN -${net} ELSE 0 END) AS "consumption",
        SUM(CASE WHEN ${inPeriod}
          AND l."sourceType" NOT IN ('INVOICE', 'VOUCHER', 'REIMBURSEMENT')
          THEN ${net} ELSE 0 END) AS "adjustments",
        SUM(${net}) AS "endBalance",
        BOOL_OR(l."type" = 'OPENING') AS "opened"
      FROM "ipm_ledger_entries" l
      JOIN "ipm_members" m ON m."id" = l."memberId"
      WHERE l."firmId" = ${firmId}
        AND m."firmId" = ${firmId}
        AND ${members}
        AND ${key} <= ${toKey}
      GROUP BY l."memberId"
    )
  `
}

const toFigures = (row: RawFigures | undefined): StatementFigures => ({
  startBalance: Number(row?.startBalance ?? 0),
  contributions: Number(row?.contributions ?? 0),
  consumption: Number(row?.consumption ?? 0),
  adjustments: Number(row?.adjustments ?? 0),
  endBalance: Number(row?.endBalance ?? 0),
})

/**
 * Le relevé.
 *
 * Paged, because an employer can have thousands of participants, but the
 * totals, the ratio and the counts are aggregated over all of them in the
 * database — a page's subtotal is not a figure anybody asked for. Two
 * aggregates, never one row per register entry brought back to Node.
 *
 * Members whose register was never opened are counted and flagged rather than
 * quietly shown with a plausible-looking balance (§11 Q11).
 */
export async function employerStatement(
  ctx: FirmContext,
  employerId: string,
  range: { fromYear: number; fromMonth: number; toYear: number; toMonth: number },
  paging: { page: number; perPage: number; search?: string }
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

  const debtCeiling = employer.debtCeiling ? Number(employer.debtCeiling) : null
  const fromKey = range.fromYear * 12 + range.fromMonth
  const toKey = range.toYear * 12 + range.toMonth

  // Search narrows the rows, never the totals: the relevé is the employer's,
  // and finding one participant should not change what the employer owes.
  const everyone: Prisma.MemberWhereInput = { firmId: ctx.firmId, employerId }
  const search = paging.search
    ? searchWhere<Prisma.MemberWhereInput>(paging.search, (contains) => [
        { matricule: contains },
        { legacyCode: contains },
        { person: { lastName: contains } },
        { person: { firstName: contains } },
      ])
    : undefined
  const matchingWhere = search ? { ...everyone, AND: search.AND } : everyone

  const [memberCount, matching] = await Promise.all([
    db.member.count({ where: everyone }),
    search ? db.member.count({ where: matchingWhere }) : null,
  ])
  const matchingCount = matching ?? memberCount
  const pageCount = Math.max(1, Math.ceil(matchingCount / paging.perPage))
  // A link kept from before participants left can point past the end; it
  // lands on the last page rather than on an empty table.
  const page = Math.min(Math.max(1, paging.page), pageCount)

  const [members, [totalsRow]] = await Promise.all([
    db.member.findMany({
      where: matchingWhere,
      orderBy: { matricule: "asc" },
      skip: (page - 1) * paging.perPage,
      take: paging.perPage,
      select: {
        id: true,
        matricule: true,
        person: { select: { firstName: true, lastName: true } },
        _count: { select: { dependents: true } },
      },
    }),
    db.$queryRaw<(RawFigures & { opened: bigint; overCeiling: bigint })[]>(Prisma.sql`
      ${statementFigures(ctx.firmId, Prisma.sql`m."employerId" = ${employerId}`, fromKey, toKey)}
      SELECT
        SUM("startBalance") AS "startBalance",
        SUM("contributions") AS "contributions",
        SUM("consumption") AS "consumption",
        SUM("adjustments") AS "adjustments",
        SUM("endBalance") AS "endBalance",
        COUNT(*) FILTER (WHERE "opened") AS "opened",
        COUNT(*) FILTER (WHERE ${
          debtCeiling === null
            ? Prisma.sql`false`
            : Prisma.sql`"endBalance" < ${-debtCeiling}`
        }) AS "overCeiling"
      FROM figures
    `),
  ])

  const pageRows = members.length
    ? await db.$queryRaw<(RawFigures & { memberId: string; opened: boolean })[]>(
        Prisma.sql`
          ${statementFigures(
            ctx.firmId,
            Prisma.sql`m."id" IN (${Prisma.join(members.map((member) => member.id))})`,
            fromKey,
            toKey
          )}
          SELECT * FROM figures
        `
      )
    : []
  const figuresByMember = new Map(pageRows.map((row) => [row.memberId, row]))

  const lines: StatementLine[] = members.map((member) => {
    const raw = figuresByMember.get(member.id)
    const figures = toFigures(raw)
    return {
      memberId: member.id,
      matricule: member.matricule,
      memberName: `${member.person.lastName.toUpperCase()} ${member.person.firstName}`,
      dependentCount: member._count.dependents,
      ...figures,
      unopened: !raw?.opened,
      // A negative balance beyond the ceiling. The plan is explicit that this
      // raises an alert and never blocks automatically — the decision stays
      // human.
      overDebtCeiling:
        debtCeiling !== null && figures.endBalance < -debtCeiling,
    }
  })

  const totals = toFigures(totalsRow)

  return {
    employerId: employer.id,
    employerName: employer.organization.name,
    from: { year: range.fromYear, month: range.fromMonth },
    to: { year: range.toYear, month: range.toMonth },
    lines,
    matching: matchingCount,
    page,
    perPage: paging.perPage,
    pageCount,
    totals: {
      members: memberCount,
      ...totals,
      ratio:
        totals.consumption > 0 ? totals.contributions / totals.consumption : null,
    },
    debtCeiling,
    unopenedCount: memberCount - Number(totalsRow?.opened ?? 0),
    overCeilingCount: Number(totalsRow?.overCeiling ?? 0),
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
