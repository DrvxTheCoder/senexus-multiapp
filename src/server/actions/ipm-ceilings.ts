"use server"

import { toDate } from "@/lib/forms/hr-schemas"
import {
  endMemberCeilingSchema,
  setMemberCeilingSchema,
} from "@/lib/forms/ipm-schemas"
import { ActionError, firmAction } from "@/server/actions/define-action"

/**
 * Plafonds particuliers — the participant level of the ceiling precedence
 * (participant > employer > formule, see `resolveRate`).
 *
 * Effective-dated, like the cotisations, and never edited in place: setting a
 * new plafond closes the one in force the day the new one starts, so every bon
 * can be explained by the plafond that applied on its own date. MANAGER, like
 * every other affiliation write.
 */

const MODULE = "ipm"

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export const setMemberCeiling = firmAction({
  input: setMemberCeilingSchema,
  minimumRole: "MANAGER",
  module: MODULE,
  revalidate: (input) => `/${input.firmSlug}/ipm/participants/${input.memberId}`,
  handler: async ({ input, ctx, tx, audit }) => {
    const [member, category] = await Promise.all([
      tx.member.findFirst({
        where: { id: input.memberId, firmId: ctx.firmId },
        select: { id: true },
      }),
      tx.ipmServiceCategory.findFirst({
        where: { id: input.categoryId, firmId: ctx.firmId },
        select: { id: true },
      }),
    ])
    if (!member) throw new ActionError("Participant introuvable.")
    if (!category) throw new ActionError("Catégorie introuvable.")

    const validFrom = toDate(input.validFrom)

    // The one in force for this category, if any. A new plafond may only start
    // after it did: closing a period before it began would leave a row that
    // never applied, and the history would no longer say what happened.
    const open = await tx.ipmMemberCeiling.findFirst({
      where: { firmId: ctx.firmId, memberId: member.id, categoryId: category.id, validTo: null },
      orderBy: { validFrom: "desc" },
      select: { id: true, validFrom: true },
    })
    if (open && open.validFrom >= validFrom) {
      throw new ActionError(
        "Un plafond particulier commence déjà à cette date ou après. Choisissez une date postérieure.",
        { validFrom: ["Date antérieure au plafond en cours."] }
      )
    }
    if (open) {
      await tx.ipmMemberCeiling.update({
        where: { id: open.id },
        data: { validTo: validFrom },
      })
    }

    const created = await tx.ipmMemberCeiling.create({
      data: {
        firmId: ctx.firmId,
        memberId: member.id,
        categoryId: category.id,
        ceilingPerAct: input.ceilingPerAct ?? null,
        ceilingMonthly: input.ceilingMonthly ?? null,
        ceilingAnnual: input.ceilingAnnual ?? null,
        reason: input.reason,
        validFrom,
        createdById: ctx.userId,
      },
      select: { id: true },
    })

    await audit({
      action: "SET_MEMBER_CEILING",
      entity: "IPM_MEMBER",
      entityId: member.id,
      metadata: {
        categoryId: category.id,
        ceilingPerAct: input.ceilingPerAct ?? null,
        ceilingMonthly: input.ceilingMonthly ?? null,
        ceilingAnnual: input.ceilingAnnual ?? null,
        validFrom: input.validFrom,
        reason: input.reason,
        replaced: open?.id ?? null,
      },
    })

    return created
  },
})

/**
 * Retire un plafond particulier: the family falls back to the employer's and
 * the formule's from today. One that has not started yet is simply removed.
 */
export const endMemberCeiling = firmAction({
  input: endMemberCeilingSchema,
  minimumRole: "MANAGER",
  module: MODULE,
  handler: async ({ input, ctx, tx, audit }) => {
    const ceiling = await tx.ipmMemberCeiling.findFirst({
      where: { id: input.ceilingId, firmId: ctx.firmId },
      select: { id: true, memberId: true, categoryId: true, validFrom: true, validTo: true },
    })
    if (!ceiling) throw new ActionError("Plafond introuvable.")
    if (ceiling.validTo !== null) throw new ActionError("Ce plafond est déjà clos.")

    const today = startOfDay(new Date())
    if (ceiling.validFrom >= today) {
      await tx.ipmMemberCeiling.delete({ where: { id: ceiling.id } })
    } else {
      await tx.ipmMemberCeiling.update({
        where: { id: ceiling.id },
        data: { validTo: today },
      })
    }

    await audit({
      action: "END_MEMBER_CEILING",
      entity: "IPM_MEMBER",
      entityId: ceiling.memberId,
      metadata: { ceilingId: ceiling.id, categoryId: ceiling.categoryId },
    })

    return { id: ceiling.id, memberId: ceiling.memberId }
  },
})
