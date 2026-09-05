"use server"

import type { Prisma } from "@prisma/client"

import {
  createContractSchema,
  renewContractSchema,
  stampVisaSchema,
  terminateContractSchema,
  toDate,
  toOptionalDate,
  updateContractSchema,
} from "@/lib/forms/hr-schemas"
import { ActionError, firmAction } from "@/server/actions/define-action"
import { addDays } from "@/server/domain/dates"
import {
  INTERIM_CEILING_DAYS,
  computeCeiling,
  renewalWouldBreach,
} from "@/server/domain/interim-ceiling"

/**
 * Contract writes.
 *
 * Bulk renewal already lives in `contracts.ts` with its pre-flight; this file
 * is the single-record side — create, edit, renew, terminate — plus the visa
 * stamp, which is the one thing HR does to twenty contracts at once.
 *
 * Every one of them re-checks the 730-day ceiling from the database rather
 * than trusting anything the client sends.
 */

const orNull = (value: string | null | undefined) =>
  value && value.trim() ? value.trim() : null

async function assertClientInFirm(
  tx: Prisma.TransactionClient,
  firmId: string,
  clientId: string | null
): Promise<string | null> {
  if (!clientId) return null
  const client = await tx.client.findFirst({
    where: { id: clientId, firmId },
    select: { id: true },
  })
  if (!client) {
    throw new ActionError("Client introuvable dans cette entreprise.", {
      clientId: ["Client introuvable dans cette entreprise."],
    })
  }
  return client.id
}

async function assertEmployeeInFirm(
  tx: Prisma.TransactionClient,
  firmId: string,
  employeeId: string
) {
  const employee = await tx.employee.findFirst({
    where: { id: employeeId, firmId },
    select: { id: true, matricule: true },
  })
  if (!employee) {
    throw new ActionError("Employé introuvable dans cette entreprise.", {
      employeeId: ["Employé introuvable dans cette entreprise."],
    })
  }
  return employee
}

/**
 * The ceiling for one employee, from their whole history in this firm.
 *
 * `excludeContractId` leaves the contract being edited out of the count, so
 * changing its dates is judged against everything *else* rather than against
 * itself.
 */
async function ceilingFor(
  tx: Prisma.TransactionClient,
  firmId: string,
  employeeId: string,
  type: Prisma.ContractCreateInput["type"],
  excludeContractId?: string
) {
  const history = await tx.contract.findMany({
    where: {
      firmId,
      employeeId,
      ...(excludeContractId ? { NOT: { id: excludeContractId } } : {}),
    },
    select: { startDate: true, endDate: true, type: true },
  })
  return computeCeiling(history, type, new Date())
}

/* ==========================================================================
 * Create / update
 * ========================================================================== */

export const createContract = firmAction({
  input: createContractSchema,
  minimumRole: "MANAGER",
  module: "hr",
  revalidate: (input) => [
    `/${input.firmSlug}/hr/contracts`,
    `/${input.firmSlug}/hr/employees`,
    `/${input.firmSlug}/dashboard`,
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    const employee = await assertEmployeeInFirm(tx, ctx.firmId, input.employeeId)
    const clientId = await assertClientInFirm(tx, ctx.firmId, orNull(input.clientId))

    const startDate = toDate(input.startDate)
    const endDate = toOptionalDate(input.endDate)

    // A new interim contract is judged like a renewal: on where it lands.
    if (endDate) {
      const ceiling = await ceilingFor(tx, ctx.firmId, employee.id, input.type)
      const additional =
        Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1
      if (renewalWouldBreach(ceiling, additional)) {
        const over = ceiling.projectedDays + additional - INTERIM_CEILING_DAYS
        throw new ActionError(
          `Ce contrat porterait ${employee.matricule} à ${over} jour${over > 1 ? "s" : ""} au-delà du plafond de ${INTERIM_CEILING_DAYS} jours. Requalification en CDI ou transfert à envisager.`,
          { endDate: ["Dépasse le plafond légal."] }
        )
      }
    }

    const contract = await tx.contract.create({
      data: {
        firmId: ctx.firmId,
        employeeId: employee.id,
        clientId,
        type: input.type,
        status: "ACTIVE",
        startDate,
        endDate,
        position: orNull(input.position),
        salary: input.salary ?? null,
        workingHours: input.workingHours ?? null,
        trialPeriodEnd: toOptionalDate(input.trialPeriodEnd),
        alertThreshold: input.alertThreshold,
        isAutoRenewal: input.isAutoRenewal,
        isVise: input.isVise,
        isActive: true,
        notes: orNull(input.notes),
      },
      select: { id: true },
    })

    await audit({
      action: "CREATE",
      entity: "CONTRACT",
      entityId: contract.id,
      metadata: { employeeId: employee.id, type: input.type },
    })

    return contract
  },
})

export const updateContract = firmAction({
  input: updateContractSchema,
  minimumRole: "MANAGER",
  module: "hr",
  revalidate: (input) => [
    `/${input.firmSlug}/hr/contracts`,
    `/${input.firmSlug}/hr/employees`,
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    const existing = await tx.contract.findFirst({
      where: { id: input.id, firmId: ctx.firmId },
      select: { id: true, status: true, employeeId: true },
    })
    if (!existing) throw new ActionError("Contrat introuvable.")

    if (existing.status === "TERMINATED" || existing.status === "RENEWED") {
      throw new ActionError(
        "Un contrat résilié ou renouvelé ne se modifie plus. Créez-en un nouveau."
      )
    }

    const employee = await assertEmployeeInFirm(tx, ctx.firmId, input.employeeId)
    const clientId = await assertClientInFirm(tx, ctx.firmId, orNull(input.clientId))

    const startDate = toDate(input.startDate)
    const endDate = toOptionalDate(input.endDate)

    if (endDate) {
      const ceiling = await ceilingFor(
        tx,
        ctx.firmId,
        employee.id,
        input.type,
        existing.id
      )
      const additional =
        Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1
      if (renewalWouldBreach(ceiling, additional)) {
        const over = ceiling.projectedDays + additional - INTERIM_CEILING_DAYS
        throw new ActionError(
          `Cette période porterait le cumul à ${over} jour${over > 1 ? "s" : ""} au-delà du plafond de ${INTERIM_CEILING_DAYS} jours.`,
          { endDate: ["Dépasse le plafond légal."] }
        )
      }
    }

    await tx.contract.update({
      where: { id: existing.id },
      data: {
        employeeId: employee.id,
        clientId,
        type: input.type,
        startDate,
        endDate,
        position: orNull(input.position),
        salary: input.salary ?? null,
        workingHours: input.workingHours ?? null,
        trialPeriodEnd: toOptionalDate(input.trialPeriodEnd),
        alertThreshold: input.alertThreshold,
        isAutoRenewal: input.isAutoRenewal,
        isVise: input.isVise,
        notes: orNull(input.notes),
      },
    })

    await audit({
      action: "UPDATE",
      entity: "CONTRACT",
      entityId: existing.id,
      metadata: { employeeId: employee.id, type: input.type },
    })
  },
})

/* ==========================================================================
 * Renew one
 * ========================================================================== */

export const renewContract = firmAction({
  input: renewContractSchema,
  minimumRole: "MANAGER",
  module: "hr",
  revalidate: (input) => [
    `/${input.firmSlug}/hr/contracts`,
    `/${input.firmSlug}/hr/employees`,
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    const source = await tx.contract.findFirst({
      where: { id: input.id, firmId: ctx.firmId },
    })
    if (!source) throw new ActionError("Contrat introuvable.")

    if (source.status === "TERMINATED") {
      throw new ActionError("Ce contrat est résilié.")
    }
    if (source.status === "RENEWED") {
      throw new ActionError("Ce contrat a déjà été renouvelé.")
    }

    const ceiling = await ceilingFor(
      tx,
      ctx.firmId,
      source.employeeId,
      source.type
    )
    if (renewalWouldBreach(ceiling, input.durationDays)) {
      const over =
        ceiling.projectedDays + input.durationDays - INTERIM_CEILING_DAYS
      throw new ActionError(
        `Ce renouvellement dépasserait le plafond de ${over} jour${over > 1 ? "s" : ""}. Requalification en CDI ou transfert vers une autre filiale à envisager.`,
        { durationDays: ["Dépasse le plafond légal."] }
      )
    }

    const now = new Date()
    const start = source.endDate ? addDays(source.endDate, 1) : now

    const renewal = await tx.contract.create({
      data: {
        firmId: source.firmId,
        employeeId: source.employeeId,
        clientId: source.clientId,
        clientFirmId: source.clientFirmId,
        type: source.type,
        status: "ACTIVE",
        startDate: start,
        endDate: addDays(start, input.durationDays - 1),
        renewedFromId: source.id,
        alertThreshold: source.alertThreshold,
        isAutoRenewal: source.isAutoRenewal,
        position: source.position,
        salary: source.salary,
        workingHours: source.workingHours,
        // A renewal is a new contract and needs its own visa.
        isVise: false,
        isActive: true,
      },
      select: { id: true },
    })

    await tx.contract.update({
      where: { id: source.id },
      data: { status: "RENEWED", isActive: false, renewalDate: now },
    })

    await audit({
      action: "RENEW",
      entity: "CONTRACT",
      entityId: source.id,
      metadata: {
        renewalId: renewal.id,
        durationDays: input.durationDays,
        employeeId: source.employeeId,
      },
    })

    return renewal
  },
})

/* ==========================================================================
 * Terminate
 * ========================================================================== */

export const terminateContract = firmAction({
  input: terminateContractSchema,
  minimumRole: "MANAGER",
  module: "hr",
  revalidate: (input) => [
    `/${input.firmSlug}/hr/contracts`,
    `/${input.firmSlug}/hr/employees`,
    `/${input.firmSlug}/dashboard`,
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    const contract = await tx.contract.findFirst({
      where: { id: input.id, firmId: ctx.firmId },
      select: { id: true, status: true, startDate: true, employeeId: true },
    })
    if (!contract) throw new ActionError("Contrat introuvable.")
    if (contract.status === "TERMINATED") {
      throw new ActionError("Ce contrat est déjà résilié.")
    }

    const terminationDate = toDate(input.terminationDate)
    if (terminationDate < contract.startDate) {
      throw new ActionError(
        "La résiliation ne peut pas précéder le début du contrat.",
        { terminationDate: ["Antérieure au début du contrat."] }
      )
    }

    await tx.contract.update({
      where: { id: contract.id },
      data: {
        status: "TERMINATED",
        isActive: false,
        terminationDate,
        terminationReason: input.terminationReason,
        // The end date follows the termination, so the ceiling counts the days
        // actually worked rather than the days originally contracted.
        endDate: terminationDate,
      },
    })

    // An employee with no remaining active contract is no longer active staff.
    const stillActive = await tx.contract.count({
      where: {
        employeeId: contract.employeeId,
        firmId: ctx.firmId,
        status: "ACTIVE",
      },
    })
    if (stillActive === 0) {
      await tx.employee.updateMany({
        where: { id: contract.employeeId, firmId: ctx.firmId, status: "ACTIVE" },
        data: { status: "INACTIVE" },
      })
    }

    await audit({
      action: "TERMINATE",
      entity: "CONTRACT",
      entityId: contract.id,
      metadata: {
        employeeId: contract.employeeId,
        reason: input.terminationReason,
        remainingActive: stillActive,
      },
    })

    return { employeeDeactivated: stillActive === 0 }
  },
})

/* ==========================================================================
 * Visa stamp
 * ========================================================================== */

/**
 * The inspection-of-labour visa, stamped on a selection.
 *
 * `updateMany` with the firm in the predicate: ids arriving from the client are
 * filtered by tenancy in the write itself, so a crafted list touches nothing
 * outside the caller's firm and the count returned says how many actually
 * matched.
 */
export const stampVisa = firmAction({
  input: stampVisaSchema,
  minimumRole: "MANAGER",
  module: "hr",
  revalidate: (input) => `/${input.firmSlug}/hr/contracts`,
  handler: async ({ input, ctx, tx, audit }) => {
    const scoped = await tx.contract.findMany({
      where: {
        id: { in: input.ids },
        firmId: ctx.firmId,
        ...(ctx.assignedClientIds
          ? { clientId: { in: ctx.assignedClientIds } }
          : {}),
      },
      select: { id: true },
    })

    if (scoped.length === 0) {
      throw new ActionError("Aucun contrat accessible dans cette sélection.")
    }

    const result = await tx.contract.updateMany({
      where: { id: { in: scoped.map((row) => row.id) } },
      data: { isVise: input.isVise },
    })

    await audit({
      action: input.isVise ? "VISA_STAMP" : "VISA_CLEAR",
      entity: "CONTRACT",
      entityId: ctx.firmId,
      metadata: { requested: input.ids.length, applied: result.count },
    })

    return { applied: result.count, requested: input.ids.length }
  },
})
