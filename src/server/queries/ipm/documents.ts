import "server-only"

import { db } from "@/lib/db"
import type { FirmContext } from "@/server/auth/require-firm-access"
import { RELATION_LABELS, ageOn } from "@/server/domain/ipm/coverage"

/**
 * Ce qu'il faut pour imprimer un document, en une requête.
 *
 * Separate from the list queries on purpose. A row in a table needs eight
 * fields; a printed bon needs the provider's address, the employer's raison
 * sociale, the beneficiary's age on the day it was issued and the firm's
 * letterhead — none of which any screen asks for. Bolting them onto
 * `getVoucher` would make every list page pay for the printer.
 *
 * Every reader here is **firm-scoped in the `where`**, never checked
 * afterwards: an id from another tenant does not resolve at all, so the answer
 * is "introuvable" and the response cannot be used to discover which ids are
 * real. Same rule as everywhere else in this layer.
 */

export type DocumentFirm = {
  name: string
  letterhead: string | null
  stamp: string | null
  themeColor: string | null
}

async function documentFirm(firmId: string): Promise<DocumentFirm> {
  const firm = await db.firm.findUniqueOrThrow({
    where: { id: firmId },
    select: { name: true, letterhead: true, stamp: true, themeColor: true },
  })
  return firm
}

/** `NOM Prénom`, the form every one of these documents prints a person in. */
function fullName(person: { firstName: string; lastName: string }): string {
  return `${person.lastName.toUpperCase()} ${person.firstName}`.trim()
}

/** A user's display name, falling back to the address they sign in with. */
function actor(
  user: { name: string | null; email: string } | null | undefined
): string | null {
  return user ? (user.name?.trim() || user.email) : null
}

/* ==========================================================================
 * Bons
 * ========================================================================== */

export type VoucherDocument = {
  firm: DocumentFirm
  number: string
  type: "PHARMACY" | "OPTICAL" | "GUARANTEE" | "HOSPITALIZATION"
  status: string
  issueDate: Date
  expiryDate: Date
  createdAt: Date
  settledAt: Date | null
  cancelledAt: Date | null
  cancelReason: string | null

  member: {
    name: string
    matricule: string
    /** The WebLamps `017-01714`, when the row carries one. */
    legacyCode: string | null
    employerName: string
    employerCode: string | null
  }
  beneficiary: {
    name: string
    /** `Participant`, `Conjoint`, `Enfant`… — what the box on the form says. */
    kind: string
    /** Age on the day the bon was issued, not today. */
    age: number | null
  }
  provider: {
    name: string
    code: string | null
    address: string | null
    phone: string | null
    specialty: string | null
    /** Délai de règlement de la convention. Printed in the guarantee clause. */
    paymentTermDays: number
  }
  service: { category: string; type: string }

  totalAmount: number
  insurerShare: number
  memberShare: number
  appliedRate: number

  lines: {
    label: string
    quantity: number
    unitPrice: number
    amount: number
    code: string | null
  }[]

  qrToken: string
  issuedBy: string | null
}

export async function voucherDocument(
  ctx: FirmContext,
  voucherId: string
): Promise<VoucherDocument | null> {
  const voucher = await db.ipmVoucher.findFirst({
    where: { id: voucherId, firmId: ctx.firmId },
    select: {
      number: true,
      type: true,
      status: true,
      issueDate: true,
      expiryDate: true,
      createdAt: true,
      settledAt: true,
      cancelledAt: true,
      cancelReason: true,
      totalAmount: true,
      insurerShare: true,
      memberShare: true,
      appliedRate: true,
      qrToken: true,
      dependentId: true,
      issuedBy: { select: { name: true, email: true } },
      member: {
        select: {
          matricule: true,
          legacyCode: true,
          person: { select: { firstName: true, lastName: true, birthDate: true } },
          employer: {
            select: {
              legacyEmployerCode: true,
              legacyCode: true,
              organization: { select: { name: true } },
            },
          },
        },
      },
      dependent: {
        select: {
          relation: true,
          person: { select: { firstName: true, lastName: true, birthDate: true } },
        },
      },
      provider: {
        select: {
          name: true,
          legacyCode: true,
          address: true,
          phone: true,
          paymentTermDays: true,
          specialty: { select: { label: true } },
        },
      },
      category: { select: { label: true } },
      serviceType: { select: { label: true } },
      lines: {
        orderBy: { createdAt: "asc" },
        select: {
          label: true,
          quantity: true,
          unitPrice: true,
          amount: true,
          medicalAct: { select: { code: true } },
        },
      },
    },
  })

  if (!voucher) return null

  const person = voucher.dependent?.person ?? voucher.member.person
  const birthDate = person.birthDate

  return {
    firm: await documentFirm(ctx.firmId),
    number: voucher.number,
    type: voucher.type,
    status: voucher.status,
    issueDate: voucher.issueDate,
    expiryDate: voucher.expiryDate,
    createdAt: voucher.createdAt,
    settledAt: voucher.settledAt,
    cancelledAt: voucher.cancelledAt,
    cancelReason: voucher.cancelReason,

    member: {
      name: fullName(voucher.member.person),
      matricule: voucher.member.matricule,
      legacyCode: voucher.member.legacyCode,
      employerName: voucher.member.employer.organization.name,
      employerCode:
        voucher.member.employer.legacyEmployerCode ??
        voucher.member.employer.legacyCode,
    },
    beneficiary: {
      name: fullName(person),
      kind: voucher.dependent
        ? (RELATION_LABELS[voucher.dependent.relation] ??
          voucher.dependent.relation)
        : "Participant",
      // On the issue date, not today: the document states a fact about the day
      // it was written, and a bon printed again two years later must not claim
      // the child was older at the counter than they were.
      age: birthDate ? ageOn(birthDate, voucher.issueDate) : null,
    },
    provider: {
      name: voucher.provider.name,
      code: voucher.provider.legacyCode,
      address: voucher.provider.address,
      phone: voucher.provider.phone,
      specialty: voucher.provider.specialty?.label ?? null,
      paymentTermDays: voucher.provider.paymentTermDays,
    },
    service: {
      category: voucher.category.label,
      type: voucher.serviceType.label,
    },

    totalAmount: Number(voucher.totalAmount),
    insurerShare: Number(voucher.insurerShare),
    memberShare: Number(voucher.memberShare),
    appliedRate: Number(voucher.appliedRate),

    lines: voucher.lines.map((line) => ({
      label: line.label,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPrice),
      amount: Number(line.amount),
      code: line.medicalAct?.code ?? null,
    })),

    qrToken: voucher.qrToken,
    issuedBy: actor(voucher.issuedBy),
  }
}

/* ==========================================================================
 * Factures prestataires
 * ========================================================================== */

export type ProviderInvoiceDocument = {
  firm: DocumentFirm
  id: string
  number: string
  origin: "RECEIVED" | "GENERATED"
  status: string
  receivedDate: Date
  periodFrom: Date
  periodTo: Date
  createdAt: Date

  provider: {
    name: string
    code: string | null
    address: string | null
    phone: string | null
    accountCode: string | null
    bankName: string | null
    bankAccount: string | null
    paymentTermDays: number
  }

  totalAmount: number
  matchedAmount: number
  /** Claimed minus matched. Zero, by construction, on a generated invoice. */
  variance: number

  lines: {
    voucherNumber: string
    serviceDate: Date
    beneficiaryName: string
    memberMatricule: string
    categoryLabel: string
    totalAmount: number
    insurerShare: number
    memberShare: number
  }[]

  checkedBy: string | null
  checkedAt: Date | null
  rejectReason: string | null
  disbursementNumber: string | null
}

export async function providerInvoiceDocument(
  ctx: FirmContext,
  invoiceId: string
): Promise<ProviderInvoiceDocument | null> {
  const invoice = await db.ipmProviderInvoice.findFirst({
    where: { id: invoiceId, firmId: ctx.firmId },
    select: {
      id: true,
      number: true,
      origin: true,
      status: true,
      receivedDate: true,
      periodFrom: true,
      periodTo: true,
      createdAt: true,
      totalAmount: true,
      matchedAmount: true,
      checkedAt: true,
      rejectReason: true,
      checkedBy: { select: { name: true, email: true } },
      disbursement: { select: { number: true } },
      provider: {
        select: {
          name: true,
          legacyCode: true,
          address: true,
          phone: true,
          accountCode: true,
          bankName: true,
          bankAccount: true,
          paymentTermDays: true,
        },
      },
      lines: {
        orderBy: [{ serviceDate: "asc" }, { voucherNumber: "asc" }],
        select: {
          voucherNumber: true,
          serviceDate: true,
          beneficiaryName: true,
          memberMatricule: true,
          categoryLabel: true,
          totalAmount: true,
          insurerShare: true,
          memberShare: true,
        },
      },
    },
  })

  if (!invoice) return null

  return {
    firm: await documentFirm(ctx.firmId),
    id: invoice.id,
    number: invoice.number,
    origin: invoice.origin,
    status: invoice.status,
    receivedDate: invoice.receivedDate,
    periodFrom: invoice.periodFrom,
    periodTo: invoice.periodTo,
    createdAt: invoice.createdAt,
    provider: {
      name: invoice.provider.name,
      code: invoice.provider.legacyCode,
      address: invoice.provider.address,
      phone: invoice.provider.phone,
      accountCode: invoice.provider.accountCode,
      bankName: invoice.provider.bankName,
      bankAccount: invoice.provider.bankAccount,
      paymentTermDays: invoice.provider.paymentTermDays,
    },
    totalAmount: Number(invoice.totalAmount),
    matchedAmount: Number(invoice.matchedAmount),
    variance: Number(invoice.totalAmount) - Number(invoice.matchedAmount),
    lines: invoice.lines.map((line) => ({
      voucherNumber: line.voucherNumber,
      serviceDate: line.serviceDate,
      beneficiaryName: line.beneficiaryName,
      memberMatricule: line.memberMatricule,
      categoryLabel: line.categoryLabel,
      totalAmount: Number(line.totalAmount),
      insurerShare: Number(line.insurerShare),
      memberShare: Number(line.memberShare),
    })),
    checkedBy: actor(invoice.checkedBy),
    checkedAt: invoice.checkedAt,
    rejectReason: invoice.rejectReason,
    disbursementNumber: invoice.disbursement?.number ?? null,
  }
}

/* ==========================================================================
 * Bons de décaissement
 * ========================================================================== */

export type DisbursementDocument = {
  firm: DocumentFirm
  id: string
  number: string
  date: Date
  createdAt: Date
  journalCode: string
  status: string

  payeeType: string
  payeeName: string
  amount: number
  motif: string
  paymentMethod: string
  paymentReference: string | null

  enteredBy: { name: string | null; signature: string | null } | null
  /** VISA DIRECTION. */
  approvedBy: { name: string | null; signature: string | null } | null
  approvedAt: Date | null
  /** VISA COMPTABILITÉ. */
  accountingBy: { name: string | null; signature: string | null } | null
  accountingAt: Date | null
  /** VISA RÉCEPTION — the payee signs the paper; only the date is recorded. */
  receivedAt: Date | null

  lines: { label: string; amount: number; sourceType: string }[]

  /**
   * The invoices this bon settles, with their own lines.
   *
   * Carried in full because a generated invoice is printed **as an annexe to
   * this document**, not merely referenced by number — see the template. An
   * invoice received on paper has no lines here, and is listed rather than
   * reproduced.
   */
  invoices: ProviderInvoiceDocument[]
  reimbursements: {
    number: string
    memberName: string
    memberMatricule: string
    submittedDate: Date
    insurerShare: number
  }[]
}

export async function disbursementDocument(
  ctx: FirmContext,
  disbursementId: string
): Promise<DisbursementDocument | null> {
  const disbursement = await db.ipmDisbursement.findFirst({
    where: { id: disbursementId, firmId: ctx.firmId },
    select: {
      id: true,
      number: true,
      date: true,
      createdAt: true,
      journalCode: true,
      status: true,
      payeeType: true,
      payeeName: true,
      amount: true,
      motif: true,
      paymentMethod: true,
      paymentReference: true,
      approvedAt: true,
      accountingAt: true,
      receivedAt: true,
      enteredBy: { select: { name: true, email: true, signatureUrl: true } },
      approvedBy: { select: { name: true, email: true, signatureUrl: true } },
      accountingBy: { select: { name: true, email: true, signatureUrl: true } },
      lines: {
        orderBy: { createdAt: "asc" },
        select: { label: true, amount: true, sourceType: true },
      },
      providerInvoices: { select: { id: true } },
      reimbursements: {
        orderBy: { number: "asc" },
        select: {
          number: true,
          submittedDate: true,
          insurerShare: true,
          member: {
            select: {
              matricule: true,
              person: { select: { firstName: true, lastName: true } },
            },
          },
        },
      },
    },
  })

  if (!disbursement) return null

  // Sequential rather than parallel: a bon settles one or two invoices in
  // practice, and each of these is itself several joins. Fanning them out
  // would buy nothing and could open a dozen connections on a bon that
  // happens to cover a whole month.
  const invoices: ProviderInvoiceDocument[] = []
  for (const attached of disbursement.providerInvoices) {
    const document = await providerInvoiceDocument(ctx, attached.id)
    if (document) invoices.push(document)
  }

  const signatory = (
    user:
      | { name: string | null; email: string; signatureUrl: string | null }
      | null
  ) => (user ? { name: actor(user), signature: user.signatureUrl } : null)

  return {
    firm: await documentFirm(ctx.firmId),
    id: disbursement.id,
    number: disbursement.number,
    date: disbursement.date,
    createdAt: disbursement.createdAt,
    journalCode: disbursement.journalCode,
    status: disbursement.status,
    payeeType: disbursement.payeeType,
    payeeName: disbursement.payeeName,
    amount: Number(disbursement.amount),
    motif: disbursement.motif,
    paymentMethod: disbursement.paymentMethod,
    paymentReference: disbursement.paymentReference,
    enteredBy: signatory(disbursement.enteredBy),
    approvedBy: signatory(disbursement.approvedBy),
    approvedAt: disbursement.approvedAt,
    accountingBy: signatory(disbursement.accountingBy),
    accountingAt: disbursement.accountingAt,
    receivedAt: disbursement.receivedAt,
    lines: disbursement.lines.map((line) => ({
      label: line.label,
      amount: Number(line.amount),
      sourceType: line.sourceType,
    })),
    invoices,
    reimbursements: disbursement.reimbursements.map((entry) => ({
      number: entry.number,
      memberName: fullName(entry.member.person),
      memberMatricule: entry.member.matricule,
      submittedDate: entry.submittedDate,
      insurerShare: Number(entry.insurerShare),
    })),
  }
}

/* ==========================================================================
 * Consommation d'un prestataire — la matière d'une facture éditée
 * ========================================================================== */

export type ProviderConsumptionLine = {
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

export type ProviderConsumption = {
  providerId: string
  providerName: string
  from: Date
  to: Date
  lines: ProviderConsumptionLine[]
  totalAmount: number
  insurerShare: number
  memberShare: number
}

/**
 * La consommation constatée chez un prestataire sur une période.
 *
 * The bons that were actually **settled** there — presented, honoured, and not
 * yet attached to any invoice. Those three conditions are the whole
 * specification:
 *
 *   - *settled*, because an issued bon is a commitment, not a consumption: it
 *     may never be presented, and invoicing for it would bill the institution
 *     for care nobody received;
 *   - *in the period*, by `settledAt` rather than `issueDate` — a bon issued
 *     in March and honoured in April belongs to April's invoice, which is the
 *     month the provider is claiming for;
 *   - *not already invoiced*, which is what stops the same bon being billed
 *     twice. The status transition to INVOICED is what enforces it afterwards;
 *     this predicate is what makes the list offered to the operator correct
 *     in the first place.
 *
 * Returned as facts, priced but undecided — the action builds the invoice.
 */
export async function providerConsumption(
  ctx: FirmContext,
  input: { providerId: string; from: Date; to: Date }
): Promise<ProviderConsumption | null> {
  const provider = await db.ipmProvider.findFirst({
    where: { id: input.providerId, firmId: ctx.firmId },
    select: { id: true, name: true },
  })
  if (!provider) return null

  const vouchers = await db.ipmVoucher.findMany({
    where: {
      firmId: ctx.firmId,
      providerId: provider.id,
      status: "SETTLED",
      providerInvoiceId: null,
      settledAt: { gte: input.from, lte: input.to },
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

  const lines: ProviderConsumptionLine[] = vouchers.map((voucher) => ({
    voucherId: voucher.id,
    voucherNumber: voucher.number,
    // `settledAt` is non-null by the predicate above; the fallback is there so
    // the type is honest rather than asserted.
    serviceDate: voucher.settledAt ?? voucher.issueDate,
    beneficiaryName: voucher.beneficiaryName,
    memberMatricule: voucher.member.matricule,
    categoryLabel: voucher.category.label,
    totalAmount: Number(voucher.totalAmount),
    insurerShare: Number(voucher.insurerShare),
    memberShare: Number(voucher.memberShare),
  }))

  const sum = (pick: (line: ProviderConsumptionLine) => number) =>
    lines.reduce((total, line) => total + pick(line), 0)

  return {
    providerId: provider.id,
    providerName: provider.name,
    from: input.from,
    to: input.to,
    lines,
    totalAmount: sum((line) => line.totalAmount),
    insurerShare: sum((line) => line.insurerShare),
    memberShare: sum((line) => line.memberShare),
  }
}
