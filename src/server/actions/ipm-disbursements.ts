"use server"

import { z } from "zod"

import type { Prisma } from "@prisma/client"

import { amountField, dateField, toDate } from "@/lib/forms/hr-schemas"
import {
  checkProviderInvoiceSchema,
  disbursementFromInvoiceSchema,
  generateProviderInvoiceSchema,
  previewProviderInvoiceSchema,
  reviewReimbursementSchema,
  visaDisbursementSchema,
} from "@/lib/forms/ipm-schemas"
import {
  ActionError,
  firmAction,
  type AuditFn,
} from "@/server/actions/define-action"
import type { FirmContext } from "@/server/auth/require-firm-access"
import { split } from "@/server/domain/ipm/settlement"
import { nextInSequence } from "@/server/domain/ipm/sequence"

/**
 * Décaissements — plan §4.9.
 *
 * The governance rule is the point of this file, and it is a rule about
 * *people*, not about data:
 *
 *   **A visa is recorded only when the person it belongs to performs the
 *   approval themselves.** There is no field anywhere that lets one user
 *   stamp another's approval, and no action takes an "approvedBy" from its
 *   input — it is always `ctx.userId`. An application that can apply somebody
 *   else's signature has no signatures at all.
 *
 * VISA RÉCEPTION is deliberately not an approval action: it is the payee
 * signing on collection, on paper. What is recorded here is only that the
 * document was collected, and when.
 */

const IPM_MODULE = "ipm"
const firmScoped = { firmSlug: z.string().min(1) }

const orNull = (value: string | null | undefined) =>
  value && value.trim() ? value.trim() : null

function listPath(firmSlug: string, ...rest: string[]): string {
  return [`/${firmSlug}/ipm`, ...rest].join("/")
}

/* ==========================================================================
 * Factures prestataires
 * ========================================================================== */

const recordProviderInvoiceSchema = z.object({
  ...firmScoped,
  providerId: z.string().min(1),
  number: z.string().trim().min(1).max(40),
  receivedDate: dateField,
  periodFrom: dateField,
  periodTo: dateField,
  totalAmount: amountField.refine((value) => value !== null && value > 0, {
    message: "Montant requis.",
  }),
})

/**
 * Enregistre une facture et rapproche les bons de la période.
 *
 * The matching is the whole point: the sum of the insurer shares on the bons
 * actually issued to that provider over that period, against what the provider
 * claims. The difference is the figure WebLamps cannot produce, and the reason
 * nobody checks invoices today.
 *
 * The bons are marked INVOICED so they cannot be attached twice.
 */
export const recordProviderInvoice = firmAction({
  input: recordProviderInvoiceSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => listPath(input.firmSlug, "decaissements"),
  handler: async ({ input, ctx, tx, audit }) => {
    const provider = await tx.ipmProvider.findFirst({
      where: { id: input.providerId, firmId: ctx.firmId },
      select: { id: true, name: true },
    })
    if (!provider) throw new ActionError("Prestataire introuvable.")

    const periodFrom = toDate(input.periodFrom)
    const periodTo = toDate(input.periodTo)
    if (periodTo < periodFrom) {
      throw new ActionError("La période se termine avant de commencer.", {
        periodTo: ["Date antérieure au début de période."],
      })
    }

    const clash = await tx.ipmProviderInvoice.findFirst({
      where: {
        firmId: ctx.firmId,
        providerId: provider.id,
        number: input.number,
      },
      select: { id: true },
    })
    if (clash) {
      throw new ActionError("Cette facture est déjà enregistrée.", {
        number: ["Numéro déjà enregistré pour ce prestataire."],
      })
    }

    const settled = await tx.ipmVoucher.findMany({
      where: {
        firmId: ctx.firmId,
        providerId: provider.id,
        status: "SETTLED",
        settledAt: { gte: periodFrom, lte: periodTo },
      },
      select: { id: true, insurerShare: true },
    })

    const matched = settled.reduce(
      (sum, voucher) => sum + Number(voucher.insurerShare),
      0
    )

    const invoice = await tx.ipmProviderInvoice.create({
      data: {
        firmId: ctx.firmId,
        providerId: provider.id,
        number: input.number,
        receivedDate: toDate(input.receivedDate),
        periodFrom,
        periodTo,
        totalAmount: input.totalAmount!,
        matchedAmount: matched,
        status: "RECEIVED",
      },
      select: { id: true },
    })

    if (settled.length > 0) {
      await tx.ipmVoucher.updateMany({
        where: { id: { in: settled.map((voucher) => voucher.id) } },
        data: { status: "INVOICED", providerInvoiceId: invoice.id },
      })
    }

    await audit({
      action: "RECORD_PROVIDER_INVOICE",
      entity: "IPM_PROVIDER_INVOICE",
      entityId: invoice.id,
      metadata: {
        provider: provider.name,
        number: input.number,
        claimed: input.totalAmount,
        matched,
        // The variance is audited at the moment of recording, so a later edit
        // to a bon cannot rewrite what the check saw.
        variance: (input.totalAmount ?? 0) - matched,
        vouchers: settled.length,
      },
    })

    return { id: invoice.id, matched, variance: (input.totalAmount ?? 0) - matched }
  },
})

export const checkProviderInvoice = firmAction({
  input: checkProviderInvoiceSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => listPath(input.firmSlug, "decaissements"),
  handler: async ({ input, ctx, tx, audit }) => {
    const invoice = await tx.ipmProviderInvoice.findFirst({
      where: { id: input.invoiceId, firmId: ctx.firmId },
      select: { id: true, number: true, status: true },
    })
    if (!invoice) throw new ActionError("Facture introuvable.")
    if (invoice.status === "PAID") {
      throw new ActionError("Cette facture est déjà réglée.")
    }
    if (input.decision === "REJECTED" && !input.rejectReason?.trim()) {
      throw new ActionError("Un rejet doit être motivé.", {
        rejectReason: ["Motif requis."],
      })
    }

    await tx.ipmProviderInvoice.update({
      where: { id: invoice.id },
      data: {
        status: input.decision,
        // Always the caller. Never a name taken from the form.
        checkedById: ctx.userId,
        checkedAt: new Date(),
        rejectReason: orNull(input.rejectReason),
      },
    })

    await audit({
      action: "CHECK_PROVIDER_INVOICE",
      entity: "IPM_PROVIDER_INVOICE",
      entityId: invoice.id,
      metadata: {
        number: invoice.number,
        from: invoice.status,
        to: input.decision,
        reason: input.rejectReason ?? null,
      },
    })

    return { id: invoice.id }
  },
})

/* ==========================================================================
 * Remboursements
 * ========================================================================== */

const recordReimbursementSchema = z.object({
  ...firmScoped,
  memberId: z.string().min(1),
  dependentId: z.string().min(1).or(z.literal("")).optional(),
  categoryId: z.string().min(1),
  submittedDate: dateField,
  totalAmount: amountField.refine((value) => value !== null && value > 0, {
    message: "Montant requis.",
  }),
  /** Percentage. Resolved from the barème when left blank. */
  appliedRate: z.coerce.number().min(0).max(100).optional(),
})

/**
 * Remboursement — the second flow into consumption (§4.7).
 *
 * Priced with the **same `split`** the voucher engine uses, so a participant
 * who pays up front and claims it back is reimbursed exactly what a tiers
 * payant would have covered. Two implementations of that arithmetic would
 * eventually disagree, and the person out of pocket would be the one who
 * noticed.
 */
export const recordReimbursement = firmAction({
  input: recordReimbursementSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => listPath(input.firmSlug, "decaissements"),
  handler: async ({ input, ctx, tx, audit }) => {
    const member = await tx.member.findFirst({
      where: { id: input.memberId, firmId: ctx.firmId },
      select: { id: true, matricule: true, status: true },
    })
    if (!member) throw new ActionError("Participant introuvable.")

    const category = await tx.ipmServiceCategory.findFirst({
      where: { id: input.categoryId, firmId: ctx.firmId },
      select: { id: true },
    })
    if (!category) throw new ActionError("Catégorie introuvable.")

    if (input.appliedRate === undefined) {
      throw new ActionError(
        "Aucun taux fourni et aucun barème résolu : le montant remboursable ne peut pas être calculé.",
        { appliedRate: ["Taux requis."] }
      )
    }

    const rate = Math.round(input.appliedRate * 100) / 10000
    const computed = split(input.totalAmount!, rate)

    const sequence = await nextInSequence(
      tx,
      ctx.firmId,
      "REMB",
      new Date().getFullYear()
    )
    const number = `REMB-${new Date().getFullYear()}-${String(sequence).padStart(5, "0")}`

    const reimbursement = await tx.ipmReimbursement.create({
      data: {
        firmId: ctx.firmId,
        memberId: member.id,
        dependentId: orNull(input.dependentId),
        number,
        submittedDate: toDate(input.submittedDate),
        categoryId: category.id,
        totalAmount: computed.totalAmount,
        insurerShare: computed.insurerShare,
        appliedRate: rate,
        status: "SUBMITTED",
      },
      select: { id: true, number: true },
    })

    await audit({
      action: "RECORD_REIMBURSEMENT",
      entity: "IPM_REIMBURSEMENT",
      entityId: reimbursement.id,
      metadata: {
        number: reimbursement.number,
        matricule: member.matricule,
        totalAmount: computed.totalAmount,
        insurerShare: computed.insurerShare,
      },
    })

    return reimbursement
  },
})

/**
 * Approving a reimbursement is what puts it in the register and against the
 * plafonds — not recording it. A claim under review is not yet a commitment.
 */
export const reviewReimbursement = firmAction({
  input: reviewReimbursementSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => [
    listPath(input.firmSlug, "decaissements"),
    listPath(input.firmSlug, "cotisations"),
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    const reimbursement = await tx.ipmReimbursement.findFirst({
      where: { id: input.reimbursementId, firmId: ctx.firmId },
      select: {
        id: true,
        number: true,
        status: true,
        memberId: true,
        dependentId: true,
        categoryId: true,
        submittedDate: true,
        totalAmount: true,
        insurerShare: true,
      },
    })
    if (!reimbursement) throw new ActionError("Remboursement introuvable.")
    if (["APPROVED", "PAID"].includes(reimbursement.status)) {
      throw new ActionError("Ce remboursement est déjà validé.")
    }
    if (input.decision === "REJECTED" && !input.rejectReason?.trim()) {
      throw new ActionError("Un rejet doit être motivé.", {
        rejectReason: ["Motif requis."],
      })
    }

    await tx.ipmReimbursement.update({
      where: { id: reimbursement.id },
      data: {
        status: input.decision,
        reviewedById: ctx.userId,
        reviewedAt: new Date(),
        rejectReason: orNull(input.rejectReason),
      },
    })

    if (input.decision === "APPROVED") {
      const on = reimbursement.submittedDate

      // Consumption, so the plafonds account for it exactly as they do for a
      // bon — the table was built to take either source.
      await tx.ipmConsumption.create({
        data: {
          firmId: ctx.firmId,
          beneficiaryRef: reimbursement.dependentId
            ? `dependent:${reimbursement.dependentId}`
            : `member:${reimbursement.memberId}`,
          memberId: reimbursement.memberId,
          categoryId: reimbursement.categoryId,
          periodYear: on.getFullYear(),
          periodMonth: on.getMonth() + 1,
          amount: reimbursement.totalAmount,
          insurerShare: reimbursement.insurerShare,
        },
      })

      // And the register, debited at the IPM share (§11 Q9).
      const current = await tx.ipmLedgerEntry.aggregate({
        where: { firmId: ctx.firmId, memberId: reimbursement.memberId },
        _sum: { credit: true, debit: true },
      })
      const before =
        Number(current._sum.credit ?? 0) - Number(current._sum.debit ?? 0)
      const debit = Number(reimbursement.insurerShare)

      await tx.ipmLedgerEntry.create({
        data: {
          firmId: ctx.firmId,
          memberId: reimbursement.memberId,
          periodYear: on.getFullYear(),
          periodMonth: on.getMonth() + 1,
          type: "CONSUMPTION",
          sourceType: "REIMBURSEMENT",
          sourceId: reimbursement.id,
          debit,
          balanceAfter: before - debit,
          note: `Remboursement ${reimbursement.number}`,
          createdById: ctx.userId,
        },
      })

      await tx.member.update({
        where: { id: reimbursement.memberId },
        data: { currentBalance: before - debit, balanceAsOf: new Date() },
      })
    }

    await audit({
      action: "REVIEW_REIMBURSEMENT",
      entity: "IPM_REIMBURSEMENT",
      entityId: reimbursement.id,
      metadata: {
        number: reimbursement.number,
        decision: input.decision,
        reason: input.rejectReason ?? null,
      },
    })

    return { id: reimbursement.id }
  },
})

/* ==========================================================================
 * Bons de décaissement
 * ========================================================================== */

const createDisbursementSchema = z.object({
  ...firmScoped,
  journalCode: z.enum(["B1", "02", "OM"]),
  date: dateField,
  payeeType: z.enum(["PROVIDER", "MEMBER", "SUPPLIER"]),
  payeeId: z.string().min(1).or(z.literal("")).optional(),
  payeeName: z.string().trim().min(2).max(160),
  motif: z.string().trim().min(3, "Motif requis.").max(200),
  paymentMethod: z.enum(["CHEQUE", "TRANSFER", "CASH", "ORANGE_MONEY"]),
  paymentReference: z.string().trim().max(60).or(z.literal("")).optional(),
  /** Provider invoices and reimbursements this disbursement settles. */
  providerInvoiceIds: z.array(z.string()).default([]),
  reimbursementIds: z.array(z.string()).default([]),
})

/**
 * Le noyau d'un bon de décaissement : les pièces, le montant, les lignes.
 *
 * Shared by the two ways a bon comes into being — an operator picking several
 * pieces by hand, and the one-click conversion of a facture that has just been
 * approved — because the two must agree about every rule that matters:
 *
 *   - **only approved pieces are settled.** A bon that could carry an
 *     unchecked invoice would make the contrôle optional;
 *   - **the amount is the sum of what is attached, never typed.** A figure
 *     entered by hand beside a list of invoices is a figure that will
 *     eventually disagree with the list;
 *   - **a piece is attached once.** `disbursementId: null` in the predicate is
 *     what stops the same invoice being paid twice, and it is a predicate
 *     rather than a check afterwards so two concurrent conversions cannot both
 *     pass it.
 *
 * Two implementations of that would drift, and the one that drifted would be
 * the one that pays somebody twice.
 */
async function settleIntoDisbursement(
  tx: Prisma.TransactionClient,
  ctx: FirmContext,
  audit: AuditFn,
  input: {
    journalCode: string
    date: Date
    payeeType: "PROVIDER" | "MEMBER" | "SUPPLIER"
    payeeId: string | null
    payeeName: string
    motif: string
    paymentMethod: "CHEQUE" | "TRANSFER" | "CASH" | "ORANGE_MONEY"
    paymentReference: string | null
    providerInvoiceIds: string[]
    reimbursementIds: string[]
  }
): Promise<{ id: string; number: string; amount: number }> {
  const [invoices, reimbursements] = await Promise.all([
    input.providerInvoiceIds.length
      ? tx.ipmProviderInvoice.findMany({
          where: {
            id: { in: input.providerInvoiceIds },
            firmId: ctx.firmId,
            disbursementId: null,
          },
          select: {
            id: true,
            number: true,
            totalAmount: true,
            status: true,
            provider: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    input.reimbursementIds.length
      ? tx.ipmReimbursement.findMany({
          where: {
            id: { in: input.reimbursementIds },
            firmId: ctx.firmId,
            disbursementId: null,
          },
          select: { id: true, number: true, insurerShare: true, status: true },
        })
      : Promise.resolve([]),
  ])

  if (invoices.length === 0 && reimbursements.length === 0) {
    throw new ActionError(
      "Un bon de décaissement règle au moins une facture ou un remboursement."
    )
  }

  const unapproved = [
    ...invoices.filter((invoice) => invoice.status !== "APPROVED"),
    ...reimbursements.filter((entry) => entry.status !== "APPROVED"),
  ]
  if (unapproved.length > 0) {
    throw new ActionError(
      "Seules des pièces approuvées peuvent être réglées : " +
        unapproved.map((entry) => entry.number).join(", ")
    )
  }

  const amount =
    invoices.reduce((sum, invoice) => sum + Number(invoice.totalAmount), 0) +
    reimbursements.reduce((sum, entry) => sum + Number(entry.insurerShare), 0)

  const sequence = await nextInSequence(
    tx,
    ctx.firmId,
    "DEC",
    input.date.getFullYear()
  )
  const number = String(sequence).padStart(4, "0")

  const disbursement = await tx.ipmDisbursement.create({
    data: {
      firmId: ctx.firmId,
      number,
      date: input.date,
      journalCode: input.journalCode,
      payeeType: input.payeeType,
      payeeId: input.payeeId,
      payeeName: input.payeeName,
      amount,
      motif: input.motif,
      paymentMethod: input.paymentMethod,
      paymentReference: input.paymentReference,
      enteredById: ctx.userId,
      status: "DRAFT",
    },
    select: { id: true, number: true },
  })

  await tx.ipmDisbursementLine.createMany({
    data: [
      ...invoices.map((invoice) => ({
        firmId: ctx.firmId,
        disbursementId: disbursement.id,
        sourceType: "INVOICE",
        sourceId: invoice.id,
        label: `Facture ${invoice.number} — ${invoice.provider.name}`,
        amount: invoice.totalAmount,
      })),
      ...reimbursements.map((entry) => ({
        firmId: ctx.firmId,
        disbursementId: disbursement.id,
        sourceType: "REIMBURSEMENT",
        sourceId: entry.id,
        label: `Remboursement ${entry.number}`,
        amount: entry.insurerShare,
      })),
    ],
  })

  await tx.ipmProviderInvoice.updateMany({
    where: { id: { in: invoices.map((invoice) => invoice.id) } },
    data: { disbursementId: disbursement.id },
  })
  await tx.ipmReimbursement.updateMany({
    where: { id: { in: reimbursements.map((entry) => entry.id) } },
    data: { disbursementId: disbursement.id },
  })

  await audit({
    action: "CREATE_DISBURSEMENT",
    entity: "IPM_DISBURSEMENT",
    entityId: disbursement.id,
    metadata: {
      number: disbursement.number,
      amount,
      invoices: invoices.length,
      reimbursements: reimbursements.length,
    },
  })

  return { id: disbursement.id, number: disbursement.number, amount }
}

/**
 * Le bon de décaissement.
 *
 * Everything on the paper document is derivable, so it is derived: the amount
 * is the sum of the attached sources, never typed.
 */
export const createDisbursement = firmAction({
  input: createDisbursementSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => listPath(input.firmSlug, "decaissements"),
  handler: async ({ input, ctx, tx, audit }) =>
    settleIntoDisbursement(tx, ctx, audit, {
      journalCode: input.journalCode,
      date: toDate(input.date),
      payeeType: input.payeeType,
      payeeId: orNull(input.payeeId),
      payeeName: input.payeeName,
      motif: input.motif,
      paymentMethod: input.paymentMethod,
      paymentReference: orNull(input.paymentReference),
      providerInvoiceIds: input.providerInvoiceIds,
      reimbursementIds: input.reimbursementIds,
    }),
})

/**
 * Apposer un visa.
 *
 * The governance rule, enforced structurally: the action takes **no author**.
 * Whoever is signed in is the signatory, full stop — there is no input field
 * through which one person could record another's approval, which is the only
 * way a visa means anything.
 *
 * VISA RÉCEPTION is different in kind: the payee signs the paper on
 * collection, so what is recorded is the fact and the date, not an approval
 * by a user of this application.
 */
export const visaDisbursement = firmAction({
  input: visaDisbursementSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => listPath(input.firmSlug, "decaissements"),
  handler: async ({ input, ctx, tx, audit }) => {
    const disbursement = await tx.ipmDisbursement.findFirst({
      where: { id: input.disbursementId, firmId: ctx.firmId },
      select: {
        id: true,
        number: true,
        status: true,
        approvedById: true,
        accountingById: true,
        receivedAt: true,
      },
    })
    if (!disbursement) throw new ActionError("Bon de décaissement introuvable.")
    if (disbursement.status === "CANCELLED") {
      throw new ActionError("Ce bon est annulé.")
    }

    const now = new Date()

    if (input.visa === "DIRECTION") {
      if (disbursement.approvedById) {
        throw new ActionError("Le visa direction est déjà apposé.")
      }
      await tx.ipmDisbursement.update({
        where: { id: disbursement.id },
        data: { approvedById: ctx.userId, approvedAt: now, status: "APPROVED" },
      })
    }

    if (input.visa === "COMPTABILITE") {
      if (!disbursement.approvedById) {
        throw new ActionError(
          "Le visa comptabilité vient après le visa direction."
        )
      }
      if (disbursement.accountingById) {
        throw new ActionError("Le visa comptabilité est déjà apposé.")
      }
      await tx.ipmDisbursement.update({
        where: { id: disbursement.id },
        data: {
          accountingById: ctx.userId,
          accountingAt: now,
          status: "POSTED",
        },
      })
    }

    if (input.visa === "RECEPTION") {
      if (!disbursement.accountingById) {
        throw new ActionError("La remise vient après le visa comptabilité.")
      }
      await tx.ipmDisbursement.update({
        where: { id: disbursement.id },
        data: { receivedAt: now, status: "PAID" },
      })

      // Settling the disbursement settles what it covers.
      await tx.ipmProviderInvoice.updateMany({
        where: { disbursementId: disbursement.id },
        data: { status: "PAID" },
      })
      await tx.ipmReimbursement.updateMany({
        where: { disbursementId: disbursement.id },
        data: { status: "PAID" },
      })
    }

    await audit({
      action: `VISA_${input.visa}`,
      entity: "IPM_DISBURSEMENT",
      entityId: disbursement.id,
      metadata: { number: disbursement.number },
    })

    return { id: disbursement.id }
  },
})

/* ==========================================================================
 * Facturation de la consommation — l'IPM édite la facture du prestataire
 * ========================================================================== */

/**
 * La période, bornée à la journée entière.
 *
 * `toDate` puts a form date at noon UTC, which is right for a single date and
 * wrong for the end of a range: a bon settled at 18:00 on the last day of the
 * month would fall outside `lte noon` and be billed the following month, for
 * no reason anybody could ever reconstruct.
 */
function dayRange(from: string, to: string): { from: Date; to: Date } {
  return {
    from: new Date(`${from}T00:00:00.000Z`),
    to: new Date(`${to}T23:59:59.999Z`),
  }
}

type BillableLine = {
  voucherId: string
  voucherNumber: string
  serviceDate: Date
  beneficiaryName: string
  memberMatricule: string
  categoryLabel: string
  totalAmount: number
  insurerShare: number
  memberShare: number
}

/**
 * Les bons facturables chez un prestataire sur une période.
 *
 * Three conditions, and each one is load-bearing:
 *
 *   - **SETTLED**, because an issued bon is a commitment and not a
 *     consumption: it may never be presented at all, and billing for it would
 *     charge the institution for care nobody received;
 *   - **`settledAt` inside the period**, not `issueDate` — a bon issued in
 *     March and honoured in April belongs to April's invoice, which is the
 *     month the provider is claiming for;
 *   - **not already attached to an invoice**, which is what stops a bon being
 *     billed twice. It is a predicate rather than a check afterwards, so two
 *     operators invoicing the same clinic at the same moment cannot both
 *     succeed on the same bons.
 *
 * Read inside the caller's transaction so the preview and the write see the
 * same rows under the same lock.
 */
async function billableVouchers(
  tx: Prisma.TransactionClient,
  firmId: string,
  providerId: string,
  period: { from: Date; to: Date }
): Promise<BillableLine[]> {
  const vouchers = await tx.ipmVoucher.findMany({
    where: {
      firmId,
      providerId,
      status: "SETTLED",
      providerInvoiceId: null,
      settledAt: { gte: period.from, lte: period.to },
    },
    orderBy: [{ settledAt: "asc" }, { number: "asc" }],
    select: {
      id: true,
      number: true,
      settledAt: true,
      issueDate: true,
      beneficiaryName: true,
      totalAmount: true,
      insurerShare: true,
      memberShare: true,
      member: { select: { matricule: true } },
      category: { select: { label: true } },
    },
  })

  return vouchers.map((voucher) => ({
    voucherId: voucher.id,
    voucherNumber: voucher.number,
    serviceDate: voucher.settledAt ?? voucher.issueDate,
    beneficiaryName: voucher.beneficiaryName,
    memberMatricule: voucher.member.matricule,
    categoryLabel: voucher.category.label,
    totalAmount: Number(voucher.totalAmount),
    insurerShare: Number(voucher.insurerShare),
    memberShare: Number(voucher.memberShare),
  }))
}

export type ProviderInvoicePreview = {
  providerName: string
  lines: BillableLine[]
  /** Gross cost of the care, participants' shares included. */
  grossAmount: number
  /** What the institution owes — the invoice's total. */
  insurerShare: number
  /** What participants already paid at the counter. */
  memberShare: number
}

/**
 * Ce que la facture contiendrait, sans rien écrire.
 *
 * The same reader as the write path, for the same reason bon issuance has a
 * pre-flight: an operator choosing a period should see the bons it catches
 * before committing, and a preview computed by different code from the write
 * is a preview that can lie.
 */
export const previewProviderInvoice = firmAction({
  input: previewProviderInvoiceSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  handler: async ({ input, ctx, tx }): Promise<ProviderInvoicePreview> => {
    const provider = await tx.ipmProvider.findFirst({
      where: { id: input.providerId, firmId: ctx.firmId },
      select: { id: true, name: true },
    })
    if (!provider) throw new ActionError("Prestataire introuvable.")

    const lines = await billableVouchers(
      tx,
      ctx.firmId,
      provider.id,
      dayRange(input.periodFrom, input.periodTo)
    )

    const sum = (pick: (line: BillableLine) => number) =>
      lines.reduce((total, line) => total + pick(line), 0)

    return {
      providerName: provider.name,
      lines,
      grossAmount: sum((line) => line.totalAmount),
      insurerShare: sum((line) => line.insurerShare),
      memberShare: sum((line) => line.memberShare),
    }
  },
})

/**
 * Éditer la facture d'un prestataire à partir de la consommation constatée.
 *
 * The inverse of `recordProviderInvoice`, and the reason `origin` exists on
 * the table. There, a provider claims a figure and the institution's job is to
 * find the écart; here the institution states the figure itself, line by line,
 * from bons it has already honoured — so `totalAmount` and `matchedAmount` are
 * equal **by construction** and there is no écart to find.
 *
 * Every line is denormalised onto the invoice at the moment of editing. That
 * is deliberate, and it is the same rule `IpmVoucher` applies to its taux: an
 * invoice is a document sent to a third party, and what they received must not
 * change because a bon was corrected afterwards. `voucherId` stays for the
 * audit trail and goes NULL if the bon is ever deleted, without taking the
 * line with it.
 *
 * The invoice lands **CHECKED, not APPROVED**. The rapprochement is vacuous
 * for a document whose two figures come from one source, and whoever picked
 * the period did look at the lines — but deciding to pay is a separate act by
 * a separate person, and collapsing the two would remove the only control
 * standing between editing an invoice and paying it.
 */
export const generateProviderInvoice = firmAction({
  input: generateProviderInvoiceSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => [
    listPath(input.firmSlug, "decaissements"),
    listPath(input.firmSlug, "factures"),
    listPath(input.firmSlug, "bons"),
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    const provider = await tx.ipmProvider.findFirst({
      where: { id: input.providerId, firmId: ctx.firmId },
      select: { id: true, name: true },
    })
    if (!provider) throw new ActionError("Prestataire introuvable.")

    const period = dayRange(input.periodFrom, input.periodTo)
    const lines = await billableVouchers(tx, ctx.firmId, provider.id, period)

    if (lines.length === 0) {
      throw new ActionError(
        "Aucun bon réglé et non encore facturé pour ce prestataire sur cette période."
      )
    }

    const insurerShare = lines.reduce((sum, line) => sum + line.insurerShare, 0)

    // Financial documents restart each exercice — see `nextInSequence`.
    const year = period.to.getFullYear()
    const sequence = await nextInSequence(tx, ctx.firmId, "FACT", year)
    const number = `FACT-${year}-${String(sequence).padStart(5, "0")}`

    const invoice = await tx.ipmProviderInvoice.create({
      data: {
        firmId: ctx.firmId,
        providerId: provider.id,
        number,
        origin: "GENERATED",
        receivedDate: new Date(),
        periodFrom: period.from,
        periodTo: period.to,
        totalAmount: insurerShare,
        // Equal by construction. Stored rather than derived so the écart
        // column means the same thing on every row of the list.
        matchedAmount: insurerShare,
        status: "CHECKED",
        checkedById: ctx.userId,
        checkedAt: new Date(),
      },
      select: { id: true, number: true },
    })

    await tx.ipmProviderInvoiceLine.createMany({
      data: lines.map((line) => ({
        firmId: ctx.firmId,
        invoiceId: invoice.id,
        voucherId: line.voucherId,
        voucherNumber: line.voucherNumber,
        serviceDate: line.serviceDate,
        beneficiaryName: line.beneficiaryName,
        memberMatricule: line.memberMatricule,
        categoryLabel: line.categoryLabel,
        totalAmount: line.totalAmount,
        insurerShare: line.insurerShare,
        memberShare: line.memberShare,
      })),
    })

    // INVOICED, and pointing at this invoice: the same predicate that selected
    // them now excludes them, so a second run over the same period bills
    // nothing rather than billing it again.
    await tx.ipmVoucher.updateMany({
      where: { id: { in: lines.map((line) => line.voucherId) } },
      data: { status: "INVOICED", providerInvoiceId: invoice.id },
    })

    await audit({
      action: "GENERATE_PROVIDER_INVOICE",
      entity: "IPM_PROVIDER_INVOICE",
      entityId: invoice.id,
      metadata: {
        provider: provider.name,
        number: invoice.number,
        periodFrom: input.periodFrom,
        periodTo: input.periodTo,
        vouchers: lines.length,
        amount: insurerShare,
      },
    })

    return {
      id: invoice.id,
      number: invoice.number,
      amount: insurerShare,
      vouchers: lines.length,
    }
  },
})

/**
 * Transformer une facture approuvée en bon de décaissement.
 *
 * One act rather than three: the operator picks the journal, the mode and the
 * date, and everything else is read off the facture. The payee is its
 * prestataire, the amount is its total, the motif names it. Retyping any of
 * those is how a bon ends up settling a different figure from the invoice it
 * cites.
 *
 * It goes through the same `settleIntoDisbursement` as the manual path, so it
 * inherits the same refusals — an invoice that is not APPROVED, or is already
 * attached to another bon, is refused here exactly as it is there.
 */
export const createDisbursementFromInvoice = firmAction({
  input: disbursementFromInvoiceSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => [
    listPath(input.firmSlug, "decaissements"),
    listPath(input.firmSlug, "factures"),
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    const invoice = await tx.ipmProviderInvoice.findFirst({
      where: { id: input.invoiceId, firmId: ctx.firmId },
      select: {
        id: true,
        number: true,
        status: true,
        periodFrom: true,
        periodTo: true,
        disbursementId: true,
        provider: { select: { id: true, name: true } },
      },
    })
    if (!invoice) throw new ActionError("Facture introuvable.")
    if (invoice.disbursementId) {
      throw new ActionError(
        "Cette facture est déjà rattachée à un bon de décaissement."
      )
    }

    const from = invoice.periodFrom.toLocaleDateString("fr-FR")
    const to = invoice.periodTo.toLocaleDateString("fr-FR")

    return settleIntoDisbursement(tx, ctx, audit, {
      journalCode: input.journalCode,
      date: toDate(input.date),
      payeeType: "PROVIDER",
      payeeId: invoice.provider.id,
      payeeName: invoice.provider.name,
      motif: `Règlement facture ${invoice.number} — prestations du ${from} au ${to}`,
      paymentMethod: input.paymentMethod,
      paymentReference: orNull(input.paymentReference),
      providerInvoiceIds: [invoice.id],
      reimbursementIds: [],
    })
  },
})
