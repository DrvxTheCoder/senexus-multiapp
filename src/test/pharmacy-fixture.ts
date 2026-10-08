import { randomBytes } from "node:crypto"

import { hash } from "bcryptjs"

import { db } from "@/lib/db"

/**
 * A throwaway IPM for the bon de pharmacie tests: its own holding and firm,
 * one participant, two pharmacies with portal access, one gestionnaire. Built
 * against the real database because what the tests prove — that one write
 * moves the balance, the plafond, the pharmacy's list and the invoice
 * together — is a claim about rows, and only rows settle it.
 *
 * Local only (`databaseAvailable`), and torn down by `destroyPharmacyFixture`
 * in dependency order.
 */

export const PROVIDER_PASSWORD = "Pharmacie-test-2026"

export async function databaseAvailable(): Promise<boolean> {
  const url = process.env.DATABASE_URL ?? ""
  const host = url.match(/@([^:/?]+)/)?.[1] ?? ""
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) return false
  try {
    await db.$queryRaw`SELECT 1`
    // The tables this suite needs: the migration must have been applied.
    await db.providerAccount.count()
    return true
  } catch {
    return false
  }
}

export type PharmacyFixture = Awaited<ReturnType<typeof buildPharmacyFixture>>

export async function buildPharmacyFixture(options: {
  rate?: number
  ceilingMonthly?: number | null
  reviewThreshold?: number | null
} = {}) {
  const tag = randomBytes(5).toString("hex")
  const holding = await db.holding.create({ data: { name: `test-pharmacie-${tag}` } })
  const firm = await db.firm.create({
    data: { holdingId: holding.id, name: `IPM test ${tag}`, slug: `test-pharmacie-${tag}` },
  })
  const ipmModule = await db.module.upsert({
    where: { slug: "ipm" },
    create: { slug: "ipm", name: "IPM", version: "1.0.0", basePath: "/ipm" },
    update: {},
  })
  await db.firmModule.create({ data: { firmId: firm.id, moduleId: ipmModule.id, isEnabled: true } })

  const category = await db.ipmServiceCategory.create({
    data: { firmId: firm.id, code: "PHA", label: "Pharmacie" },
  })
  const serviceType = await db.ipmServiceType.create({
    data: { firmId: firm.id, categoryId: category.id, code: "PHA01", label: "Médicaments" },
  })
  const specialty = await db.ipmProviderSpecialty.create({
    data: { firmId: firm.id, code: "PHARMA", label: "Pharmacie" },
  })
  const plan = await db.ipmPlan.create({
    data: {
      firmId: firm.id,
      code: "F1",
      name: "Formule test",
      monthlyPrice: 10_000,
      validFrom: new Date("2020-01-01"),
    },
  })
  await db.ipmPlanRate.create({
    data: {
      firmId: firm.id,
      planId: plan.id,
      categoryId: category.id,
      rate: options.rate ?? 0.8,
      ceilingMonthly: options.ceilingMonthly === undefined ? 50_000 : options.ceilingMonthly,
    },
  })

  const organization = await db.organization.create({
    data: { holdingId: holding.id, name: `Employeur ${tag}` },
  })
  const employer = await db.ipmEmployer.create({
    data: {
      firmId: firm.id,
      organizationId: organization.id,
      affiliationDate: new Date("2020-01-01"),
      planId: plan.id,
    },
  })
  const person = await db.person.create({
    data: { holdingId: holding.id, firstName: "Awa", lastName: "Diop" },
  })
  const member = await db.member.create({
    data: {
      firmId: firm.id,
      personId: person.id,
      employerId: employer.id,
      matricule: `T${tag}`,
      affiliationDate: new Date("2020-01-01"),
      status: "ACTIVE",
    },
  })

  const providerData = (name: string) => ({
    firmId: firm.id,
    name,
    accredited: true,
    specialtyId: specialty.id,
  })
  const providerA = await db.ipmProvider.create({ data: providerData(`Pharmacie A ${tag}`) })
  const providerB = await db.ipmProvider.create({ data: providerData(`Pharmacie B ${tag}`) })

  await db.ipmPortalBooking.create({
    data: {
      firmId: firm.id,
      type: "PHARMACY",
      serviceTypeId: serviceType.id,
      specialties: { connect: [{ id: specialty.id }] },
    },
  })
  await db.ipmPortalSettings.create({
    data: {
      firmId: firm.id,
      pharmacyValidationDays: 7,
      pharmacyReviewThreshold:
        options.reviewThreshold === undefined ? 100_000 : options.reviewThreshold,
    },
  })

  const portalAccount = await db.portalAccount.create({
    data: {
      firmId: firm.id,
      memberId: member.id,
      // Unique per firm only, and the firm is new.
      phone: "770000001",
      status: "ACTIVE",
    },
  })

  const passwordHash = await hash(PROVIDER_PASSWORD, 4)
  const accountA = await db.providerAccount.create({
    data: {
      firmId: firm.id,
      providerId: providerA.id,
      username: `PA${tag}`.toUpperCase(),
      passwordHash,
      mustChangePassword: false,
    },
  })
  const accountB = await db.providerAccount.create({
    data: {
      firmId: firm.id,
      providerId: providerB.id,
      username: `PB${tag}`.toUpperCase(),
      passwordHash,
      mustChangePassword: false,
    },
  })

  const user = await db.user.create({
    data: { email: `gestionnaire-${tag}@test.invalid`, name: "Rokhaya Test" },
  })

  return {
    tag,
    holding,
    firm,
    category,
    serviceType,
    member,
    providerA,
    providerB,
    accountA,
    accountB,
    user,
    participant: {
      portalAccountId: portalAccount.id,
      firmId: firm.id,
      memberId: member.id,
    },
  }
}

/** Removes everything the fixture (and the tests) wrote, children first. */
export async function destroyPharmacyFixture(fixture: PharmacyFixture | undefined): Promise<void> {
  if (!fixture) return
  const firmId = fixture.firm.id
  const where = { firmId }
  await db.ipmVoucherAmountChange.deleteMany({ where })
  await db.portalNotification.deleteMany({ where })
  await db.ipmLedgerEntry.deleteMany({ where })
  await db.ipmConsumption.deleteMany({ where })
  await db.ipmProviderInvoiceLine.deleteMany({ where })
  await db.ipmVoucherLine.deleteMany({ where })
  await db.ipmVoucher.deleteMany({ where })
  await db.ipmProviderInvoice.deleteMany({ where })
  await db.providerAccount.deleteMany({ where })
  await db.portalAccount.deleteMany({ where })
  await db.ipmPortalBooking.deleteMany({ where })
  await db.ipmPortalSettings.deleteMany({ where })
  await db.member.deleteMany({ where })
  await db.ipmEmployer.deleteMany({ where })
  await db.ipmPlanRate.deleteMany({ where })
  await db.ipmPlan.deleteMany({ where })
  await db.ipmServiceType.deleteMany({ where })
  await db.ipmProvider.deleteMany({ where })
  await db.ipmProviderSpecialty.deleteMany({ where })
  await db.ipmServiceCategory.deleteMany({ where })
  await db.ipmSequence.deleteMany({ where })
  await db.auditLog.deleteMany({ where })
  await db.firm.delete({ where: { id: firmId } })
  await db.person.deleteMany({ where: { holdingId: fixture.holding.id } })
  await db.organization.deleteMany({ where: { holdingId: fixture.holding.id } })
  await db.holding.delete({ where: { id: fixture.holding.id } })
  await db.user.delete({ where: { id: fixture.user.id } })
}
