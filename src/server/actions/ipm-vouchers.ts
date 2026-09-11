"use server"

import { toDate } from "@/lib/forms/hr-schemas"
import {
  cancelVoucherSchema,
  createAgreementSchema,
  createProviderSchema,
  issueVoucherSchema,
  previewVoucherSchema,
  settleVoucherSchema,
  updateProviderSchema,
} from "@/lib/forms/ipm-schemas"
import { ActionError, firmAction } from "@/server/actions/define-action"
import {
  decideIssuance,
  expiryFor,
  formatVoucherNumber,
  type Refusal,
  type Warning,
} from "@/server/domain/ipm/issuance"
import { lineTotal } from "@/server/domain/ipm/settlement"
import { nextVoucherSequence } from "@/server/domain/ipm/sequence"
import {
  issueToken,
  verificationSecret,
} from "@/server/domain/ipm/verification-token"
import { beneficiaryRef, gatherIssuanceFacts } from "@/server/queries/ipm/vouchers"

/**
 * Bons — the write layer.
 *
 * The shape that matters here is that **the pre-flight and the issue run the
 * same code**. `previewVoucher` gathers the facts and decides; `issueVoucher`
 * gathers the facts again inside the transaction and decides again before
 * writing. A check performed only in the preview is a check an operator can
 * skip by posting directly, and a check performed only at write time gives the
 * counter no chance to fix anything first.
 *
 * The second decision is not redundant with the first: the facts can move
 * between them — a plafond consumed by a colleague's bon seconds earlier — and
 * the one that counts is the one inside the transaction that writes.
 */

const orNull = (value: string | null | undefined) =>
  value && value.trim() ? value.trim() : null

const IPM_MODULE = "ipm"

function listPath(firmSlug: string, ...rest: string[]): string {
  return [`/${firmSlug}/ipm`, ...rest].join("/")
}

/* ==========================================================================
 * Prestataires
 * ========================================================================== */

export const createProvider = firmAction({
  input: createProviderSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => listPath(input.firmSlug, "prestataires"),
  handler: async ({ input, ctx, tx, audit }) => {
    const clash = await tx.ipmProvider.findFirst({
      where: {
        firmId: ctx.firmId,
        name: { equals: input.name, mode: "insensitive" },
      },
      select: { id: true },
    })
    if (clash) {
      throw new ActionError("Un prestataire porte déjà ce nom.", {
        name: ["Un prestataire porte déjà ce nom."],
      })
    }

    const provider = await tx.ipmProvider.create({
      data: {
        firmId: ctx.firmId,
        name: input.name,
        specialtyId: orNull(input.specialtyId),
        legacyCode: orNull(input.legacyCode),
        accountCode: orNull(input.accountCode),
        address: orNull(input.address),
        phone: orNull(input.phone),
        email: orNull(input.email),
        accredited: input.accredited,
        status: input.status,
        paymentTermDays: input.paymentTermDays,
        bankName: orNull(input.bankName),
        bankAccount: orNull(input.bankAccount),
      },
      select: { id: true },
    })

    await audit({
      action: "CREATE",
      entity: "IPM_PROVIDER",
      entityId: provider.id,
      metadata: { name: input.name, accredited: input.accredited },
    })

    return provider
  },
})

export const updateProvider = firmAction({
  input: updateProviderSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => listPath(input.firmSlug, "prestataires"),
  handler: async ({ input, ctx, tx, audit }) => {
    const provider = await tx.ipmProvider.findFirst({
      where: { id: input.providerId, firmId: ctx.firmId },
      select: { id: true, accredited: true },
    })
    if (!provider) throw new ActionError("Prestataire introuvable.")

    await tx.ipmProvider.update({
      where: { id: provider.id },
      data: {
        name: input.name,
        specialtyId: orNull(input.specialtyId),
        legacyCode: orNull(input.legacyCode),
        accountCode: orNull(input.accountCode),
        address: orNull(input.address),
        phone: orNull(input.phone),
        email: orNull(input.email),
        accredited: input.accredited,
        status: input.status,
        paymentTermDays: input.paymentTermDays,
        bankName: orNull(input.bankName),
        bankAccount: orNull(input.bankAccount),
      },
    })

    await audit({
      action: "UPDATE",
      entity: "IPM_PROVIDER",
      entityId: provider.id,
      metadata: {
        // Accreditation decides whether bons may be issued at all, so a change
        // to it is recorded explicitly rather than left implicit in an UPDATE.
        accreditedFrom: provider.accredited,
        accreditedTo: input.accredited,
        status: input.status,
      },
    })

    return { id: provider.id }
  },
})

export const createAgreement = firmAction({
  input: createAgreementSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => listPath(input.firmSlug, "prestataires"),
  handler: async ({ input, ctx, tx, audit }) => {
    const provider = await tx.ipmProvider.findFirst({
      where: { id: input.providerId, firmId: ctx.firmId },
      select: { id: true },
    })
    if (!provider) throw new ActionError("Prestataire introuvable.")

    const clash = await tx.ipmAgreement.findFirst({
      where: { firmId: ctx.firmId, reference: input.reference },
      select: { id: true },
    })
    if (clash) {
      throw new ActionError("Cette référence de convention existe déjà.", {
        reference: ["Cette référence existe déjà."],
      })
    }

    const agreement = await tx.ipmAgreement.create({
      data: {
        firmId: ctx.firmId,
        providerId: provider.id,
        reference: input.reference,
        startDate: toDate(input.startDate),
        endDate: input.endDate ? toDate(input.endDate) : null,
        negotiatedRate: input.negotiatedRate ?? null,
        terms: orNull(input.terms),
        status: input.status,
      },
      select: { id: true },
    })

    await audit({
      action: "CREATE",
      entity: "IPM_AGREEMENT",
      entityId: agreement.id,
      metadata: { providerId: provider.id, reference: input.reference },
    })

    return agreement
  },
})

/* ==========================================================================
 * Bons
 * ========================================================================== */

export type IssuancePreview = {
  allowed: boolean
  refusals: Refusal[]
  warnings: Warning[]
  totalAmount: number
  insurerShare: number
  memberShare: number
  appliedRate: number | null
  rateSource: string | null
  beneficiaryName: string
  categoryLabel: string
  employerName: string
}

/**
 * Dry run. Same facts, same decision, no write.
 *
 * STAFF may run it: seeing why a bon would be refused is not the same act as
 * issuing one, and the counter needs the answer before a manager is free.
 */
export const previewVoucher = firmAction({
  input: previewVoucherSchema,
  module: IPM_MODULE,
  handler: async ({ input, ctx, tx }): Promise<IssuancePreview> => {
    const totalAmount = lineTotal(
      input.lines.map((line) => ({
        quantity: line.quantity,
        unitPrice: line.unitPrice ?? 0,
      }))
    )

    const context = await gatherIssuanceFacts(
      ctx,
      {
        memberId: input.memberId,
        dependentId: orNull(input.dependentId),
        providerId: input.providerId,
        serviceTypeId: input.serviceTypeId,
        totalAmount,
        on: toDate(input.issueDate),
      },
      tx
    )

    if (!context) throw new ActionError("Participant, prestataire ou prestation introuvable.")

    const decision = decideIssuance(context.facts)

    return {
      allowed: decision.allowed,
      refusals: decision.allowed ? [] : decision.refusals,
      warnings: decision.warnings,
      totalAmount,
      insurerShare: decision.allowed ? decision.split.insurerShare : 0,
      memberShare: decision.allowed ? decision.split.memberShare : totalAmount,
      appliedRate: context.facts.rate,
      rateSource: context.rateSource,
      beneficiaryName: context.beneficiaryName,
      categoryLabel: context.categoryLabel,
      employerName: context.employerName,
    }
  },
})

/**
 * Émission.
 *
 * Everything happens in one transaction: the decision, the sequence, the
 * voucher, its lines and the consumption row. A bon that exists without its
 * consumption would let the next one through a plafond it has already used.
 */
export const issueVoucher = firmAction({
  input: issueVoucherSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => [
    listPath(input.firmSlug, "bons"),
    listPath(input.firmSlug, "participants", input.memberId),
    listPath(input.firmSlug),
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    const issueDate = toDate(input.issueDate)
    const totalAmount = lineTotal(
      input.lines.map((line) => ({
        quantity: line.quantity,
        unitPrice: line.unitPrice ?? 0,
      }))
    )

    const context = await gatherIssuanceFacts(
      ctx,
      {
        memberId: input.memberId,
        dependentId: orNull(input.dependentId),
        providerId: input.providerId,
        serviceTypeId: input.serviceTypeId,
        totalAmount,
        on: issueDate,
      },
      tx
    )
    if (!context) {
      throw new ActionError("Participant, prestataire ou prestation introuvable.")
    }

    // Decided again, here, inside the transaction that writes. The preview the
    // operator saw may be seconds old, and a plafond can be consumed in that
    // time by somebody else's bon.
    const decision = decideIssuance(context.facts)

    if (!decision.allowed) {
      throw new ActionError(
        decision.refusals.map((refusal) => refusal.message).join(" "),
        { _: decision.refusals.map((refusal) => refusal.message) }
      )
    }

    // A warning is a decision for a person to take, and taking it is recorded.
    // What is never possible is proceeding past a *refusal*.
    if (decision.warnings.length > 0 && !input.acknowledgeWarnings) {
      throw new ActionError(
        `${decision.warnings.map((warning) => warning.message).join(" ")} Confirmez pour émettre malgré tout.`,
        { acknowledgeWarnings: ["Confirmation requise."] }
      )
    }

    const sequence = await nextVoucherSequence(tx, ctx.firmId, input.type)
    const number = formatVoucherNumber(input.type, sequence)

    const voucher = await tx.ipmVoucher.create({
      data: {
        firmId: ctx.firmId,
        number,
        type: input.type,
        memberId: input.memberId,
        dependentId: orNull(input.dependentId),
        beneficiaryType: context.beneficiaryType,
        beneficiaryName: context.beneficiaryName,
        providerId: input.providerId,
        serviceTypeId: input.serviceTypeId,
        categoryId: context.categoryId,
        issueDate,
        expiryDate: expiryFor(input.type, issueDate),
        status: "ISSUED",
        totalAmount,
        insurerShare: decision.split.insurerShare,
        memberShare: decision.split.memberShare,
        // Frozen. A later edit to a barème must not reprice a bon already in
        // somebody's hand.
        appliedRate: context.facts.rate!,
        rateSource: context.rateSource ?? "PLAN",
        qrToken: issueToken(
          { kind: "member", id: input.memberId },
          verificationSecret()
        ),
        issuedById: ctx.userId,
      },
      select: { id: true, number: true },
    })

    await tx.ipmVoucherLine.createMany({
      data: input.lines.map((line) => ({
        firmId: ctx.firmId,
        voucherId: voucher.id,
        medicalActId: orNull(line.medicalActId),
        label: line.label,
        quantity: line.quantity,
        unitPrice: line.unitPrice ?? 0,
        amount: Math.round(line.quantity * (line.unitPrice ?? 0)),
      })),
    })

    // Consumption is recorded at **issue**, not at settlement. The commitment
    // is what a plafond has to account for: a bon in circulation is money the
    // institution has already promised, and leaving it uncounted until the
    // invoice arrives is how a ceiling is overrun.
    await tx.ipmConsumption.create({
      data: {
        firmId: ctx.firmId,
        beneficiaryRef: beneficiaryRef(
          input.memberId,
          orNull(input.dependentId)
        ),
        memberId: input.memberId,
        categoryId: context.categoryId,
        periodYear: issueDate.getFullYear(),
        periodMonth: issueDate.getMonth() + 1,
        voucherId: voucher.id,
        amount: totalAmount,
        insurerShare: decision.split.insurerShare,
      },
    })

    await audit({
      action: "ISSUE_VOUCHER",
      entity: "IPM_VOUCHER",
      entityId: voucher.id,
      metadata: {
        number: voucher.number,
        memberId: input.memberId,
        providerId: input.providerId,
        totalAmount,
        insurerShare: decision.split.insurerShare,
        appliedRate: context.facts.rate,
        rateSource: context.rateSource,
        warningsAcknowledged: decision.warnings.map((w) => w.code),
      },
    })

    return voucher
  },
})

export const settleVoucher = firmAction({
  input: settleVoucherSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => listPath(input.firmSlug, "bons"),
  handler: async ({ input, ctx, tx, audit }) => {
    const voucher = await tx.ipmVoucher.findFirst({
      where: { id: input.voucherId, firmId: ctx.firmId },
      select: { id: true, number: true, status: true },
    })
    if (!voucher) throw new ActionError("Bon introuvable.")
    if (voucher.status === "CANCELLED") {
      throw new ActionError("Ce bon est annulé.")
    }
    if (voucher.status === "SETTLED" || voucher.status === "INVOICED") {
      throw new ActionError("Ce bon est déjà réglé.")
    }

    await tx.ipmVoucher.update({
      where: { id: voucher.id },
      data: {
        status: "SETTLED",
        settledAt: toDate(input.settledOn),
        settledById: ctx.userId,
      },
    })

    await audit({
      action: "SETTLE_VOUCHER",
      entity: "IPM_VOUCHER",
      entityId: voucher.id,
      metadata: { number: voucher.number, settledOn: input.settledOn },
    })

    return { id: voucher.id }
  },
})

/**
 * Annulation.
 *
 * The consumption row goes with it — a cancelled bon must not keep holding
 * space under a plafond — and the QR token is rotated so a printed copy stops
 * verifying. The voucher itself stays, with its reason.
 */
export const cancelVoucher = firmAction({
  input: cancelVoucherSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => listPath(input.firmSlug, "bons"),
  handler: async ({ input, ctx, tx, audit }) => {
    const voucher = await tx.ipmVoucher.findFirst({
      where: { id: input.voucherId, firmId: ctx.firmId },
      select: { id: true, number: true, status: true, insurerShare: true },
    })
    if (!voucher) throw new ActionError("Bon introuvable.")
    if (voucher.status === "CANCELLED") {
      throw new ActionError("Ce bon est déjà annulé.")
    }
    if (voucher.status === "INVOICED") {
      throw new ActionError(
        "Ce bon est rattaché à une facture prestataire : il ne peut plus être annulé."
      )
    }

    await tx.ipmVoucher.update({
      where: { id: voucher.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: input.reason,
        // Rotated, so a photographed copy stops resolving.
        qrToken: issueToken(
          { kind: "member", id: voucher.id, expiresAt: 1 },
          verificationSecret()
        ),
      },
    })

    await tx.ipmConsumption.deleteMany({ where: { voucherId: voucher.id } })

    await audit({
      action: "CANCEL_VOUCHER",
      entity: "IPM_VOUCHER",
      entityId: voucher.id,
      metadata: {
        number: voucher.number,
        reason: input.reason,
        releasedInsurerShare: Number(voucher.insurerShare),
      },
    })

    return { id: voucher.id }
  },
})
