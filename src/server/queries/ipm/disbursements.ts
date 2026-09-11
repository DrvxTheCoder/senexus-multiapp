import "server-only"

import { db } from "@/lib/db"
import type { FirmContext } from "@/server/auth/require-firm-access"

/**
 * Factures prestataires, remboursements, décaissements — plan §4.8 et §4.9.
 *
 * The figure this module exists to surface is the **écart**: what a provider
 * claims against the sum of the bons actually issued to them. WebLamps cannot
 * compute it, which is why nobody checks invoices today, and it is the only
 * reason to keep both numbers rather than deriving one from the other.
 */

export type ProviderInvoiceRow = {
  id: string
  number: string
  providerName: string
  receivedDate: Date
  periodFrom: Date
  periodTo: Date
  totalAmount: number
  matchedAmount: number
  /** Claimed minus matched. Positive means the provider claims more. */
  variance: number
  status: string
  disbursementNumber: string | null
}

export async function listProviderInvoices(
  ctx: FirmContext
): Promise<ProviderInvoiceRow[]> {
  const rows = await db.ipmProviderInvoice.findMany({
    where: { firmId: ctx.firmId },
    orderBy: [{ receivedDate: "desc" }, { number: "desc" }],
    take: 200,
    select: {
      id: true,
      number: true,
      receivedDate: true,
      periodFrom: true,
      periodTo: true,
      totalAmount: true,
      matchedAmount: true,
      status: true,
      provider: { select: { name: true } },
      disbursement: { select: { number: true } },
    },
  })

  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    providerName: row.provider.name,
    receivedDate: row.receivedDate,
    periodFrom: row.periodFrom,
    periodTo: row.periodTo,
    totalAmount: Number(row.totalAmount),
    matchedAmount: Number(row.matchedAmount),
    variance: Number(row.totalAmount) - Number(row.matchedAmount),
    status: row.status,
    disbursementNumber: row.disbursement?.number ?? null,
  }))
}

export type ReimbursementRow = {
  id: string
  number: string
  memberName: string
  memberMatricule: string
  categoryLabel: string
  submittedDate: Date
  totalAmount: number
  insurerShare: number
  status: string
  disbursementNumber: string | null
}

export async function listReimbursements(
  ctx: FirmContext
): Promise<ReimbursementRow[]> {
  const rows = await db.ipmReimbursement.findMany({
    where: { firmId: ctx.firmId },
    orderBy: [{ submittedDate: "desc" }, { number: "desc" }],
    take: 200,
    select: {
      id: true,
      number: true,
      submittedDate: true,
      totalAmount: true,
      insurerShare: true,
      status: true,
      member: {
        select: {
          matricule: true,
          person: { select: { firstName: true, lastName: true } },
        },
      },
      category: { select: { label: true } },
      disbursement: { select: { number: true } },
    },
  })

  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    memberName: `${row.member.person.lastName.toUpperCase()} ${row.member.person.firstName}`,
    memberMatricule: row.member.matricule,
    categoryLabel: row.category.label,
    submittedDate: row.submittedDate,
    totalAmount: Number(row.totalAmount),
    insurerShare: Number(row.insurerShare),
    status: row.status,
    disbursementNumber: row.disbursement?.number ?? null,
  }))
}

export type DisbursementRow = {
  id: string
  number: string
  date: Date
  journalCode: string
  payeeType: string
  payeeName: string
  amount: number
  motif: string
  paymentMethod: string
  paymentReference: string | null
  status: string
  approvedByName: string | null
  approvedAt: Date | null
  accountingByName: string | null
  accountingAt: Date | null
  receivedAt: Date | null
  lineCount: number
}

export async function listDisbursements(
  ctx: FirmContext
): Promise<DisbursementRow[]> {
  const rows = await db.ipmDisbursement.findMany({
    where: { firmId: ctx.firmId },
    orderBy: [{ date: "desc" }, { number: "desc" }],
    take: 200,
    select: {
      id: true,
      number: true,
      date: true,
      journalCode: true,
      payeeType: true,
      payeeName: true,
      amount: true,
      motif: true,
      paymentMethod: true,
      paymentReference: true,
      status: true,
      approvedAt: true,
      accountingAt: true,
      receivedAt: true,
      approvedBy: { select: { name: true, email: true } },
      accountingBy: { select: { name: true, email: true } },
      _count: { select: { lines: true } },
    },
  })

  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    date: row.date,
    journalCode: row.journalCode,
    payeeType: row.payeeType,
    payeeName: row.payeeName,
    amount: Number(row.amount),
    motif: row.motif,
    paymentMethod: row.paymentMethod,
    paymentReference: row.paymentReference,
    status: row.status,
    approvedByName: row.approvedBy?.name ?? row.approvedBy?.email ?? null,
    approvedAt: row.approvedAt,
    accountingByName: row.accountingBy?.name ?? row.accountingBy?.email ?? null,
    accountingAt: row.accountingAt,
    receivedAt: row.receivedAt,
    lineCount: row._count.lines,
  }))
}

export type DisbursementSummary = {
  invoicesToCheck: number
  reimbursementsToReview: number
  awaitingApproval: number
  approvedUnpaid: number
  /** Total variance across invoices still under review. */
  openVariance: number
}

export async function disbursementSummary(
  ctx: FirmContext
): Promise<DisbursementSummary> {
  const [invoices, reimbursements, drafts, approved, variance] =
    await Promise.all([
      db.ipmProviderInvoice.count({
        where: { firmId: ctx.firmId, status: { in: ["RECEIVED", "CHECKED"] } },
      }),
      db.ipmReimbursement.count({
        where: { firmId: ctx.firmId, status: { in: ["SUBMITTED", "REVIEWING"] } },
      }),
      db.ipmDisbursement.count({
        where: { firmId: ctx.firmId, status: "DRAFT" },
      }),
      db.ipmDisbursement.aggregate({
        where: { firmId: ctx.firmId, status: { in: ["APPROVED", "POSTED"] } },
        _sum: { amount: true },
      }),
      db.ipmProviderInvoice.findMany({
        where: { firmId: ctx.firmId, status: { in: ["RECEIVED", "CHECKED"] } },
        select: { totalAmount: true, matchedAmount: true },
      }),
    ])

  return {
    invoicesToCheck: invoices,
    reimbursementsToReview: reimbursements,
    awaitingApproval: drafts,
    approvedUnpaid: Number(approved._sum.amount ?? 0),
    openVariance: variance.reduce(
      (sum, row) => sum + Number(row.totalAmount) - Number(row.matchedAmount),
      0
    ),
  }
}

/* ==========================================================================
 * Export comptable — §2, §4.9
 * ========================================================================== */

export type AccountingRow = {
  date: Date
  journalCode: string
  reference: string
  account: string
  label: string
  debit: number
  credit: number
}

/**
 * Lignes d'écriture, sur les comptes existants.
 *
 * The module produces an export and **passes no entry**: §2 excludes
 * double-entry accounting explicitly — no journal, no chart of accounts, no
 * bank reconciliation — and this is where that line is drawn. What comes back
 * is rows a bookkeeper imports, on the SYSCOHADA codes the institution
 * already uses.
 *
 * Each disbursement produces the pair a payment always produces: the expense
 * or supplier account debited, the bank or cash account credited. The journal
 * code on the disbursement decides which.
 */
const JOURNAL_ACCOUNTS: Record<string, string> = {
  // Banque
  B1: "521100",
  // Caisse
  "02": "571000",
  // Orange Money — treated as a cash equivalent until the institution says
  // otherwise. Named rather than guessed silently.
  OM: "571000",
}

export async function accountingExport(
  ctx: FirmContext,
  range: { from: Date; to: Date }
): Promise<AccountingRow[]> {
  const disbursements = await db.ipmDisbursement.findMany({
    where: {
      firmId: ctx.firmId,
      status: { in: ["POSTED", "PAID"] },
      date: { gte: range.from, lte: range.to },
    },
    orderBy: [{ date: "asc" }, { number: "asc" }],
    select: {
      number: true,
      date: true,
      journalCode: true,
      payeeName: true,
      payeeType: true,
      payeeId: true,
      amount: true,
      motif: true,
    },
  })

  const providerAccounts = new Map(
    (
      await db.ipmProvider.findMany({
        where: { firmId: ctx.firmId },
        select: { id: true, accountCode: true },
      })
    ).map((provider) => [provider.id, provider.accountCode])
  )

  const rows: AccountingRow[] = []

  for (const entry of disbursements) {
    const amount = Number(entry.amount)
    const cashAccount = JOURNAL_ACCOUNTS[entry.journalCode] ?? "521100"

    // Supplier account when we know it; 602 prestations otherwise. Never a
    // silent default that hides a missing account code — the label says which
    // was used.
    const counterpart =
      entry.payeeType === "PROVIDER" && entry.payeeId
        ? (providerAccounts.get(entry.payeeId) ?? null)
        : null

    rows.push({
      date: entry.date,
      journalCode: entry.journalCode,
      reference: entry.number,
      account: counterpart ?? "602000",
      label: counterpart
        ? `${entry.payeeName} — ${entry.motif}`
        : `${entry.payeeName} — ${entry.motif} (compte fournisseur non renseigné)`,
      debit: amount,
      credit: 0,
    })

    rows.push({
      date: entry.date,
      journalCode: entry.journalCode,
      reference: entry.number,
      account: cashAccount,
      label: `Règlement ${entry.number}`,
      debit: 0,
      credit: amount,
    })
  }

  return rows
}

export function toCsv(rows: AccountingRow[]): string {
  const header = [
    "Date",
    "Journal",
    "Référence",
    "Compte",
    "Libellé",
    "Débit",
    "Crédit",
  ]

  const escape = (value: string) =>
    /[";\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

  const lines = rows.map((row) =>
    [
      row.date.toISOString().slice(0, 10),
      row.journalCode,
      row.reference,
      row.account,
      escape(row.label),
      row.debit ? String(row.debit) : "",
      row.credit ? String(row.credit) : "",
    ].join(";")
  )

  // Semicolons and a BOM: this is opened in Excel with a French locale, where
  // a comma-separated file lands in one column.
  return `﻿${[header.join(";"), ...lines].join("\r\n")}\r\n`
}
