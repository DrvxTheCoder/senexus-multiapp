import "server-only"

import { db } from "@/lib/db"
import type { FirmContext } from "@/server/auth/require-firm-access"

/**
 * Employeurs — the affiliation's other half.
 *
 * There are twenty of them in the real portfolio, so this list does not
 * paginate or facet: the whole thing fits on a screen, and pretending
 * otherwise would be machinery nobody uses. Member counts come back with the
 * rows.
 */

export type EmployerRow = {
  id: string
  organizationId: string
  name: string
  ninea: string | null
  legacyEmployerCode: string | null
  accountCode: string | null
  planId: string | null
  planCode: string | null
  planName: string | null
  /** True when the employer prices off its own barème rather than a formule. */
  hasOwnRates: boolean
  status: string
  affiliationDate: Date
  ageMajority: number
  memberCount: number
  activeMemberCount: number
}

export async function listEmployers(ctx: FirmContext): Promise<EmployerRow[]> {
  const rows = await db.ipmEmployer.findMany({
    where: { firmId: ctx.firmId },
    orderBy: { organization: { name: "asc" } },
    select: {
      id: true,
      organizationId: true,
      legacyEmployerCode: true,
      accountCode: true,
      planId: true,
      status: true,
      affiliationDate: true,
      ageMajority: true,
      organization: { select: { name: true, ninea: true } },
      plan: { select: { code: true, name: true } },
      _count: { select: { members: true, rates: true } },
    },
  })

  // One grouped count rather than a per-row filtered relation: "how many are
  // active" is an aggregate, and asking for it per employer is the N+1 the
  // query layer exists to avoid.
  const activeCounts = await db.member.groupBy({
    by: ["employerId"],
    where: { firmId: ctx.firmId, status: "ACTIVE" },
    _count: { _all: true },
  })
  const activeByEmployer = new Map(
    activeCounts.map((bucket) => [bucket.employerId, bucket._count._all])
  )

  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    name: row.organization.name,
    ninea: row.organization.ninea,
    legacyEmployerCode: row.legacyEmployerCode,
    accountCode: row.accountCode,
    planId: row.planId,
    planCode: row.plan?.code ?? null,
    planName: row.plan?.name ?? null,
    hasOwnRates: row._count.rates > 0,
    status: row.status,
    affiliationDate: row.affiliationDate,
    ageMajority: row.ageMajority,
    memberCount: row._count.members,
    activeMemberCount: activeByEmployer.get(row.id) ?? 0,
  }))
}

/** Employers as options, for the participant form and the facet filter. */
export async function employerOptions(
  ctx: FirmContext
): Promise<{ id: string; name: string; ageMajority: number; planCode: string | null }[]> {
  const rows = await db.ipmEmployer.findMany({
    where: { firmId: ctx.firmId, status: "ACTIVE" },
    orderBy: { organization: { name: "asc" } },
    select: {
      id: true,
      ageMajority: true,
      organization: { select: { name: true } },
      plan: { select: { code: true } },
    },
  })

  return rows.map((row) => ({
    id: row.id,
    name: row.organization.name,
    ageMajority: row.ageMajority,
    planCode: row.plan?.code ?? null,
  }))
}

/** Organizations in the holding that are not yet employers — the create form. */
export async function availableOrganizations(
  ctx: FirmContext
): Promise<{ id: string; name: string; ninea: string | null }[]> {
  return db.organization.findMany({
    where: {
      holdingId: ctx.firm.holdingId,
      employers: { none: { firmId: ctx.firmId } },
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, ninea: true },
    take: 200,
  })
}
