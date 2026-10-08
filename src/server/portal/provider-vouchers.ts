import "server-only"

import { z } from "zod"

import { db } from "@/lib/db"
import { effectiveStatus, monthBounds, monthOf } from "@/server/domain/ipm/deferred-amount"
import {
  previewProviderValidation,
  validateDeferredAmount,
} from "@/server/ipm/voucher-amount"
import type {
  IpmVoucherStatus,
  ProviderAmountPreviewResponse,
  ProviderValidateResponse,
  ProviderVoucherDetail,
  ProviderVoucherItem,
  ProviderVoucherListResponse,
  ProviderVoucherLookup,
} from "@/server/portal/contract"
import { PortalError } from "@/server/portal/http"
import { prescriptionLink } from "@/server/portal/prescription"
import type { ProviderPrincipal } from "@/server/portal/provider-auth"

/**
 * Ce que voit une pharmacie — strictly its own bons.
 *
 * Every read is keyed on the session's `providerId`, which comes from the
 * account row behind the token and never from the request. The lookup by QR
 * is the one place a bon of another pharmacy can be *named*; it answers
 * WRONG_PROVIDER and nothing about the bon.
 *
 * What a pharmacy is shown of a participant is what is printed on the bon:
 * the beneficiary's name, the reference, the amounts. No matricule, no family.
 */

const NOT_FOUND = () => new PortalError(404, "NOT_FOUND", "Bon introuvable.")

const amount = z.coerce.number()

export const lookupSchema = z.object({ token: z.string().trim().min(8).max(200) })

export const amountRequestSchema = z.object({
  voucherId: z.string().min(1).max(64),
  // Validated by the domain (whole, positive francs) so the error says
  // INVALID_AMOUNT rather than a generic field error.
  amount,
})

export const validateRequestSchema = amountRequestSchema.extend({
  idempotencyKey: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/, "Clé d'idempotence invalide (8 à 64 caractères)."),
})

export async function lookupVoucher(
  principal: ProviderPrincipal,
  token: string,
  now: Date = new Date()
): Promise<ProviderVoucherLookup> {
  const voucher = await db.ipmVoucher.findFirst({
    where: {
      firmId: principal.firmId,
      qrToken: token,
      deferredAmount: true,
      // A closed bon carries a shared dead token; it must never resolve.
      status: { notIn: ["CANCELLED", "REJECTED"] },
    },
    select: {
      id: true,
      number: true,
      providerId: true,
      beneficiaryName: true,
      issueDate: true,
      expiryDate: true,
      status: true,
      prescriptionUrl: true,
    },
  })
  if (!voucher) throw NOT_FOUND()
  if (voucher.providerId !== principal.providerId) {
    throw new PortalError(403, "WRONG_PROVIDER", "Ce bon n'est pas adressé à votre établissement.")
  }

  return {
    voucherId: voucher.id,
    number: voucher.number,
    beneficiaryName: voucher.beneficiaryName,
    issuedAt: voucher.issueDate.toISOString(),
    expiresAt: voucher.expiryDate.toISOString(),
    status: effectiveStatus(voucher.status, voucher.expiryDate, now) as IpmVoucherStatus,
    prescriptionUrl: voucher.prescriptionUrl ? prescriptionLink(voucher.id, now) : null,
  }
}

const scope = (principal: ProviderPrincipal) => ({
  firmId: principal.firmId,
  providerId: principal.providerId,
  providerAccountId: principal.providerAccountId,
})

export async function previewAmount(
  principal: ProviderPrincipal,
  input: z.infer<typeof amountRequestSchema>
): Promise<ProviderAmountPreviewResponse> {
  const preview = await previewProviderValidation(db, scope(principal), input)
  return {
    voucherId: preview.voucherId,
    amount: preview.amount,
    ipmShare: preview.ipmShare,
    participantShare: preview.participantShare,
    rate: preview.rate,
    remainingCeiling: preview.remainingCeiling,
    flags: preview.flags,
  }
}

export async function validateAmount(
  principal: ProviderPrincipal,
  input: z.infer<typeof validateRequestSchema>
): Promise<ProviderValidateResponse> {
  const result = await db.$transaction((tx) =>
    validateDeferredAmount(tx, {
      firmId: principal.firmId,
      voucherId: input.voucherId,
      amount: input.amount,
      idempotencyKey: input.idempotencyKey,
      actor: {
        kind: "provider",
        providerAccountId: principal.providerAccountId,
        providerId: principal.providerId,
      },
    })
  )
  return { ...result, status: result.status as IpmVoucherStatus }
}

const ITEM_SELECT = {
  id: true,
  number: true,
  beneficiaryName: true,
  validatedAt: true,
  totalAmount: true,
  insurerShare: true,
  memberShare: true,
  amountSource: true,
} as const

type ItemRow = {
  id: string
  number: string
  beneficiaryName: string
  validatedAt: Date | null
  totalAmount: { toString(): string } | null
  insurerShare: { toString(): string }
  memberShare: { toString(): string }
  amountSource: "PROVIDER" | "BACK_OFFICE" | null
}

function toItem(row: ItemRow): ProviderVoucherItem {
  return {
    voucherId: row.id,
    reference: row.number,
    beneficiaryName: row.beneficiaryName,
    validatedAt: row.validatedAt!.toISOString(),
    amount: Number(row.totalAmount ?? 0),
    ipmShare: Number(row.insurerShare),
    participantShare: Number(row.memberShare),
    adjustedByIpm: row.amountSource === "BACK_OFFICE",
  }
}

/**
 * The pharmacy's validated bons for a month, with the current amounts — after
 * any correction by the IPM — read off the voucher rows themselves. The total
 * is their sum, computed here from the same rows, so it cannot disagree with
 * the list nor with the invoice built from the same rows.
 */
export async function listValidated(
  principal: ProviderPrincipal,
  month: string | null,
  now: Date = new Date()
): Promise<ProviderVoucherListResponse> {
  const key = month ?? monthOf(now)
  const bounds = monthBounds(key)
  if (!bounds) {
    throw new PortalError(422, "INVALID_INPUT", "Mois invalide (AAAA-MM attendu).", {
      fields: { month: ["Format AAAA-MM."] },
    })
  }

  const rows = await db.ipmVoucher.findMany({
    where: {
      firmId: principal.firmId,
      providerId: principal.providerId,
      deferredAmount: true,
      status: { in: ["SETTLED", "INVOICED"] },
      validatedAt: { gte: bounds.from, lt: bounds.to },
    },
    orderBy: [{ validatedAt: "desc" }, { number: "desc" }],
    select: ITEM_SELECT,
  })

  const items = rows.map(toItem)
  return {
    items,
    kpi: {
      month: key,
      totalAmount: items.reduce((sum, item) => sum + item.amount, 0),
      count: items.length,
    },
  }
}

export async function voucherDetail(
  principal: ProviderPrincipal,
  voucherId: string,
  now: Date = new Date()
): Promise<ProviderVoucherDetail> {
  // Scoped in the query: another pharmacy's bon is the same 404 as none.
  const row = await db.ipmVoucher.findFirst({
    where: {
      id: voucherId,
      firmId: principal.firmId,
      providerId: principal.providerId,
      deferredAmount: true,
    },
    select: {
      ...ITEM_SELECT,
      status: true,
      issueDate: true,
      expiryDate: true,
      prescriptionUrl: true,
    },
  })
  if (!row) throw NOT_FOUND()

  return {
    voucherId: row.id,
    reference: row.number,
    beneficiaryName: row.beneficiaryName,
    status: effectiveStatus(row.status, row.expiryDate, now) as IpmVoucherStatus,
    issuedAt: row.issueDate.toISOString(),
    expiresAt: row.expiryDate.toISOString(),
    validatedAt: row.validatedAt?.toISOString() ?? null,
    amount: row.totalAmount === null ? null : Number(row.totalAmount),
    ipmShare: Number(row.insurerShare),
    participantShare: Number(row.memberShare),
    adjustedByIpm: row.amountSource === "BACK_OFFICE",
    // A cancelled bon's ordonnance is no longer the pharmacy's business.
    prescriptionUrl:
      row.prescriptionUrl && row.status !== "CANCELLED" ? prescriptionLink(row.id, now) : null,
  }
}
