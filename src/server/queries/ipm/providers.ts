import "server-only"

import { db } from "@/lib/db"
import type { FirmContext } from "@/server/auth/require-firm-access"

/**
 * Prestataires.
 *
 * The list leads with the two facts that decide whether a bon can be issued
 * against a provider at all — agréé, and whether a convention is in force —
 * because those are what the counter needs and what the legacy data does not
 * have: all 101 records carry no agreement dates and `tauxprise = 0`.
 */

export type ProviderRow = {
  id: string
  name: string
  specialtyLabel: string | null
  accountCode: string | null
  accredited: boolean
  status: string
  paymentTermDays: number
  /** A convention in force today. */
  hasLiveAgreement: boolean
  agreementCount: number
  voucherCount: number
  /** Insurer share committed against this provider and not yet settled. */
  outstanding: number
}

export async function listProviders(ctx: FirmContext): Promise<ProviderRow[]> {
  const now = new Date()

  const [providers, outstanding] = await Promise.all([
    db.ipmProvider.findMany({
      where: { firmId: ctx.firmId },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        accountCode: true,
        accredited: true,
        status: true,
        paymentTermDays: true,
        specialty: { select: { label: true } },
        _count: { select: { agreements: true, vouchers: true } },
        agreements: {
          where: {
            status: "ACTIVE",
            startDate: { lte: now },
            OR: [{ endDate: null }, { endDate: { gte: now } }],
          },
          select: { id: true },
          take: 1,
        },
      },
    }),
    // One grouped aggregate rather than a per-provider sum.
    db.ipmVoucher.groupBy({
      by: ["providerId"],
      where: { firmId: ctx.firmId, status: { in: ["ISSUED", "PRESENTED"] } },
      _sum: { insurerShare: true },
    }),
  ])

  const outstandingByProvider = new Map(
    outstanding.map((bucket) => [
      bucket.providerId,
      Number(bucket._sum.insurerShare ?? 0),
    ])
  )

  return providers.map((provider) => ({
    id: provider.id,
    name: provider.name,
    specialtyLabel: provider.specialty?.label ?? null,
    accountCode: provider.accountCode,
    accredited: provider.accredited,
    status: provider.status,
    paymentTermDays: provider.paymentTermDays,
    hasLiveAgreement: provider.agreements.length > 0,
    agreementCount: provider._count.agreements,
    voucherCount: provider._count.vouchers,
    outstanding: outstandingByProvider.get(provider.id) ?? 0,
  }))
}

/** Providers a bon may actually be issued against. */
export async function accreditedProviders(
  ctx: FirmContext
): Promise<{ id: string; name: string; specialtyLabel: string | null }[]> {
  const rows = await db.ipmProvider.findMany({
    where: { firmId: ctx.firmId, status: "ACTIVE", accredited: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, specialty: { select: { label: true } } },
  })
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    specialtyLabel: row.specialty?.label ?? null,
  }))
}

export async function listAgreements(ctx: FirmContext, providerId: string) {
  return db.ipmAgreement.findMany({
    where: { firmId: ctx.firmId, providerId },
    orderBy: { startDate: "desc" },
    select: {
      id: true,
      reference: true,
      startDate: true,
      endDate: true,
      negotiatedRate: true,
      status: true,
      terms: true,
    },
  })
}

/** Service types as options, grouped by category, for the issue form. */
export async function serviceTypeOptions(ctx: FirmContext): Promise<
  { id: string; code: string; label: string; categoryLabel: string }[]
> {
  const rows = await db.ipmServiceType.findMany({
    where: { firmId: ctx.firmId, active: true },
    orderBy: [{ category: { sortOrder: "asc" } }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      label: true,
      category: { select: { label: true } },
    },
  })
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    label: row.label,
    categoryLabel: row.category.label,
  }))
}

/** Participants as options for the issue form: matricule, name, family. */
export async function memberOptions(
  ctx: FirmContext,
  search: string
): Promise<
  {
    id: string
    matricule: string
    name: string
    status: string
    dependents: { id: string; name: string; relation: string }[]
  }[]
> {
  const contains = { contains: search, mode: "insensitive" as const }

  const rows = await db.member.findMany({
    where: {
      firmId: ctx.firmId,
      ...(search
        ? {
            OR: [
              { matricule: contains },
              { legacyCode: contains },
              { person: { lastName: contains } },
              { person: { firstName: contains } },
            ],
          }
        : {}),
    },
    orderBy: { matricule: "asc" },
    take: 25,
    select: {
      id: true,
      matricule: true,
      status: true,
      person: { select: { firstName: true, lastName: true } },
      dependents: {
        where: { status: "ACTIVE" },
        orderBy: { rank: "asc" },
        select: {
          id: true,
          relation: true,
          person: { select: { firstName: true, lastName: true } },
        },
      },
    },
  })

  return rows.map((row) => ({
    id: row.id,
    matricule: row.matricule,
    name: `${row.person.lastName.toUpperCase()} ${row.person.firstName}`,
    status: row.status,
    dependents: row.dependents.map((dependent) => ({
      id: dependent.id,
      name: `${dependent.person.lastName.toUpperCase()} ${dependent.person.firstName}`,
      relation: dependent.relation,
    })),
  }))
}
