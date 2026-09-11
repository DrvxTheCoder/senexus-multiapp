"use server"

import type { Prisma } from "@prisma/client"

import { toDate, toOptionalDate } from "@/lib/forms/hr-schemas"
import {
  createCategorySchema,
  createDependentSchema,
  createEmployerSchema,
  createMemberSchema,
  createPlanSchema,
  createServiceTypeSchema,
  createSpecialtySchema,
  openContributionSchema,
  removeEmployerRateSchema,
  removePlanRateSchema,
  setEmployerRateSchema,
  setPlanRateSchema,
  terminateMemberSchema,
  updateCategorySchema,
  updateDependentSchema,
  updateEmployerSchema,
  updateMemberSchema,
  updatePlanSchema,
} from "@/lib/forms/ipm-schemas"
import { ActionError, firmAction } from "@/server/actions/define-action"
import { supersede } from "@/server/domain/ipm/contribution"
import {
  formatDependentMatricule,
  nextDependentRank,
  withMemberMatricule,
} from "@/server/domain/ipm/matricule"

/**
 * IPM write layer.
 *
 * Every action carries `module: "ipm"`, which is the same gate the routes use:
 * a mutation aimed at a firm without the module is a 404, not a write. Without
 * it a crafted POST would reach health data that the interface never links to
 * (§7) — the route gate alone protects the page, not the action behind it.
 *
 * MANAGER is the bar for writing. Affiliation decides who is covered and what
 * the institution pays, which is not a STAFF-level act.
 */

const orNull = (value: string | null | undefined) =>
  value && value.trim() ? value.trim() : null

const IPM_MODULE = "ipm"

function listPath(firmSlug: string, ...rest: string[]): string {
  return [`/${firmSlug}/ipm`, ...rest].join("/")
}

/* ==========================================================================
 * Employeurs
 * ========================================================================== */

export const createEmployer = firmAction({
  input: createEmployerSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => [
    listPath(input.firmSlug, "employeurs"),
    listPath(input.firmSlug),
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    // The organization is holding-level, so an employer that is already a CRM
    // client reuses the same legal entity rather than duplicating it (§4.1).
    let organizationId = input.organizationId ?? null

    if (!organizationId) {
      const name = input.organizationName?.trim() ?? ""
      const existing = await tx.organization.findFirst({
        where: {
          holdingId: ctx.firm.holdingId,
          name: { equals: name, mode: "insensitive" },
        },
        select: { id: true },
      })

      organizationId =
        existing?.id ??
        (
          await tx.organization.create({
            data: {
              holdingId: ctx.firm.holdingId,
              name,
              ninea: orNull(input.ninea),
              sector: orNull(input.sector),
            },
            select: { id: true },
          })
        ).id
    }

    const clash = await tx.ipmEmployer.findFirst({
      where: { firmId: ctx.firmId, organizationId },
      select: { id: true },
    })
    if (clash) {
      throw new ActionError("Cette société est déjà affiliée.", {
        organizationId: ["Cette société est déjà affiliée."],
      })
    }

    const employer = await tx.ipmEmployer.create({
      data: {
        firmId: ctx.firmId,
        organizationId,
        legacyEmployerCode: orNull(input.legacyEmployerCode),
        accountCode: orNull(input.accountCode),
        planId: orNull(input.planId),
        affiliationDate: toDate(input.affiliationDate),
        status: input.status,
        ageMajority: input.ageMajority,
        ageRetirement: input.ageRetirement,
        contributionEmployerAmount: input.contributionEmployerAmount ?? null,
        contributionEmployeeAmount: input.contributionEmployeeAmount ?? null,
        reminderDelayDays: input.reminderDelayDays,
        suspensionDelayDays: input.suspensionDelayDays,
        consumptionCeiling: input.consumptionCeiling ?? null,
        debtCeiling: input.debtCeiling ?? null,
      },
      select: { id: true },
    })

    await audit({
      action: "CREATE",
      entity: "IPM_EMPLOYER",
      entityId: employer.id,
      metadata: { organizationId, planId: input.planId ?? null },
    })

    return employer
  },
})

export const updateEmployer = firmAction({
  input: updateEmployerSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => listPath(input.firmSlug, "employeurs"),
  handler: async ({ input, ctx, tx, audit }) => {
    const employer = await tx.ipmEmployer.findFirst({
      where: { id: input.employerId, firmId: ctx.firmId },
      select: { id: true, organizationId: true },
    })
    if (!employer) throw new ActionError("Employeur introuvable.")

    await tx.ipmEmployer.update({
      where: { id: employer.id },
      data: {
        legacyEmployerCode: orNull(input.legacyEmployerCode),
        accountCode: orNull(input.accountCode),
        planId: orNull(input.planId),
        affiliationDate: toDate(input.affiliationDate),
        status: input.status,
        ageMajority: input.ageMajority,
        ageRetirement: input.ageRetirement,
        contributionEmployerAmount: input.contributionEmployerAmount ?? null,
        contributionEmployeeAmount: input.contributionEmployeeAmount ?? null,
        reminderDelayDays: input.reminderDelayDays,
        suspensionDelayDays: input.suspensionDelayDays,
        consumptionCeiling: input.consumptionCeiling ?? null,
        debtCeiling: input.debtCeiling ?? null,
      },
    })

    if (input.organizationName) {
      await tx.organization.update({
        where: { id: employer.organizationId },
        data: {
          name: input.organizationName.trim(),
          ninea: orNull(input.ninea),
          sector: orNull(input.sector),
        },
      })
    }

    await audit({
      action: "UPDATE",
      entity: "IPM_EMPLOYER",
      entityId: employer.id,
      metadata: { status: input.status, ageMajority: input.ageMajority },
    })

    return { id: employer.id }
  },
})

/* ==========================================================================
 * Participants
 * ========================================================================== */

type Tx = Prisma.TransactionClient

/** Reuses the person the holding already knows, or creates one. */
async function resolvePerson(
  tx: Tx,
  holdingId: string,
  person: {
    personId?: string
    firstName?: string
    lastName?: string
    birthDate?: string
    birthPlace?: string
    gender?: "MALE" | "FEMALE" | "OTHER"
    nationalId?: string
    phone?: string
    email?: string
    address?: string
  }
): Promise<string> {
  if (person.personId) {
    const existing = await tx.person.findFirst({
      where: { id: person.personId, holdingId },
      select: { id: true },
    })
    if (!existing) throw new ActionError("Personne introuvable.")
    return existing.id
  }

  const nationalId = orNull(person.nationalId)
  if (nationalId) {
    // A CNI identifies one human being. Affiliating somebody the holding
    // already employs must not mint a second identity for them (§4.1).
    const known = await tx.person.findFirst({
      where: { holdingId, nationalId },
      select: { id: true },
    })
    if (known) return known.id
  }

  const created = await tx.person.create({
    data: {
      holdingId,
      firstName: person.firstName!.trim(),
      lastName: person.lastName!.trim(),
      birthDate: toOptionalDate(person.birthDate),
      birthPlace: orNull(person.birthPlace),
      gender: person.gender ?? null,
      nationalId,
      phone: orNull(person.phone),
      email: orNull(person.email),
      address: orNull(person.address),
    },
    select: { id: true },
  })
  return created.id
}

export const createMember = firmAction({
  input: createMemberSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => [
    listPath(input.firmSlug, "participants"),
    listPath(input.firmSlug),
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    const employer = await tx.ipmEmployer.findFirst({
      where: { id: input.employerId, firmId: ctx.firmId },
      select: {
        id: true,
        matriculePrefix: true,
        planId: true,
        contributionEmployerAmount: true,
        contributionEmployeeAmount: true,
      },
    })
    if (!employer) {
      throw new ActionError("Employeur introuvable.", {
        employerId: ["Employeur introuvable."],
      })
    }

    const personId = await resolvePerson(tx, ctx.firm.holdingId, input.person)

    const alreadyAffiliated = await tx.member.findFirst({
      where: {
        firmId: ctx.firmId,
        personId,
        status: { in: ["PENDING", "ACTIVE", "SUSPENDED"] },
      },
      select: { id: true, matricule: true },
    })
    if (alreadyAffiliated) {
      throw new ActionError(
        `Cette personne est déjà affiliée sous le matricule ${alreadyAffiliated.matricule}.`
      )
    }

    // The employment link is verified against the caller's own holding rather
    // than trusted from the form: an id from another group must not bind.
    let employeeId: string | null = null
    if (input.employeeId) {
      const employee = await tx.employee.findFirst({
        where: {
          id: input.employeeId,
          firm: { holdingId: ctx.firm.holdingId },
        },
        select: { id: true },
      })
      if (!employee) {
        throw new ActionError("Contrat de travail introuvable.", {
          employeeId: ["Contrat de travail introuvable."],
        })
      }
      employeeId = employee.id
    }

    const affiliationDate = toDate(input.affiliationDate)

    const member = await withMemberMatricule(
      tx,
      ctx.firmId,
      employer.matriculePrefix ?? "",
      (matricule) =>
        tx.member.create({
          data: {
            firmId: ctx.firmId,
            personId,
            employerId: employer.id,
            employeeId,
            matricule,
            legacyCode: orNull(input.legacyCode),
            jobTitle: orNull(input.jobTitle),
            affiliationDate,
            status: input.status,
          },
          select: { id: true, matricule: true },
        })
    )

    // The first cotisation period opens on the affiliation date, inheriting
    // the employer's defaults when the form left the amount blank.
    const monthlyAmount = input.monthlyContribution
    if (monthlyAmount !== null && monthlyAmount !== undefined) {
      await tx.ipmMemberContribution.create({
        data: {
          firmId: ctx.firmId,
          memberId: member.id,
          planId: employer.planId,
          monthlyAmount,
          employerAmount: employer.contributionEmployerAmount,
          employeeAmount: employer.contributionEmployeeAmount,
          validFrom: affiliationDate,
          reason: "Cotisation initiale",
          createdById: ctx.userId,
        },
      })
    }

    await audit({
      action: "CREATE",
      entity: "IPM_MEMBER",
      entityId: member.id,
      metadata: { matricule: member.matricule, employerId: employer.id },
    })

    return member
  },
})

export const updateMember = firmAction({
  input: updateMemberSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => [
    listPath(input.firmSlug, "participants"),
    listPath(input.firmSlug, "participants", input.memberId),
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    const member = await tx.member.findFirst({
      where: { id: input.memberId, firmId: ctx.firmId },
      select: { id: true, personId: true },
    })
    if (!member) throw new ActionError("Participant introuvable.")

    const employer = await tx.ipmEmployer.findFirst({
      where: { id: input.employerId, firmId: ctx.firmId },
      select: { id: true },
    })
    if (!employer) {
      throw new ActionError("Employeur introuvable.", {
        employerId: ["Employeur introuvable."],
      })
    }

    await tx.member.update({
      where: { id: member.id },
      data: {
        employerId: employer.id,
        jobTitle: orNull(input.jobTitle),
        affiliationDate: toDate(input.affiliationDate),
        status: input.status,
        terminationDate: toOptionalDate(input.terminationDate),
        legacyCode: orNull(input.legacyCode),
      },
    })

    await tx.person.update({
      where: { id: member.personId },
      data: {
        firstName: input.person.firstName.trim(),
        lastName: input.person.lastName.trim(),
        birthDate: toOptionalDate(input.person.birthDate),
        birthPlace: orNull(input.person.birthPlace),
        gender: input.person.gender ?? null,
        nationalId: orNull(input.person.nationalId),
        phone: orNull(input.person.phone),
        email: orNull(input.person.email),
        address: orNull(input.person.address),
      },
    })

    await audit({
      action: "UPDATE",
      entity: "IPM_MEMBER",
      entityId: member.id,
      metadata: { status: input.status, employerId: employer.id },
    })

    return { id: member.id }
  },
})

/**
 * Radiation. Never a delete: cotisations, and soon bons and a card, point at
 * this row. The ayants droit lose cover with it, on the same date, because a
 * family is covered through the participant.
 */
export const terminateMember = firmAction({
  input: terminateMemberSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => [
    listPath(input.firmSlug, "participants"),
    listPath(input.firmSlug, "participants", input.memberId),
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    const member = await tx.member.findFirst({
      where: { id: input.memberId, firmId: ctx.firmId },
      select: { id: true, status: true, matricule: true },
    })
    if (!member) throw new ActionError("Participant introuvable.")
    if (member.status === "TERMINATED") {
      throw new ActionError("Ce participant est déjà radié.")
    }

    const terminationDate = toDate(input.terminationDate)

    await tx.member.update({
      where: { id: member.id },
      data: { status: "TERMINATED", terminationDate },
    })

    await tx.dependent.updateMany({
      where: { memberId: member.id, status: "ACTIVE" },
      data: { status: "TERMINATED", coverageEnd: terminationDate },
    })

    // The open cotisation period is closed, not deleted: what was paid before
    // the radiation stays part of the history (§11 Q6).
    await tx.ipmMemberContribution.updateMany({
      where: { memberId: member.id, validTo: null },
      data: { validTo: terminationDate },
    })

    await audit({
      action: "TERMINATE",
      entity: "IPM_MEMBER",
      entityId: member.id,
      metadata: {
        matricule: member.matricule,
        terminationDate: input.terminationDate,
        reason: input.reason ?? null,
      },
    })

    return { id: member.id }
  },
})

/* ==========================================================================
 * Ayants droit
 * ========================================================================== */

export const createDependent = firmAction({
  input: createDependentSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) =>
    listPath(input.firmSlug, "participants", input.memberId),
  handler: async ({ input, ctx, tx, audit }) => {
    const member = await tx.member.findFirst({
      where: { id: input.memberId, firmId: ctx.firmId },
      select: { id: true, matricule: true },
    })
    if (!member) throw new ActionError("Participant introuvable.")

    const personId = await resolvePerson(tx, ctx.firm.holdingId, input.person)
    const rank = await nextDependentRank(tx, member.id)

    const dependent = await tx.dependent.create({
      data: {
        firmId: ctx.firmId,
        memberId: member.id,
        personId,
        matricule: formatDependentMatricule(member.matricule, rank),
        relation: input.relation,
        rank,
        marriageDate: toOptionalDate(input.marriageDate),
        coverageStart: toDate(input.coverageStart),
        coverageEnd: toOptionalDate(input.coverageEnd),
        status: "ACTIVE",
      },
      select: { id: true, matricule: true },
    })

    await audit({
      action: "CREATE",
      entity: "IPM_DEPENDENT",
      entityId: dependent.id,
      metadata: { memberId: member.id, relation: input.relation, rank },
    })

    return dependent
  },
})

export const updateDependent = firmAction({
  input: updateDependentSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => listPath(input.firmSlug, "participants"),
  handler: async ({ input, ctx, tx, audit }) => {
    const dependent = await tx.dependent.findFirst({
      where: { id: input.dependentId, firmId: ctx.firmId },
      select: { id: true, personId: true, memberId: true },
    })
    if (!dependent) throw new ActionError("Ayant droit introuvable.")

    await tx.dependent.update({
      where: { id: dependent.id },
      data: {
        relation: input.relation,
        marriageDate: toOptionalDate(input.marriageDate),
        coverageStart: toDate(input.coverageStart),
        coverageEnd: toOptionalDate(input.coverageEnd),
        status: input.status,
      },
    })

    await tx.person.update({
      where: { id: dependent.personId },
      data: {
        firstName: input.person.firstName.trim(),
        lastName: input.person.lastName.trim(),
        birthDate: toOptionalDate(input.person.birthDate),
        gender: input.person.gender ?? null,
      },
    })

    await audit({
      action: "UPDATE",
      entity: "IPM_DEPENDENT",
      entityId: dependent.id,
      metadata: { memberId: dependent.memberId, status: input.status },
    })

    return { id: dependent.id }
  },
})

/* ==========================================================================
 * Cotisations
 * ========================================================================== */

/**
 * Opens a new cotisation period, closing the current one on the same date.
 *
 * The close-and-open is one transaction, so the history can never be left with
 * two open rows or none. `supersede` refuses a start date behind the open
 * period's own, which would either overlap or erase a period that has already
 * priced vouchers.
 */
export const openContribution = firmAction({
  input: openContributionSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => [
    listPath(input.firmSlug, "participants"),
    listPath(input.firmSlug, "participants", input.memberId),
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    const member = await tx.member.findFirst({
      where: { id: input.memberId, firmId: ctx.firmId },
      select: {
        id: true,
        employer: { select: { planId: true } },
        contributions: {
          select: {
            id: true,
            monthlyAmount: true,
            employerAmount: true,
            employeeAmount: true,
            validFrom: true,
            validTo: true,
            planId: true,
            reason: true,
          },
        },
      },
    })
    if (!member) throw new ActionError("Participant introuvable.")

    const validFrom = toDate(input.validFrom)
    const periods = member.contributions.map((row) => ({
      id: row.id,
      monthlyAmount: Number(row.monthlyAmount),
      employerAmount:
        row.employerAmount === null ? null : Number(row.employerAmount),
      employeeAmount:
        row.employeeAmount === null ? null : Number(row.employeeAmount),
      validFrom: row.validFrom,
      validTo: row.validTo,
      planId: row.planId,
      reason: row.reason,
    }))

    const plan = supersede(periods, validFrom)
    if (plan.error) {
      throw new ActionError(plan.error, { validFrom: [plan.error] })
    }

    if (plan.close) {
      await tx.ipmMemberContribution.update({
        where: { id: plan.close.id },
        data: { validTo: plan.close.validTo },
      })
    }

    const created = await tx.ipmMemberContribution.create({
      data: {
        firmId: ctx.firmId,
        memberId: member.id,
        planId: member.employer.planId,
        monthlyAmount: input.monthlyAmount!,
        employerAmount: input.employerAmount ?? null,
        employeeAmount: input.employeeAmount ?? null,
        validFrom,
        reason: orNull(input.reason),
        createdById: ctx.userId,
      },
      select: { id: true },
    })

    await audit({
      action: "OPEN_CONTRIBUTION",
      entity: "IPM_MEMBER",
      entityId: member.id,
      metadata: {
        contributionId: created.id,
        monthlyAmount: input.monthlyAmount,
        validFrom: input.validFrom,
        closed: plan.close?.id ?? null,
      },
    })

    return created
  },
})

/* ==========================================================================
 * Formules et barèmes
 * ========================================================================== */

export const createPlan = firmAction({
  input: createPlanSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => listPath(input.firmSlug, "formules"),
  handler: async ({ input, ctx, tx, audit }) => {
    const validFrom = toDate(input.validFrom)

    const clash = await tx.ipmPlan.findFirst({
      where: { firmId: ctx.firmId, code: input.code, validFrom },
      select: { id: true },
    })
    if (clash) {
      throw new ActionError("Une formule porte déjà ce code à cette date.", {
        code: ["Une formule porte déjà ce code à cette date."],
      })
    }

    const plan = await tx.ipmPlan.create({
      data: {
        firmId: ctx.firmId,
        code: input.code,
        name: input.name,
        monthlyPrice: input.monthlyPrice!,
        validFrom,
        active: true,
      },
      select: { id: true },
    })

    await audit({
      action: "CREATE",
      entity: "IPM_PLAN",
      entityId: plan.id,
      metadata: { code: input.code, monthlyPrice: input.monthlyPrice },
    })

    return plan
  },
})

export const updatePlan = firmAction({
  input: updatePlanSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => listPath(input.firmSlug, "formules"),
  handler: async ({ input, ctx, tx, audit }) => {
    const plan = await tx.ipmPlan.findFirst({
      where: { id: input.planId, firmId: ctx.firmId },
      select: { id: true, monthlyPrice: true },
    })
    if (!plan) throw new ActionError("Formule introuvable.")

    // Changing the price in place is allowed only while it is what it always
    // was. A real price change is a new effective-dated formule, so a voucher
    // issued last month is not silently repriced.
    if (Number(plan.monthlyPrice) !== input.monthlyPrice) {
      const inUse = await tx.ipmMemberContribution.count({
        where: { planId: plan.id },
      })
      if (inUse > 0) {
        throw new ActionError(
          "Cette formule a déjà servi à tarifer des cotisations. Créez une nouvelle version datée plutôt que d'en changer le prix.",
          { monthlyPrice: ["Créez une nouvelle version datée."] }
        )
      }
    }

    await tx.ipmPlan.update({
      where: { id: plan.id },
      data: {
        name: input.name,
        monthlyPrice: input.monthlyPrice!,
        active: input.active,
      },
    })

    await audit({
      action: "UPDATE",
      entity: "IPM_PLAN",
      entityId: plan.id,
      metadata: { name: input.name, active: input.active },
    })

    return { id: plan.id }
  },
})

export const setPlanRate = firmAction({
  input: setPlanRateSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => listPath(input.firmSlug, "formules"),
  handler: async ({ input, ctx, tx, audit }) => {
    const [plan, category] = await Promise.all([
      tx.ipmPlan.findFirst({
        where: { id: input.planId, firmId: ctx.firmId },
        select: { id: true },
      }),
      tx.ipmServiceCategory.findFirst({
        where: { id: input.categoryId, firmId: ctx.firmId },
        select: { id: true },
      }),
    ])
    if (!plan) throw new ActionError("Formule introuvable.")
    if (!category) throw new ActionError("Catégorie introuvable.")

    const rate = await tx.ipmPlanRate.upsert({
      where: {
        planId_categoryId_beneficiaryType: {
          planId: plan.id,
          categoryId: category.id,
          beneficiaryType: input.beneficiaryType,
        },
      },
      update: {
        rate: input.rate,
        ceilingPerAct: input.ceilingPerAct ?? null,
        ceilingMonthly: input.ceilingMonthly ?? null,
        ceilingAnnual: input.ceilingAnnual ?? null,
        waitingPeriodDays: input.waitingPeriodDays,
      },
      create: {
        firmId: ctx.firmId,
        planId: plan.id,
        categoryId: category.id,
        beneficiaryType: input.beneficiaryType,
        rate: input.rate,
        ceilingPerAct: input.ceilingPerAct ?? null,
        ceilingMonthly: input.ceilingMonthly ?? null,
        ceilingAnnual: input.ceilingAnnual ?? null,
        waitingPeriodDays: input.waitingPeriodDays,
      },
      select: { id: true },
    })

    await audit({
      action: "SET_RATE",
      entity: "IPM_PLAN",
      entityId: plan.id,
      metadata: {
        categoryId: category.id,
        beneficiaryType: input.beneficiaryType,
        rate: input.rate,
      },
    })

    return rate
  },
})

export const removePlanRate = firmAction({
  input: removePlanRateSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => listPath(input.firmSlug, "formules"),
  handler: async ({ input, ctx, tx, audit }) => {
    const rate = await tx.ipmPlanRate.findFirst({
      where: { id: input.rateId, firmId: ctx.firmId },
      select: { id: true, planId: true, categoryId: true },
    })
    if (!rate) throw new ActionError("Ligne de barème introuvable.")

    await tx.ipmPlanRate.delete({ where: { id: rate.id } })

    await audit({
      action: "REMOVE_RATE",
      entity: "IPM_PLAN",
      entityId: rate.planId,
      metadata: { categoryId: rate.categoryId },
    })

    return { id: rate.id }
  },
})

export const setEmployerRate = firmAction({
  input: setEmployerRateSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => [
    listPath(input.firmSlug, "formules"),
    listPath(input.firmSlug, "employeurs"),
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    const [employer, category] = await Promise.all([
      tx.ipmEmployer.findFirst({
        where: { id: input.employerId, firmId: ctx.firmId },
        select: { id: true },
      }),
      tx.ipmServiceCategory.findFirst({
        where: { id: input.categoryId, firmId: ctx.firmId },
        select: { id: true },
      }),
    ])
    if (!employer) throw new ActionError("Employeur introuvable.")
    if (!category) throw new ActionError("Catégorie introuvable.")

    const rate = await tx.ipmEmployerRate.upsert({
      where: {
        employerId_categoryId_beneficiaryType: {
          employerId: employer.id,
          categoryId: category.id,
          beneficiaryType: input.beneficiaryType,
        },
      },
      update: {
        rate: input.rate,
        ceilingPerAct: input.ceilingPerAct ?? null,
        ceilingMonthly: input.ceilingMonthly ?? null,
        ceilingAnnual: input.ceilingAnnual ?? null,
        waitingPeriodDays: input.waitingPeriodDays ?? null,
      },
      create: {
        firmId: ctx.firmId,
        employerId: employer.id,
        categoryId: category.id,
        beneficiaryType: input.beneficiaryType,
        rate: input.rate,
        ceilingPerAct: input.ceilingPerAct ?? null,
        ceilingMonthly: input.ceilingMonthly ?? null,
        ceilingAnnual: input.ceilingAnnual ?? null,
        waitingPeriodDays: input.waitingPeriodDays ?? null,
      },
      select: { id: true },
    })

    await audit({
      action: "SET_RATE",
      entity: "IPM_EMPLOYER",
      entityId: employer.id,
      metadata: {
        categoryId: category.id,
        beneficiaryType: input.beneficiaryType,
        rate: input.rate,
      },
    })

    return rate
  },
})

export const removeEmployerRate = firmAction({
  input: removeEmployerRateSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => listPath(input.firmSlug, "formules"),
  handler: async ({ input, ctx, tx, audit }) => {
    const rate = await tx.ipmEmployerRate.findFirst({
      where: { id: input.rateId, firmId: ctx.firmId },
      select: { id: true, employerId: true, categoryId: true },
    })
    if (!rate) throw new ActionError("Dérogation introuvable.")

    await tx.ipmEmployerRate.delete({ where: { id: rate.id } })

    await audit({
      action: "REMOVE_RATE",
      entity: "IPM_EMPLOYER",
      entityId: rate.employerId,
      metadata: { categoryId: rate.categoryId },
    })

    return { id: rate.id }
  },
})

/* ==========================================================================
 * Référentiel
 * ========================================================================== */

export const createCategory = firmAction({
  input: createCategorySchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => [
    listPath(input.firmSlug, "referentiel"),
    listPath(input.firmSlug, "formules"),
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    const clash = await tx.ipmServiceCategory.findFirst({
      where: { firmId: ctx.firmId, code: input.code },
      select: { id: true },
    })
    if (clash) {
      throw new ActionError("Ce code de catégorie existe déjà.", {
        code: ["Ce code de catégorie existe déjà."],
      })
    }

    const category = await tx.ipmServiceCategory.create({
      data: {
        firmId: ctx.firmId,
        code: input.code,
        label: input.label,
        sortOrder: input.sortOrder,
      },
      select: { id: true },
    })

    await audit({
      action: "CREATE",
      entity: "IPM_CATEGORY",
      entityId: category.id,
      metadata: { code: input.code },
    })

    return category
  },
})

export const updateCategory = firmAction({
  input: updateCategorySchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => [
    listPath(input.firmSlug, "referentiel"),
    listPath(input.firmSlug, "formules"),
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    const category = await tx.ipmServiceCategory.findFirst({
      where: { id: input.categoryId, firmId: ctx.firmId },
      select: { id: true },
    })
    if (!category) throw new ActionError("Catégorie introuvable.")

    await tx.ipmServiceCategory.update({
      where: { id: category.id },
      data: {
        label: input.label,
        sortOrder: input.sortOrder,
        active: input.active,
      },
    })

    await audit({
      action: "UPDATE",
      entity: "IPM_CATEGORY",
      entityId: category.id,
      metadata: { label: input.label, active: input.active },
    })

    return { id: category.id }
  },
})

export const createServiceType = firmAction({
  input: createServiceTypeSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => listPath(input.firmSlug, "referentiel"),
  handler: async ({ input, ctx, tx, audit }) => {
    const category = await tx.ipmServiceCategory.findFirst({
      where: { id: input.categoryId, firmId: ctx.firmId },
      select: { id: true },
    })
    if (!category) throw new ActionError("Catégorie introuvable.")

    const clash = await tx.ipmServiceType.findFirst({
      where: { firmId: ctx.firmId, code: input.code },
      select: { id: true },
    })
    if (clash) {
      throw new ActionError("Ce code de prestation existe déjà.", {
        code: ["Ce code de prestation existe déjà."],
      })
    }

    const serviceType = await tx.ipmServiceType.create({
      data: {
        firmId: ctx.firmId,
        categoryId: category.id,
        code: input.code,
        label: input.label,
        accountCode: orNull(input.accountCode),
      },
      select: { id: true },
    })

    await audit({
      action: "CREATE",
      entity: "IPM_SERVICE_TYPE",
      entityId: serviceType.id,
      metadata: { code: input.code, categoryId: category.id },
    })

    return serviceType
  },
})

export const createSpecialty = firmAction({
  input: createSpecialtySchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => listPath(input.firmSlug, "referentiel"),
  handler: async ({ input, ctx, tx, audit }) => {
    const clash = await tx.ipmProviderSpecialty.findFirst({
      where: { firmId: ctx.firmId, code: input.code },
      select: { id: true },
    })
    if (clash) {
      throw new ActionError("Ce code de spécialité existe déjà.", {
        code: ["Ce code de spécialité existe déjà."],
      })
    }

    const specialty = await tx.ipmProviderSpecialty.create({
      data: {
        firmId: ctx.firmId,
        code: input.code,
        label: input.label,
        accountCode: orNull(input.accountCode),
      },
      select: { id: true },
    })

    await audit({
      action: "CREATE",
      entity: "IPM_SPECIALTY",
      entityId: specialty.id,
      metadata: { code: input.code },
    })

    return specialty
  },
})
