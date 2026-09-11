import "server-only"

import type { Prisma } from "@prisma/client"

import { db } from "@/lib/db"
import type { MemberQuery } from "@/lib/queries/ipm/member-query"
import type { FirmContext } from "@/server/auth/require-firm-access"
import type { Facets, Paged } from "@/server/queries/types"

export {
  memberQuerySchema,
  EMPTY_MEMBER_QUERY,
  type MemberQuery,
} from "@/lib/queries/ipm/member-query"

/**
 * Participants — the affiliation list.
 *
 * Every row needs four things the row itself does not hold: the person's name,
 * the employer, how many ayants droit hang off it and what the participant
 * currently pays. All four come back with the page rather than per row — the
 * open contribution is fetched as a filtered relation, so 25 rows cost one
 * extra statement, not 25 (§3.6).
 *
 * `firmId` is on every clause below. Health data is readable only inside IPM
 * Tawfeikh (§7), and the tenancy predicate is what makes that true at the
 * query layer rather than only at the route.
 */

function where(q: MemberQuery, ctx: FirmContext): Prisma.MemberWhereInput {
  const clauses: Prisma.MemberWhereInput = { firmId: ctx.firmId }

  if (q.search) {
    const contains = { contains: q.search, mode: "insensitive" as const }
    clauses.OR = [
      { matricule: contains },
      // The WebLamps form too: Rokhaya reads `001-00185-21` off an old card
      // and expects to find the participant (§11 Q1).
      { legacyCode: contains },
      { person: { lastName: contains } },
      { person: { firstName: contains } },
      { person: { nationalId: contains } },
    ]
  }

  if (q.status?.length) clauses.status = { in: q.status }
  if (q.employerId?.length) clauses.employerId = { in: q.employerId }
  if (q.withDependents !== undefined) {
    clauses.dependents = q.withDependents ? { some: {} } : { none: {} }
  }

  return clauses
}

function orderBy(
  sort: MemberQuery["sort"]
): Prisma.MemberOrderByWithRelationInput[] {
  const columns: Record<string, (desc: "asc" | "desc") => Prisma.MemberOrderByWithRelationInput> = {
    name: (d) => ({ person: { lastName: d } }),
    matricule: (d) => ({ matricule: d }),
    employer: (d) => ({ employer: { organization: { name: d } } }),
    status: (d) => ({ status: d }),
    affiliationDate: (d) => ({ affiliationDate: d }),
    dependents: (d) => ({ dependents: { _count: d } }),
  }

  const clauses = sort
    .filter((entry) => entry.id in columns)
    .map((entry) => columns[entry.id](entry.desc ? "desc" : "asc"))

  // Default: most recently affiliated first — a list read top-down by recency,
  // which is how a newly affiliated participant is found again.
  if (clauses.length === 0) return [{ affiliationDate: "desc" }, { matricule: "asc" }]
  return [...clauses, { matricule: "asc" }]
}

export type MemberRow = {
  id: string
  matricule: string
  legacyCode: string | null
  firstName: string
  lastName: string
  photoUrl: string | null
  employerId: string
  employerName: string
  planCode: string | null
  status: string
  affiliationDate: Date
  dependentCount: number
  /** The cotisation in force today, or null if the member has none. */
  monthlyContribution: number | null
}

const ROW_SELECT = {
  id: true,
  matricule: true,
  legacyCode: true,
  status: true,
  affiliationDate: true,
  employerId: true,
  person: {
    select: { firstName: true, lastName: true, photoUrl: true },
  },
  employer: {
    select: {
      organization: { select: { name: true } },
      plan: { select: { code: true } },
    },
  },
  _count: { select: { dependents: true } },
  // The open period. One statement for the page, not one per row.
  contributions: {
    where: { validTo: null },
    select: { monthlyAmount: true },
    take: 1,
  },
} satisfies Prisma.MemberSelect

export async function listMembers(
  ctx: FirmContext,
  q: MemberQuery
): Promise<Paged<MemberRow>> {
  const clauses = where(q, ctx)

  const [total, rows, facets] = await Promise.all([
    db.member.count({ where: clauses }),
    db.member.findMany({
      where: clauses,
      orderBy: orderBy(q.sort),
      skip: (q.page - 1) * q.perPage,
      take: q.perPage,
      select: ROW_SELECT,
    }),
    memberFacets(ctx, q),
  ])

  return {
    rows: rows.map((row) => ({
      id: row.id,
      matricule: row.matricule,
      legacyCode: row.legacyCode,
      firstName: row.person.firstName,
      lastName: row.person.lastName,
      photoUrl: row.person.photoUrl,
      employerId: row.employerId,
      employerName: row.employer.organization.name,
      planCode: row.employer.plan?.code ?? null,
      status: row.status,
      affiliationDate: row.affiliationDate,
      dependentCount: row._count.dependents,
      monthlyContribution: row.contributions[0]
        ? Number(row.contributions[0].monthlyAmount)
        : null,
    })),
    total,
    page: q.page,
    perPage: q.perPage,
    pageCount: Math.max(1, Math.ceil(total / q.perPage)),
    facets,
  }
}

/**
 * Facet counts exclude their own filter, so a status chip still shows how many
 * rows it would bring back rather than the count of what is already selected.
 */
async function memberFacets(
  ctx: FirmContext,
  q: MemberQuery
): Promise<Facets> {
  const { status: _status, employerId: _employerId, ...rest } = q

  const [byStatus, byEmployer, employers] = await Promise.all([
    db.member.groupBy({
      by: ["status"],
      where: where({ ...rest, employerId: q.employerId } as MemberQuery, ctx),
      _count: { _all: true },
    }),
    db.member.groupBy({
      by: ["employerId"],
      where: where({ ...rest, status: q.status } as MemberQuery, ctx),
      _count: { _all: true },
    }),
    db.ipmEmployer.findMany({
      where: { firmId: ctx.firmId },
      select: { id: true, organization: { select: { name: true } } },
    }),
  ])

  const employerName = new Map(
    employers.map((employer) => [employer.id, employer.organization.name])
  )

  return {
    status: byStatus.map((bucket) => ({
      value: bucket.status,
      label: bucket.status,
      count: bucket._count._all,
    })),
    employer: byEmployer
      .map((bucket) => ({
        value: bucket.employerId,
        label: employerName.get(bucket.employerId) ?? "—",
        count: bucket._count._all,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr")),
  }
}

export type MemberSummary = {
  total: number
  active: number
  dependents: number
  /** Sum of the cotisations in force — what the institution bills per month. */
  monthlyContributions: number
  /** Participants with no cotisation open at all. A gap, shown as one. */
  withoutContribution: number
}

export async function memberSummary(ctx: FirmContext): Promise<MemberSummary> {
  const [total, active, dependents, open, withContribution] = await Promise.all([
    db.member.count({ where: { firmId: ctx.firmId } }),
    db.member.count({ where: { firmId: ctx.firmId, status: "ACTIVE" } }),
    db.dependent.count({ where: { firmId: ctx.firmId, status: "ACTIVE" } }),
    db.ipmMemberContribution.aggregate({
      where: { firmId: ctx.firmId, validTo: null },
      _sum: { monthlyAmount: true },
    }),
    db.member.count({
      where: { firmId: ctx.firmId, contributions: { some: { validTo: null } } },
    }),
  ])

  return {
    total,
    active,
    dependents,
    monthlyContributions: Number(open._sum.monthlyAmount ?? 0),
    withoutContribution: total - withContribution,
  }
}
