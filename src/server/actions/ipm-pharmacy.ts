"use server"

import type { Prisma } from "@prisma/client"
import { hash } from "bcryptjs"

import {
  providerAccountActiveSchema,
  providerAccountSchema,
  providerCredentialsSchema,
  voidVoucherSchema,
  voucherAmountPreviewSchema,
  voucherAmountSchema,
} from "@/lib/forms/ipm-schemas"
import { ActionError, firmAction } from "@/server/actions/define-action"
import {
  adjustDeferredAmount,
  previewBackOfficeAmount,
  validateDeferredAmount,
  voidDeferredVoucher,
} from "@/server/ipm/voucher-amount"
import { BCRYPT_COST } from "@/server/portal/provider-auth"
import {
  normaliseProviderCode,
  temporaryPassword,
} from "@/server/portal/provider-credentials"

/**
 * Bon de pharmacie à montant différé et accès prestataire — the
 * gestionnaire's side.
 *
 * The amount actions are thin: the rules and every consequence live in
 * `server/ipm/voucher-amount.ts`, which the pharmacy's own route calls too, so
 * a correction made here reaches the participant's balance, the pharmacy's
 * list and the invoice through the same function as a validation at the
 * counter. Each one takes a mandatory reason and is audited twice: the
 * amount history on the bon, and the firm's audit log.
 *
 * MANAGER, like every other act on a bon.
 */

const MODULE = "ipm"

const bonsPaths = (input: { firmSlug: string }) => [
  `/${input.firmSlug}/ipm/bons`,
  `/${input.firmSlug}/ipm/factures`,
  `/${input.firmSlug}/ipm/decaissements`,
]

/** The split before confirming — the same pricing the write uses. */
export const previewVoucherAmount = firmAction({
  input: voucherAmountPreviewSchema,
  minimumRole: "MANAGER",
  module: MODULE,
  handler: async ({ input, ctx, tx }) =>
    previewBackOfficeAmount(tx, { firmId: ctx.firmId }, input),
})

/**
 * Saisir le montant à la place de la pharmacie — for a pharmacy that does not
 * use the portal. Not bound to the provider, not stopped by the expiry.
 */
export const validateVoucherAmount = firmAction({
  input: voucherAmountSchema,
  minimumRole: "MANAGER",
  module: MODULE,
  revalidate: bonsPaths,
  handler: async ({ input, ctx, tx, audit }) => {
    const result = await validateDeferredAmount(tx, {
      firmId: ctx.firmId,
      voucherId: input.voucherId,
      amount: input.amount,
      reason: input.reason,
      actor: { kind: "user", userId: ctx.userId },
    })
    await audit({
      action: "VALIDATE_VOUCHER_AMOUNT",
      entity: "IPM_VOUCHER",
      entityId: result.voucherId,
      metadata: {
        number: result.number,
        amount: result.amount,
        ipmShare: result.ipmShare,
        reason: input.reason,
      },
    })
    return result
  },
})

/** Corriger le montant d'un bon déjà validé. */
export const adjustVoucherAmount = firmAction({
  input: voucherAmountSchema,
  minimumRole: "MANAGER",
  module: MODULE,
  revalidate: bonsPaths,
  handler: async ({ input, ctx, tx, audit }) => {
    const before = await tx.ipmVoucher.findFirst({
      where: { id: input.voucherId, firmId: ctx.firmId },
      select: { totalAmount: true, insurerShare: true },
    })
    const result = await adjustDeferredAmount(tx, {
      firmId: ctx.firmId,
      voucherId: input.voucherId,
      amount: input.amount,
      reason: input.reason,
      userId: ctx.userId,
    })
    await audit({
      action: "ADJUST_VOUCHER_AMOUNT",
      entity: "IPM_VOUCHER",
      entityId: result.voucherId,
      metadata: {
        number: result.number,
        from: before?.totalAmount === null || !before ? null : Number(before.totalAmount),
        to: result.amount,
        ipmShareFrom: before ? Number(before.insurerShare) : null,
        ipmShareTo: result.ipmShare,
        reason: input.reason,
      },
    })
    return result
  },
})

/** Annuler un bon de pharmacie, en attente ou validé. */
export const voidPharmacyVoucher = firmAction({
  input: voidVoucherSchema,
  minimumRole: "MANAGER",
  module: MODULE,
  revalidate: bonsPaths,
  handler: async ({ input, ctx, tx, audit }) => {
    const result = await voidDeferredVoucher(tx, {
      firmId: ctx.firmId,
      voucherId: input.voucherId,
      reason: input.reason,
      userId: ctx.userId,
    })
    await audit({
      action: "VOID_PHARMACY_VOUCHER",
      entity: "IPM_VOUCHER",
      entityId: result.voucherId,
      metadata: { number: result.number, reason: input.reason },
    })
    return result
  },
})

/* ==========================================================================
 * Accès prestataire
 * ========================================================================== */

const providerPath = (input: { firmSlug: string; providerId: string }) =>
  `/${input.firmSlug}/ipm/prestataires/${input.providerId}`

async function requireProvider(
  tx: Prisma.TransactionClient,
  firmId: string,
  providerId: string
) {
  const provider = await tx.ipmProvider.findFirst({
    where: { id: providerId, firmId },
    select: { id: true, name: true, account: { select: { id: true, username: true } } },
  })
  if (!provider) throw new ActionError("Prestataire introuvable.")
  return provider
}

/**
 * Crée l'accès d'un prestataire. The temporary password is returned **once**,
 * to be handed over; only its hash is kept, and it must be changed at the
 * first login.
 */
export const createProviderCredentials = firmAction({
  input: providerCredentialsSchema,
  minimumRole: "MANAGER",
  module: MODULE,
  revalidate: providerPath,
  handler: async ({ input, ctx, tx, audit }) => {
    const provider = await requireProvider(tx, ctx.firmId, input.providerId)
    if (provider.account) {
      throw new ActionError("Ce prestataire a déjà un accès. Réinitialisez son mot de passe.")
    }
    const username = normaliseProviderCode(input.code)
    const taken = await tx.providerAccount.findUnique({
      where: { username },
      select: { id: true },
    })
    if (taken) {
      throw new ActionError("Ce code est déjà utilisé par un autre prestataire.", {
        code: ["Code déjà utilisé."],
      })
    }

    const password = temporaryPassword()
    await tx.providerAccount.create({
      data: {
        firmId: ctx.firmId,
        providerId: provider.id,
        username,
        passwordHash: await hash(password, BCRYPT_COST),
        mustChangePassword: true,
        createdById: ctx.userId,
      },
    })
    await audit({
      action: "CREATE_PROVIDER_ACCOUNT",
      entity: "IPM_PROVIDER",
      entityId: provider.id,
      // Never the password.
      metadata: { provider: provider.name, username },
    })
    return { username, temporaryPassword: password }
  },
})

/**
 * Réinitialise le mot de passe: a new temporary one, shown once; every open
 * session closed; the lock lifted.
 */
export const resetProviderPassword = firmAction({
  input: providerAccountSchema,
  minimumRole: "MANAGER",
  module: MODULE,
  revalidate: providerPath,
  handler: async ({ input, ctx, tx, audit }) => {
    const provider = await requireProvider(tx, ctx.firmId, input.providerId)
    if (!provider.account) throw new ActionError("Ce prestataire n'a pas encore d'accès.")

    const password = temporaryPassword()
    const now = new Date()
    await tx.providerAccount.update({
      where: { id: provider.account.id },
      data: {
        passwordHash: await hash(password, BCRYPT_COST),
        mustChangePassword: true,
        failedAttempts: 0,
        lockedUntil: null,
      },
    })
    await tx.providerSession.updateMany({
      where: { accountId: provider.account.id, revokedAt: null },
      data: { revokedAt: now },
    })
    await audit({
      action: "RESET_PROVIDER_PASSWORD",
      entity: "IPM_PROVIDER",
      entityId: provider.id,
      metadata: { provider: provider.name, username: provider.account.username },
    })
    return { username: provider.account.username, temporaryPassword: password }
  },
})

/** Désactive ou réactive l'accès. Deactivating closes every session at once. */
export const setProviderAccountActive = firmAction({
  input: providerAccountActiveSchema,
  minimumRole: "MANAGER",
  module: MODULE,
  revalidate: providerPath,
  handler: async ({ input, ctx, tx, audit }) => {
    const provider = await requireProvider(tx, ctx.firmId, input.providerId)
    if (!provider.account) throw new ActionError("Ce prestataire n'a pas encore d'accès.")

    await tx.providerAccount.update({
      where: { id: provider.account.id },
      data: { isActive: input.active },
    })
    if (!input.active) {
      await tx.providerSession.updateMany({
        where: { accountId: provider.account.id, revokedAt: null },
        data: { revokedAt: new Date() },
      })
    }
    await audit({
      action: input.active ? "ACTIVATE_PROVIDER_ACCOUNT" : "DEACTIVATE_PROVIDER_ACCOUNT",
      entity: "IPM_PROVIDER",
      entityId: provider.id,
      metadata: { provider: provider.name, username: provider.account.username },
    })
    return { active: input.active }
  },
})
