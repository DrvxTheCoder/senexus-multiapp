"use server"

import { Prisma } from "@prisma/client"

import {
  DEFAULT_ANNUAL_DAYS,
  approveLeaveSchema,
  rejectLeaveSchema,
  requestLeaveSchema,
  rolloverLeaveSchema,
  toDate,
} from "@/lib/forms/hr-schemas"
import { ActionError, firmAction } from "@/server/actions/define-action"
import { businessDaysBetween } from "@/server/domain/dates"

/**
 * Leave requests and balances.
 *
 * The balance is only touched on **approval**, never on request: a pending
 * request that is later refused must not have consumed anything. The legacy
 * app decremented on approval too, which is right; what it did not do was put
 * the decrement and the status change in one transaction, so a failure between
 * them left a balance short.
 *
 * Days are counted Monday–Friday, inclusive of both ends. Public holidays are
 * not subtracted — there is nowhere in the schema to record the Senegalese
 * calendar, and a hard-coded list would be wrong the first time a movable feast
 * shifted. See `businessDaysBetween`.
 */

export const requestLeave = firmAction({
  input: requestLeaveSchema,
  minimumRole: "STAFF",
  module: "hr",
  revalidate: (input) => `/${input.firmSlug}/hr/leaves`,
  handler: async ({ input, ctx, tx, audit }) => {
    const employee = await tx.employee.findFirst({
      where: {
        id: input.employeeId,
        firmId: ctx.firmId,
        ...(ctx.assignedClientIds
          ? { assignedClientId: { in: ctx.assignedClientIds } }
          : {}),
      },
      select: { id: true, matricule: true },
    })
    if (!employee) throw new ActionError("Employé introuvable.")

    const startDate = toDate(input.startDate)
    const endDate = toDate(input.endDate)
    const totalDays = businessDaysBetween(startDate, endDate)

    if (totalDays === 0) {
      throw new ActionError(
        "Cette période ne contient aucun jour ouvrable.",
        { endDate: ["Aucun jour ouvrable dans cette période."] }
      )
    }

    // Two approved or pending leaves cannot cover the same day.
    const overlap = await tx.leaveRequest.findFirst({
      where: {
        employeeId: employee.id,
        status: { in: ["PENDING", "APPROVED"] },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
      select: { id: true, startDate: true, endDate: true },
    })
    if (overlap) {
      throw new ActionError(
        "Une demande couvre déjà tout ou partie de cette période.",
        { startDate: ["Chevauchement avec une demande existante."] }
      )
    }

    const request = await tx.leaveRequest.create({
      data: {
        firmId: ctx.firmId,
        employeeId: employee.id,
        leaveType: input.leaveType,
        startDate,
        endDate,
        totalDays: new Prisma.Decimal(totalDays),
        isPaid: input.isPaid,
        reason: input.reason?.trim() || null,
        status: "PENDING",
      },
      select: { id: true },
    })

    await audit({
      action: "CREATE",
      entity: "LEAVE_REQUEST",
      entityId: request.id,
      metadata: {
        employeeId: employee.id,
        leaveType: input.leaveType,
        totalDays,
      },
    })

    return { id: request.id, totalDays }
  },
})

/* -------------------------------------------------------------------------- */

export const approveLeave = firmAction({
  input: approveLeaveSchema,
  minimumRole: "MANAGER",
  module: "hr",
  revalidate: (input) => [
    `/${input.firmSlug}/hr/leaves`,
    `/${input.firmSlug}/decisions`,
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    const request = await tx.leaveRequest.findFirst({
      where: { id: input.id, firmId: ctx.firmId },
      select: {
        id: true,
        status: true,
        employeeId: true,
        leaveType: true,
        totalDays: true,
        startDate: true,
      },
    })
    if (!request) throw new ActionError("Demande introuvable.")
    if (request.status !== "PENDING") {
      throw new ActionError("Cette demande a déjà été traitée.")
    }

    const days = Number(request.totalDays)
    const year = request.startDate.getUTCFullYear()

    await tx.leaveRequest.update({
      where: { id: request.id },
      data: {
        status: "APPROVED",
        reviewedBy: ctx.userId,
        reviewedAt: new Date(),
      },
    })

    /**
     * Only ANNUAL runs against a balance. Sick, maternity and the rest are
     * entitlements with their own rules that the schema does not model, so
     * decrementing an annual balance for them would be wrong.
     */
    let remaining: number | null = null
    if (request.leaveType === "ANNUAL") {
      const balance = await tx.leaveBalance.findUnique({
        where: {
          employeeId_year_leaveType: {
            employeeId: request.employeeId,
            year,
            leaveType: "ANNUAL",
          },
        },
        select: { id: true, totalDays: true, usedDays: true, carriedOver: true },
      })

      if (balance) {
        const used = Number(balance.usedDays) + days
        const entitlement = Number(balance.totalDays) + Number(balance.carriedOver)
        remaining = entitlement - used

        if (remaining < 0) {
          throw new ActionError(
            `Solde insuffisant : ${entitlement - Number(balance.usedDays)} jour(s) restant(s) pour ${days} demandé(s).`
          )
        }

        await tx.leaveBalance.update({
          where: { id: balance.id },
          data: {
            usedDays: new Prisma.Decimal(used),
            remainingDays: new Prisma.Decimal(remaining),
          },
        })
      } else {
        // No balance row for the year yet: open one at the statutory
        // entitlement rather than refusing an otherwise valid request.
        remaining = DEFAULT_ANNUAL_DAYS - days
        if (remaining < 0) {
          throw new ActionError(
            `Solde insuffisant : ${DEFAULT_ANNUAL_DAYS} jour(s) de droit annuel pour ${days} demandé(s).`
          )
        }
        await tx.leaveBalance.create({
          data: {
            employeeId: request.employeeId,
            year,
            leaveType: "ANNUAL",
            totalDays: new Prisma.Decimal(DEFAULT_ANNUAL_DAYS),
            usedDays: new Prisma.Decimal(days),
            remainingDays: new Prisma.Decimal(remaining),
          },
        })
      }
    }

    await audit({
      action: "APPROVE",
      entity: "LEAVE_REQUEST",
      entityId: request.id,
      metadata: { employeeId: request.employeeId, days, remaining },
    })

    return { remaining }
  },
})

/* -------------------------------------------------------------------------- */

export const rejectLeave = firmAction({
  input: rejectLeaveSchema,
  minimumRole: "MANAGER",
  module: "hr",
  revalidate: (input) => [
    `/${input.firmSlug}/hr/leaves`,
    `/${input.firmSlug}/decisions`,
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    const request = await tx.leaveRequest.findFirst({
      where: { id: input.id, firmId: ctx.firmId },
      select: { id: true, status: true, employeeId: true },
    })
    if (!request) throw new ActionError("Demande introuvable.")
    if (request.status !== "PENDING") {
      throw new ActionError("Cette demande a déjà été traitée.")
    }

    await tx.leaveRequest.update({
      where: { id: request.id },
      data: {
        status: "REJECTED",
        reviewedBy: ctx.userId,
        reviewedAt: new Date(),
        rejectionReason: input.rejectionReason,
      },
    })

    await audit({
      action: "REJECT",
      entity: "LEAVE_REQUEST",
      entityId: request.id,
      metadata: {
        employeeId: request.employeeId,
        reason: input.rejectionReason,
      },
    })
  },
})

/* -------------------------------------------------------------------------- */

/**
 * Year-end rollover.
 *
 * Opens next year's ANNUAL balance for every active employee, carrying over at
 * most `maxCarryOver` unused days. Idempotent: a balance that already exists
 * for the target year is left alone, so running it twice cannot double anyone's
 * entitlement — which is the failure mode that matters for a job somebody will
 * click again when they are not sure it worked.
 */
export const rolloverLeaveBalances = firmAction({
  input: rolloverLeaveSchema,
  minimumRole: "ADMIN",
  module: "hr",
  revalidate: (input) => `/${input.firmSlug}/hr/leaves`,
  handler: async ({ input, ctx, tx, audit }) => {
    const targetYear = input.year + 1

    const employees = await tx.employee.findMany({
      where: { firmId: ctx.firmId, status: { in: ["ACTIVE", "ON_LEAVE"] } },
      select: {
        id: true,
        leaveBalances: {
          where: { leaveType: "ANNUAL", year: { in: [input.year, targetYear] } },
          select: {
            year: true,
            totalDays: true,
            usedDays: true,
            carriedOver: true,
            remainingDays: true,
          },
        },
      },
    })

    let created = 0
    let skipped = 0
    let carriedTotal = 0

    for (const employee of employees) {
      const already = employee.leaveBalances.find(
        (balance) => balance.year === targetYear
      )
      if (already) {
        skipped += 1
        continue
      }

      const previous = employee.leaveBalances.find(
        (balance) => balance.year === input.year
      )
      const unused = previous ? Math.max(0, Number(previous.remainingDays)) : 0
      const carried = Math.min(unused, input.maxCarryOver)

      await tx.leaveBalance.create({
        data: {
          employeeId: employee.id,
          year: targetYear,
          leaveType: "ANNUAL",
          totalDays: new Prisma.Decimal(DEFAULT_ANNUAL_DAYS),
          usedDays: new Prisma.Decimal(0),
          carriedOver: new Prisma.Decimal(carried),
          remainingDays: new Prisma.Decimal(DEFAULT_ANNUAL_DAYS + carried),
        },
      })

      created += 1
      carriedTotal += carried
    }

    await audit({
      action: "ROLLOVER",
      entity: "LEAVE_BALANCE",
      entityId: ctx.firmId,
      metadata: {
        fromYear: input.year,
        toYear: targetYear,
        created,
        skipped,
        carriedTotal,
        maxCarryOver: input.maxCarryOver,
      },
    })

    return { targetYear, created, skipped, carriedTotal }
  },
})
