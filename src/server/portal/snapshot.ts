import "server-only"

import type { Prisma } from "@prisma/client"

import { db } from "@/lib/db"
import { beneficiaryTypeFor } from "@/server/domain/ipm/coverage"
import { toReviewSettings } from "@/server/domain/ipm/portal-review"
import { tryResolveRate, type RateRow } from "@/server/domain/ipm/rates"
import { memberCeilingsOn } from "@/server/queries/ipm/ceilings"
import type { PortalPrincipal } from "@/server/portal/auth"
import type * as C from "@/server/portal/contract"

/**
 * The snapshot — everything the portal's pages read, for one family.
 *
 * Scoping is the whole point of this file, so it is done by construction
 * rather than by filtering afterwards: every family-owned query is keyed on
 * the account's own `memberId`, which comes from the database row behind the
 * token and never from the request. There is no parameter here a caller could
 * point at another family.
 *
 * What a family may see beyond its own rows is the firm's referentiel
 * (categories, prestations, specialties), its own formule and barème, its own
 * employer and that employer's negotiated rates, the accredited providers with
 * their conventions, the portal bookings and the review settings. Nothing else: not another employer, not another plan, no
 * non-accredited provider.
 */

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null)
const num = (value: Prisma.Decimal | number | null): number | null =>
  value === null ? null : Number(value)

export const CONTRACT_VOUCHER_SELECT = {
  id: true,
  firmId: true,
  number: true,
  type: true,
  memberId: true,
  dependentId: true,
  beneficiaryType: true,
  beneficiaryName: true,
  providerId: true,
  serviceTypeId: true,
  categoryId: true,
  issueDate: true,
  expiryDate: true,
  status: true,
  totalAmount: true,
  insurerShare: true,
  memberShare: true,
  appliedRate: true,
  rateSource: true,
  qrToken: true,
  settledAt: true,
  cancelledAt: true,
  cancelReason: true,
  origin: true,
  issuedByPortalAccountId: true,
  entryMode: true,
  receiptUrl: true,
  receiptHash: true,
  ocrTotal: true,
  reviewFlags: true,
  reviewedAt: true,
  reviewReason: true,
  createdAt: true,
} satisfies Prisma.IpmVoucherSelect

type VoucherRow = Prisma.IpmVoucherGetPayload<{ select: typeof CONTRACT_VOUCHER_SELECT }>

export function toContractVoucher(row: VoucherRow): C.IpmVoucher {
  return {
    ...row,
    issueDate: row.issueDate.toISOString(),
    expiryDate: row.expiryDate.toISOString(),
    totalAmount: Number(row.totalAmount),
    insurerShare: Number(row.insurerShare),
    memberShare: Number(row.memberShare),
    appliedRate: Number(row.appliedRate),
    settledAt: iso(row.settledAt),
    cancelledAt: iso(row.cancelledAt),
    ocrTotal: num(row.ocrTotal),
    reviewedAt: iso(row.reviewedAt),
    createdAt: row.createdAt.toISOString(),
    // Back-office user ids: nothing a participant can use. See contract.ts.
    issuedById: null,
    reviewedById: null,
  }
}

export const CONTRACT_LINE_SELECT = {
  id: true,
  firmId: true,
  voucherId: true,
  medicalActId: true,
  label: true,
  quantity: true,
  unitPrice: true,
  amount: true,
} satisfies Prisma.IpmVoucherLineSelect

type LineRow = Prisma.IpmVoucherLineGetPayload<{ select: typeof CONTRACT_LINE_SELECT }>

export function toContractLine(row: LineRow): C.IpmVoucherLine {
  return {
    ...row,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unitPrice),
    amount: Number(row.amount),
  }
}

export function toContractAccount(row: {
  id: string
  firmId: string
  memberId: string
  phone: string
  status: C.PortalAccountStatus
  activatedAt: Date | null
  lastLoginAt: Date | null
}): C.PortalAccount {
  return {
    id: row.id,
    firmId: row.firmId,
    memberId: row.memberId,
    phone: row.phone,
    status: row.status,
    activatedAt: iso(row.activatedAt),
    lastLoginAt: iso(row.lastLoginAt),
  }
}

const PERSON_SELECT = {
  id: true,
  holdingId: true,
  firstName: true,
  lastName: true,
  birthDate: true,
  gender: true,
  phone: true,
  email: true,
  address: true,
  photoUrl: true,
} satisfies Prisma.PersonSelect

function toPerson(row: Prisma.PersonGetPayload<{ select: typeof PERSON_SELECT }>): C.Person {
  return { ...row, birthDate: iso(row.birthDate) }
}

const SEQUENCE_KIND: Record<C.IpmVoucherType, string> = {
  PHARMACY: "BPI",
  OPTICAL: "BCI",
  GUARANTEE: "LGI",
  HOSPITALIZATION: "LHI",
}

export async function buildSnapshot(principal: PortalPrincipal): Promise<C.Db> {
  const { firmId, memberId, portalAccountId } = principal

  const member = await db.member.findFirstOrThrow({
    where: { id: memberId, firmId },
    select: {
      id: true,
      firmId: true,
      personId: true,
      employerId: true,
      matricule: true,
      legacyCode: true,
      jobTitle: true,
      affiliationDate: true,
      terminationDate: true,
      status: true,
      currentBalance: true,
      person: { select: PERSON_SELECT },
      employer: {
        select: {
          id: true,
          firmId: true,
          planId: true,
          reminderDelayDays: true,
          suspensionDelayDays: true,
          ageMajority: true,
          organization: { select: { name: true } },
        },
      },
      dependents: {
        orderBy: { rank: "asc" },
        select: {
          id: true,
          firmId: true,
          memberId: true,
          personId: true,
          matricule: true,
          relation: true,
          rank: true,
          coverageStart: true,
          coverageEnd: true,
          status: true,
          person: { select: PERSON_SELECT },
        },
      },
      card: {
        select: {
          id: true,
          firmId: true,
          memberId: true,
          version: true,
          generatedAt: true,
          revokedAt: true,
        },
      },
    },
  })

  const planId = member.employer.planId

  const [
    categories,
    serviceTypes,
    specialties,
    plans,
    planRates,
    providers,
    vouchers,
    lines,
    consumptions,
    account,
    settings,
    sequences,
    employerRates,
    bookings,
    memberCeilings,
  ] = await Promise.all([
    db.ipmServiceCategory.findMany({
      where: { firmId },
      orderBy: { sortOrder: "asc" },
      select: { id: true, firmId: true, code: true, label: true, sortOrder: true, active: true },
    }),
    db.ipmServiceType.findMany({
      where: { firmId },
      orderBy: { code: "asc" },
      select: { id: true, firmId: true, categoryId: true, code: true, label: true, active: true },
    }),
    db.ipmProviderSpecialty.findMany({
      where: { firmId },
      select: { id: true, firmId: true, code: true, label: true, active: true },
    }),
    planId
      ? db.ipmPlan.findMany({
          where: { id: planId, firmId },
          select: {
            id: true,
            firmId: true,
            code: true,
            name: true,
            monthlyPrice: true,
            validFrom: true,
            validTo: true,
            active: true,
          },
        })
      : Promise.resolve([]),
    planId
      ? db.ipmPlanRate.findMany({
          where: { planId, firmId },
          select: {
            id: true,
            firmId: true,
            planId: true,
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
    db.ipmProvider.findMany({
      where: { firmId, accredited: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        firmId: true,
        name: true,
        specialtyId: true,
        address: true,
        phone: true,
        accredited: true,
        status: true,
        agreements: {
          select: {
            id: true,
            firmId: true,
            providerId: true,
            reference: true,
            startDate: true,
            endDate: true,
            status: true,
          },
        },
      },
    }),
    db.ipmVoucher.findMany({
      where: { firmId, memberId },
      orderBy: { issueDate: "desc" },
      select: CONTRACT_VOUCHER_SELECT,
    }),
    db.ipmVoucherLine.findMany({
      where: { firmId, voucher: { memberId } },
      orderBy: { createdAt: "asc" },
      select: CONTRACT_LINE_SELECT,
    }),
    db.ipmConsumption.findMany({
      where: { firmId, memberId },
      select: {
        id: true,
        firmId: true,
        beneficiaryRef: true,
        memberId: true,
        categoryId: true,
        periodYear: true,
        periodMonth: true,
        voucherId: true,
        amount: true,
        insurerShare: true,
      },
    }),
    db.portalAccount.findUniqueOrThrow({
      where: { id: portalAccountId },
      select: {
        id: true,
        firmId: true,
        memberId: true,
        phone: true,
        status: true,
        activatedAt: true,
        lastLoginAt: true,
      },
    }),
    db.ipmPortalSettings.findUnique({ where: { firmId } }),
    db.ipmSequence.findMany({
      where: { firmId, kind: { in: Object.values(SEQUENCE_KIND) } },
      select: { kind: true, next: true },
    }),
    db.ipmEmployerRate.findMany({
      where: { firmId, employerId: member.employerId },
      select: {
        id: true,
        firmId: true,
        employerId: true,
        categoryId: true,
        beneficiaryType: true,
        rate: true,
        ceilingPerAct: true,
        ceilingMonthly: true,
        ceilingAnnual: true,
        waitingPeriodDays: true,
      },
    }),
    db.ipmPortalBooking.findMany({
      where: { firmId },
      orderBy: { type: "asc" },
      select: {
        type: true,
        serviceTypeId: true,
        serviceType: { select: { categoryId: true } },
        specialties: { select: { id: true } },
      },
    }),
    memberCeilingsOn(firmId, memberId, new Date()),
  ])

  // Resolved here, through the same `resolveRate` issuance uses, so the portal
  // never re-implements participant > employer > formule. One row per category
  // and per beneficiary type the family actually has; a category with no taux
  // for that type is absent, which is how the portal knows it is not covered.
  const toRows = (
    rows: {
      categoryId: string
      beneficiaryType: C.IpmBeneficiaryType
      rate: Prisma.Decimal
      ceilingPerAct: Prisma.Decimal | null
      ceilingMonthly: Prisma.Decimal | null
      ceilingAnnual: Prisma.Decimal | null
      waitingPeriodDays: number | null
    }[]
  ): RateRow[] =>
    rows.map((row) => ({
      categoryId: row.categoryId,
      beneficiaryType: row.beneficiaryType,
      rate: Number(row.rate),
      ceilingPerAct: num(row.ceilingPerAct),
      ceilingMonthly: num(row.ceilingMonthly),
      ceilingAnnual: num(row.ceilingAnnual),
      waitingPeriodDays: row.waitingPeriodDays,
    }))
  const employerRows = toRows(employerRates)
  const planRows = toRows(planRates)
  const familyTypes = [
    ...new Set<C.IpmBeneficiaryType>([
      "MEMBER",
      ...member.dependents.map((d) => beneficiaryTypeFor(d.relation)),
    ]),
  ]
  const ceilings: C.ResolvedCeiling[] = categories.flatMap((category) =>
    familyTypes.flatMap((beneficiaryType) => {
      const resolved = tryResolveRate({
        categoryId: category.id,
        categoryCode: category.code,
        beneficiaryType,
        employerRates: employerRows,
        planRates: planRows,
        memberCeilings,
      })
      if (!resolved) return []
      return [
        {
          categoryId: category.id,
          beneficiaryType,
          rate: resolved.rate,
          ceilingPerAct: resolved.ceilingPerAct,
          ceilingMonthly: resolved.ceilingMonthly,
          ceilingAnnual: resolved.ceilingAnnual,
          waitingPeriodDays: resolved.waitingPeriodDays,
          source: resolved.ceilingSource,
        },
      ]
    })
  )

  const nextFor = (type: C.IpmVoucherType) =>
    Math.max(0, ...sequences.filter((s) => s.kind === SEQUENCE_KIND[type]).map((s) => s.next))

  return {
    firmId,
    persons: [member.person, ...member.dependents.map((d) => d.person)].map(toPerson),
    categories,
    serviceTypes,
    specialties,
    plans: plans.map((plan) => ({
      ...plan,
      monthlyPrice: Number(plan.monthlyPrice),
      validFrom: plan.validFrom.toISOString(),
      validTo: iso(plan.validTo),
    })),
    planRates: planRates.map((rate) => ({
      ...rate,
      rate: Number(rate.rate),
      ceilingPerAct: num(rate.ceilingPerAct),
      ceilingMonthly: num(rate.ceilingMonthly),
      ceilingAnnual: num(rate.ceilingAnnual),
    })),
    employerRates: employerRates.map((rate) => ({
      ...rate,
      rate: Number(rate.rate),
      ceilingPerAct: num(rate.ceilingPerAct),
      ceilingMonthly: num(rate.ceilingMonthly),
      ceilingAnnual: num(rate.ceilingAnnual),
    })),
    employers: [
      {
        id: member.employer.id,
        firmId: member.employer.firmId,
        name: member.employer.organization.name,
        planId: member.employer.planId,
        reminderDelayDays: member.employer.reminderDelayDays,
        suspensionDelayDays: member.employer.suspensionDelayDays,
        ageMajority: member.employer.ageMajority,
      },
    ],
    members: [
      {
        id: member.id,
        firmId: member.firmId,
        personId: member.personId,
        employerId: member.employerId,
        matricule: member.matricule,
        legacyCode: member.legacyCode,
        jobTitle: member.jobTitle,
        affiliationDate: member.affiliationDate.toISOString(),
        terminationDate: iso(member.terminationDate),
        status: member.status,
        currentBalance: Number(member.currentBalance),
      },
    ],
    dependents: member.dependents.map(({ person: _person, ...dependent }) => ({
      ...dependent,
      coverageStart: dependent.coverageStart.toISOString(),
      coverageEnd: iso(dependent.coverageEnd),
    })),
    cards: member.card
      ? [
          {
            ...member.card,
            generatedAt: member.card.generatedAt.toISOString(),
            revokedAt: iso(member.card.revokedAt),
          },
        ]
      : [],
    providers: providers.map(({ agreements: _agreements, ...provider }) => provider),
    agreements: providers.flatMap((provider) =>
      provider.agreements.map((agreement) => ({
        ...agreement,
        startDate: agreement.startDate.toISOString(),
        endDate: iso(agreement.endDate),
      }))
    ),
    vouchers: vouchers.map(toContractVoucher),
    voucherLines: lines.map(toContractLine),
    consumptions: consumptions.map((row) => ({
      ...row,
      amount: Number(row.amount),
      insurerShare: Number(row.insurerShare),
    })),
    portalAccounts: [toContractAccount(account)],
    ceilings,
    settings: { firmId, ...toReviewSettings(settings) },
    bookings: bookings.map((booking) => ({
      type: booking.type,
      serviceTypeId: booking.serviceTypeId,
      categoryId: booking.serviceType.categoryId,
      specialtyIds: booking.specialties.map((specialty) => specialty.id),
    })),
    sequences: {
      PHARMACY: nextFor("PHARMACY"),
      OPTICAL: nextFor("OPTICAL"),
      GUARANTEE: nextFor("GUARANTEE"),
      HOSPITALIZATION: nextFor("HOSPITALIZATION"),
    },
  }
}

/** One bon with its lines, as the voucher endpoints answer. */
export async function voucherPayload(
  firmId: string,
  voucherId: string
): Promise<C.CreateVoucherResponse> {
  const voucher = await db.ipmVoucher.findFirstOrThrow({
    where: { id: voucherId, firmId },
    select: {
      ...CONTRACT_VOUCHER_SELECT,
      lines: { orderBy: { createdAt: "asc" }, select: CONTRACT_LINE_SELECT },
    },
  })
  const { lines, ...row } = voucher
  return { voucher: toContractVoucher(row), lines: lines.map(toContractLine) }
}
