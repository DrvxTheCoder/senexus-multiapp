"use server"

import {
  rejectPortalVoucherSchema,
  reviewPortalVoucherSchema,
} from "@/lib/forms/ipm-schemas"
import { ActionError, firmAction } from "@/server/actions/define-action"
import { rejectVoucherCore } from "@/server/ipm/voucher-writes"

/**
 * Validation des bons émis depuis le portail — the gestionnaire's side.
 *
 * Three acts, all by a User, so all audited in the transaction that writes
 * them (the portal's own writes are not: see OPEN_QUESTIONS Q23):
 *
 *   - **Valider** a held bon: PENDING_REVIEW → ISSUED. Its share was reserved
 *     when the participant submitted it, so nothing is recomputed — the bon is
 *     released exactly as it was priced;
 *   - **Refuser** it: REJECTED, with a reason the participant reads. Same
 *     release as a cancellation: dead QR token, consumption freed;
 *   - **Marquer comme vu** a bon that was issued at once but flagged.
 *
 * The first two notify the participant, in the same transaction.
 */

const MODULE = "ipm"

const revalidate = (input: { firmSlug: string }) => [
  `/${input.firmSlug}/ipm/validations`,
  `/${input.firmSlug}/ipm/bons`,
]

export const approvePortalVoucher = firmAction({
  input: reviewPortalVoucherSchema,
  minimumRole: "MANAGER",
  module: MODULE,
  revalidate,
  handler: async ({ input, ctx, tx, audit }) => {
    const voucher = await tx.ipmVoucher.findFirst({
      where: { id: input.voucherId, firmId: ctx.firmId, origin: "PORTAL" },
      select: { id: true, number: true, status: true, issuedByPortalAccountId: true },
    })
    if (!voucher) throw new ActionError("Bon introuvable.")

    // Conditional on the status, so an approval racing a cancellation from
    // the portal cannot resurrect a bon the participant has just withdrawn.
    const { count } = await tx.ipmVoucher.updateMany({
      where: { id: voucher.id, status: "PENDING_REVIEW" },
      data: { status: "ISSUED", reviewedAt: new Date(), reviewedById: ctx.userId },
    })
    if (count === 0) {
      throw new ActionError("Ce bon n'est plus en attente de validation.")
    }

    if (voucher.issuedByPortalAccountId) {
      await tx.portalNotification.create({
        data: {
          firmId: ctx.firmId,
          portalAccountId: voucher.issuedByPortalAccountId,
          voucherId: voucher.id,
          kind: "VOUCHER_APPROVED",
        },
      })
    }

    await audit({
      action: "APPROVE_PORTAL_VOUCHER",
      entity: "IPM_VOUCHER",
      entityId: voucher.id,
      metadata: { number: voucher.number },
    })

    return { id: voucher.id }
  },
})

export const rejectPortalVoucher = firmAction({
  input: rejectPortalVoucherSchema,
  minimumRole: "MANAGER",
  module: MODULE,
  revalidate,
  handler: async ({ input, ctx, tx, audit }) => {
    const voucher = await rejectVoucherCore(
      tx,
      { firmId: ctx.firmId, reviewerId: ctx.userId },
      { voucherId: input.voucherId, reason: input.reason }
    )

    if (voucher.issuedByPortalAccountId) {
      await tx.portalNotification.create({
        data: {
          firmId: ctx.firmId,
          portalAccountId: voucher.issuedByPortalAccountId,
          voucherId: voucher.id,
          kind: "VOUCHER_REJECTED",
        },
      })
    }

    await audit({
      action: "REJECT_PORTAL_VOUCHER",
      entity: "IPM_VOUCHER",
      entityId: voucher.id,
      metadata: {
        number: voucher.number,
        reason: input.reason,
        releasedInsurerShare: voucher.insurerShare,
      },
    })

    return { id: voucher.id }
  },
})

export const acknowledgePortalVoucher = firmAction({
  input: reviewPortalVoucherSchema,
  minimumRole: "MANAGER",
  module: MODULE,
  revalidate,
  handler: async ({ input, ctx, tx, audit }) => {
    const voucher = await tx.ipmVoucher.findFirst({
      where: { id: input.voucherId, firmId: ctx.firmId, origin: "PORTAL" },
      select: { id: true, number: true, reviewFlags: true },
    })
    if (!voucher) throw new ActionError("Bon introuvable.")

    const { count } = await tx.ipmVoucher.updateMany({
      where: { id: voucher.id, reviewedAt: null, status: { not: "PENDING_REVIEW" } },
      data: { reviewedAt: new Date(), reviewedById: ctx.userId },
    })
    if (count === 0) throw new ActionError("Ce bon a déjà été vu.")

    await audit({
      action: "ACKNOWLEDGE_PORTAL_VOUCHER",
      entity: "IPM_VOUCHER",
      entityId: voucher.id,
      metadata: { number: voucher.number, flags: voucher.reviewFlags },
    })

    return { id: voucher.id }
  },
})
