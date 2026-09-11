"use server"

import type { Prisma } from "@prisma/client"
import { z } from "zod"

import { amountField, dateField, toDate } from "@/lib/forms/hr-schemas"
import { ActionError, firmAction } from "@/server/actions/define-action"
import {
  balanceOf,
  consumptionDebit,
  DEFAULT_CONSUMPTION_BASIS,
  reaffiliationEntries,
  type LedgerType,
} from "@/server/domain/ipm/ledger"
import { nextInSequence } from "@/server/domain/ipm/sequence"

/**
 * Registre et facturation — the write layer.
 *
 * Every entry goes through `post`, which is the only function in the codebase
 * that inserts into the register. That is deliberate: `balanceAfter` and the
 * cached `Member.currentBalance` are derived values, and letting two call
 * sites maintain them is how they diverge. One door, and the door does the
 * arithmetic.
 *
 * Nothing updates or deletes an entry. A correction is an ADJUSTMENT or a
 * REVERSAL (§4.8bis), so the register can be read as what actually happened
 * rather than as what somebody last decided it should look like.
 */

const IPM_MODULE = "ipm"
const firmScoped = { firmSlug: z.string().min(1) }

function listPath(firmSlug: string, ...rest: string[]): string {
  return [`/${firmSlug}/ipm`, ...rest].join("/")
}

type Tx = Prisma.TransactionClient

/**
 * Posts one entry and advances the derived values.
 *
 * Reads the current balance from the register itself rather than from the
 * cache, so a stale cache cannot propagate into the next `balanceAfter`.
 */
async function post(
  tx: Tx,
  args: {
    firmId: string
    memberId: string
    periodYear: number
    periodMonth: number
    type: LedgerType
    sourceType: "OPENING" | "INVOICE" | "VOUCHER" | "REIMBURSEMENT" | "MANUAL"
    sourceId?: string | null
    credit?: number
    debit?: number
    note?: string | null
    createdById?: string | null
  }
): Promise<{ id: string; balanceAfter: number }> {
  const credit = args.credit ?? 0
  const debit = args.debit ?? 0

  if (credit > 0 && debit > 0) {
    throw new ActionError(
      "Une écriture porte un crédit ou un débit, jamais les deux."
    )
  }

  const current = await tx.ipmLedgerEntry.aggregate({
    where: { firmId: args.firmId, memberId: args.memberId },
    _sum: { credit: true, debit: true },
  })
  const balanceBefore =
    Number(current._sum.credit ?? 0) - Number(current._sum.debit ?? 0)
  const balanceAfter = balanceBefore + credit - debit

  const entry = await tx.ipmLedgerEntry.create({
    data: {
      firmId: args.firmId,
      memberId: args.memberId,
      periodYear: args.periodYear,
      periodMonth: args.periodMonth,
      type: args.type,
      sourceType: args.sourceType,
      sourceId: args.sourceId ?? null,
      credit,
      debit,
      balanceAfter,
      note: args.note ?? null,
      createdById: args.createdById ?? null,
    },
    select: { id: true },
  })

  await tx.member.update({
    where: { id: args.memberId },
    data: { currentBalance: balanceAfter, balanceAsOf: new Date() },
  })

  return { id: entry.id, balanceAfter }
}

/* ==========================================================================
 * Solde d'ouverture — §11 Q11
 * ========================================================================== */

const openLedgerSchema = z.object({
  ...firmScoped,
  memberId: z.string().min(1),
  /** Signed: a participant may open in debt. */
  amount: z.coerce.number().int().min(-99_999_999).max(99_999_999),
  asOf: dateField,
  note: z.string().trim().max(200).or(z.literal("")).optional(),
})

/**
 * Ouverture du registre.
 *
 * The figure is **supplied**, never derived. §11 Q11 — whether it comes from
 * replaying the WebLamps history or from a cut-off validated by the direction
 * — is unanswered, and guessing it would make every balance wrong from day one
 * with nothing to show it (§9). So the action takes a number, records who
 * entered it and when, and refuses to do it twice.
 */
export const openLedger = firmAction({
  input: openLedgerSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => [
    listPath(input.firmSlug, "cotisations"),
    listPath(input.firmSlug, "participants", input.memberId),
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    const member = await tx.member.findFirst({
      where: { id: input.memberId, firmId: ctx.firmId },
      select: { id: true, matricule: true },
    })
    if (!member) throw new ActionError("Participant introuvable.")

    const existing = await tx.ipmLedgerEntry.findFirst({
      where: { firmId: ctx.firmId, memberId: member.id, type: "OPENING" },
      select: { id: true },
    })
    if (existing) {
      throw new ActionError(
        "Le registre de ce participant est déjà ouvert. Passez une écriture de régularisation plutôt que de le rouvrir."
      )
    }

    const asOf = toDate(input.asOf)
    const entry = await post(tx, {
      firmId: ctx.firmId,
      memberId: member.id,
      periodYear: asOf.getFullYear(),
      periodMonth: asOf.getMonth() + 1,
      type: "OPENING",
      sourceType: "OPENING",
      credit: input.amount > 0 ? input.amount : 0,
      debit: input.amount < 0 ? -input.amount : 0,
      note: input.note || "Solde d'ouverture à la bascule",
      createdById: ctx.userId,
    })

    await audit({
      action: "OPEN_LEDGER",
      entity: "IPM_MEMBER",
      entityId: member.id,
      metadata: {
        matricule: member.matricule,
        amount: input.amount,
        asOf: input.asOf,
      },
    })

    return entry
  },
})

/* ==========================================================================
 * Régularisation
 * ========================================================================== */

const adjustLedgerSchema = z.object({
  ...firmScoped,
  memberId: z.string().min(1),
  amount: z.coerce.number().int().min(-99_999_999).max(99_999_999),
  asOf: dateField,
  note: z.string().trim().min(3, "Motif requis.").max(200),
})

/** The only way to correct a register. Never an update, never a delete. */
export const adjustLedger = firmAction({
  input: adjustLedgerSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => [
    listPath(input.firmSlug, "cotisations"),
    listPath(input.firmSlug, "participants", input.memberId),
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    const member = await tx.member.findFirst({
      where: { id: input.memberId, firmId: ctx.firmId },
      select: { id: true, matricule: true },
    })
    if (!member) throw new ActionError("Participant introuvable.")
    if (input.amount === 0) {
      throw new ActionError("Une régularisation de zéro ne corrige rien.")
    }

    const asOf = toDate(input.asOf)
    const entry = await post(tx, {
      firmId: ctx.firmId,
      memberId: member.id,
      periodYear: asOf.getFullYear(),
      periodMonth: asOf.getMonth() + 1,
      type: "ADJUSTMENT",
      sourceType: "MANUAL",
      credit: input.amount > 0 ? input.amount : 0,
      debit: input.amount < 0 ? -input.amount : 0,
      note: input.note,
      createdById: ctx.userId,
    })

    await audit({
      action: "ADJUST_LEDGER",
      entity: "IPM_MEMBER",
      entityId: member.id,
      metadata: {
        matricule: member.matricule,
        amount: input.amount,
        note: input.note,
      },
    })

    return entry
  },
})

/* ==========================================================================
 * Clôture mensuelle
 * ========================================================================== */

const closeMonthSchema = z.object({
  ...firmScoped,
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
})

/**
 * Clôture d'un mois : une écriture CONTRIBUTION par participant actif, puis
 * une facture par employeur.
 *
 * Idempotent by construction — a member who already has a CONTRIBUTION entry
 * for the period is skipped, and the invoice's unique constraint on
 * (employer, year, month) makes a second closing a refusal rather than a
 * duplicate. Running it twice is a no-op, which matters because somebody
 * eventually will.
 */
export const closeMonth = firmAction({
  input: closeMonthSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => [
    listPath(input.firmSlug, "cotisations"),
    listPath(input.firmSlug, "factures"),
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    const { year, month } = input
    const periodEnd = new Date(year, month, 0)

    const employers = await tx.ipmEmployer.findMany({
      where: { firmId: ctx.firmId, status: "ACTIVE" },
      select: {
        id: true,
        organization: { select: { name: true } },
        members: {
          where: { status: "ACTIVE" },
          select: {
            id: true,
            matricule: true,
            person: { select: { firstName: true, lastName: true } },
            contributions: {
              where: { validTo: null },
              select: {
                monthlyAmount: true,
                employerAmount: true,
                employeeAmount: true,
              },
              take: 1,
            },
            ledgerEntries: {
              where: { periodYear: year, periodMonth: month, type: "CONTRIBUTION" },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
    })

    let posted = 0
    let invoiced = 0
    let skipped = 0

    for (const employer of employers) {
      const billable = employer.members.filter(
        (member) => member.contributions.length > 0
      )
      if (billable.length === 0) continue

      const existingInvoice = await tx.ipmEmployerInvoice.findUnique({
        where: {
          employerId_periodYear_periodMonth: {
            employerId: employer.id,
            periodYear: year,
            periodMonth: month,
          },
        },
        select: { id: true },
      })
      if (existingInvoice) {
        skipped += 1
        continue
      }

      let employerShare = 0
      let employeeShare = 0
      let total = 0
      const lines: Prisma.IpmEmployerInvoiceLineCreateManyInvoiceInput[] = []

      for (const member of billable) {
        const contribution = member.contributions[0]
        const monthly = Number(contribution.monthlyAmount)
        const share = {
          employer: Number(contribution.employerAmount ?? 0),
          employee: Number(contribution.employeeAmount ?? 0),
        }
        // When the split is not recorded, the whole cotisation is the
        // employer's: that is how the current agreements work, and inventing a
        // salarié share would put a deduction on a payslip nobody agreed to.
        const resolvedEmployer =
          share.employer + share.employee === 0 ? monthly : share.employer

        employerShare += resolvedEmployer
        employeeShare += share.employee
        total += monthly

        lines.push({
          firmId: ctx.firmId,
          memberId: member.id,
          matricule: member.matricule,
          memberName: `${member.person.lastName.toUpperCase()} ${member.person.firstName}`,
          monthlyContribution: monthly,
          employerShare: resolvedEmployer,
          employeeShare: share.employee,
        })

        // Idempotence: a member already credited for this period is left
        // alone, so a re-run cannot double a cotisation.
        if (member.ledgerEntries.length === 0) {
          await post(tx, {
            firmId: ctx.firmId,
            memberId: member.id,
            periodYear: year,
            periodMonth: month,
            type: "CONTRIBUTION",
            sourceType: "INVOICE",
            credit: monthly,
            note: `Cotisation ${String(month).padStart(2, "0")}/${year}`,
            createdById: ctx.userId,
          })
          posted += 1
        }
      }

      const sequence = await nextInSequence(tx, ctx.firmId, "FACT", year)
      const number = `FACT-${year}-${String(sequence).padStart(5, "0")}`

      const invoice = await tx.ipmEmployerInvoice.create({
        data: {
          firmId: ctx.firmId,
          employerId: employer.id,
          number,
          periodYear: year,
          periodMonth: month,
          issueDate: periodEnd,
          // 30 days, which is the practice the agreements describe.
          dueDate: new Date(periodEnd.getTime() + 30 * 86_400_000),
          memberCount: billable.length,
          employerShare,
          employeeShare,
          totalAmount: total,
          status: "ISSUED",
          statusChangedById: ctx.userId,
          statusChangedAt: new Date(),
        },
        select: { id: true },
      })

      await tx.ipmEmployerInvoiceLine.createMany({
        data: lines.map((line) => ({ ...line, invoiceId: invoice.id })),
      })

      invoiced += 1
    }

    await audit({
      action: "CLOSE_MONTH",
      entity: "IPM_FIRM",
      entityId: ctx.firmId,
      metadata: { year, month, posted, invoiced, skipped },
    })

    return { posted, invoiced, skipped }
  },
})

/* ==========================================================================
 * Consommation → registre
 * ========================================================================== */

const postConsumptionSchema = z.object({
  ...firmScoped,
  voucherId: z.string().min(1),
})

/**
 * Debits a settled voucher to the participant's register.
 *
 * §11 Q9: the debit is the **IPM share**, not the total. The ticket modérateur
 * is the member's own money and never passed through the institution, so
 * debiting the whole voucher would make every balance overstate what the IPM
 * actually carries.
 */
export const postVoucherConsumption = firmAction({
  input: postConsumptionSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => listPath(input.firmSlug, "cotisations"),
  handler: async ({ input, ctx, tx, audit }) => {
    const voucher = await tx.ipmVoucher.findFirst({
      where: { id: input.voucherId, firmId: ctx.firmId },
      select: {
        id: true,
        number: true,
        memberId: true,
        status: true,
        settledAt: true,
        totalAmount: true,
        insurerShare: true,
      },
    })
    if (!voucher) throw new ActionError("Bon introuvable.")
    if (!["SETTLED", "INVOICED"].includes(voucher.status)) {
      throw new ActionError("Seul un bon réglé est porté au registre.")
    }

    const already = await tx.ipmLedgerEntry.findFirst({
      where: {
        firmId: ctx.firmId,
        sourceType: "VOUCHER",
        sourceId: voucher.id,
      },
      select: { id: true },
    })
    if (already) throw new ActionError("Ce bon est déjà porté au registre.")

    const on = voucher.settledAt ?? new Date()
    const debit = consumptionDebit(
      DEFAULT_CONSUMPTION_BASIS,
      Number(voucher.totalAmount),
      Number(voucher.insurerShare)
    )

    const entry = await post(tx, {
      firmId: ctx.firmId,
      memberId: voucher.memberId,
      periodYear: on.getFullYear(),
      periodMonth: on.getMonth() + 1,
      type: "CONSUMPTION",
      sourceType: "VOUCHER",
      sourceId: voucher.id,
      debit,
      note: `Bon ${voucher.number}`,
      createdById: ctx.userId,
    })

    await audit({
      action: "POST_CONSUMPTION",
      entity: "IPM_VOUCHER",
      entityId: voucher.id,
      metadata: { number: voucher.number, debit },
    })

    return entry
  },
})

/* ==========================================================================
 * Recalcul
 * ========================================================================== */

const recomputeBalancesSchema = z.object({ ...firmScoped })

/**
 * Rebuilds every cached balance from the register.
 *
 * The plan asks for this explicitly, and it is the reason a cache is
 * acceptable at all: `currentBalance` is an optimisation that can be thrown
 * away and reconstructed, not a second source of truth.
 */
export const recomputeBalances = firmAction({
  input: recomputeBalancesSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => listPath(input.firmSlug, "cotisations"),
  handler: async ({ ctx, tx, audit }) => {
    const members = await tx.member.findMany({
      where: { firmId: ctx.firmId },
      select: {
        id: true,
        currentBalance: true,
        ledgerEntries: {
          orderBy: [
            { periodYear: "asc" },
            { periodMonth: "asc" },
            { createdAt: "asc" },
          ],
          select: {
            id: true,
            periodYear: true,
            periodMonth: true,
            type: true,
            credit: true,
            debit: true,
            createdAt: true,
            balanceAfter: true,
          },
        },
      },
    })

    let corrected = 0
    let running = 0

    for (const member of members) {
      const entries = member.ledgerEntries.map((row) => ({
        id: row.id,
        periodYear: row.periodYear,
        periodMonth: row.periodMonth,
        type: row.type,
        credit: Number(row.credit),
        debit: Number(row.debit),
        createdAt: row.createdAt,
      }))

      const computed = balanceOf(entries)
      if (Math.abs(Number(member.currentBalance) - computed) > 0.005) {
        await tx.member.update({
          where: { id: member.id },
          data: { currentBalance: computed, balanceAsOf: new Date() },
        })
        corrected += 1
      }

      // The stored running balance is rebuilt too, in order.
      let cursor = 0
      for (const entry of entries) {
        cursor += entry.credit - entry.debit
        const stored = member.ledgerEntries.find((row) => row.id === entry.id)
        if (stored && Math.abs(Number(stored.balanceAfter) - cursor) > 0.005) {
          await tx.ipmLedgerEntry.update({
            where: { id: entry.id },
            data: { balanceAfter: cursor },
          })
          running += 1
        }
      }
    }

    await audit({
      action: "RECOMPUTE_BALANCES",
      entity: "IPM_FIRM",
      entityId: ctx.firmId,
      metadata: { members: members.length, corrected, runningBalances: running },
    })

    return { members: members.length, corrected, runningBalances: running }
  },
})

/* ==========================================================================
 * Facture : statut
 * ========================================================================== */

const setInvoiceStatusSchema = z.object({
  ...firmScoped,
  invoiceId: z.string().min(1),
  status: z.enum([
    "DRAFT",
    "ISSUED",
    "PARTIALLY_PAID",
    "PAID",
    "OVERDUE",
    "CANCELLED",
  ]),
  paidAmount: amountField.optional(),
  paymentMethod: z.string().trim().max(40).or(z.literal("")).optional(),
  paymentReference: z.string().trim().max(60).or(z.literal("")).optional(),
})

/**
 * The status is the user's to set — and every change records who and when.
 *
 * §4.8ter is explicit about why: a "payé" with no trace of who entered it has
 * no evidential value. The audit row and the two columns exist for the same
 * reason and are written together.
 */
export const setInvoiceStatus = firmAction({
  input: setInvoiceStatusSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => listPath(input.firmSlug, "factures"),
  handler: async ({ input, ctx, tx, audit }) => {
    const invoice = await tx.ipmEmployerInvoice.findFirst({
      where: { id: input.invoiceId, firmId: ctx.firmId },
      select: { id: true, number: true, status: true, totalAmount: true },
    })
    if (!invoice) throw new ActionError("Facture introuvable.")

    const paid = input.paidAmount ?? null
    if (paid !== null && paid > Number(invoice.totalAmount)) {
      throw new ActionError(
        "Le montant réglé dépasse le total de la facture.",
        { paidAmount: ["Montant supérieur au total."] }
      )
    }

    await tx.ipmEmployerInvoice.update({
      where: { id: invoice.id },
      data: {
        status: input.status,
        paidAmount: paid ?? undefined,
        paidAt: input.status === "PAID" ? new Date() : undefined,
        paymentMethod: input.paymentMethod || null,
        paymentReference: input.paymentReference || null,
        statusChangedById: ctx.userId,
        statusChangedAt: new Date(),
      },
    })

    await audit({
      action: "SET_INVOICE_STATUS",
      entity: "IPM_EMPLOYER_INVOICE",
      entityId: invoice.id,
      metadata: {
        number: invoice.number,
        from: invoice.status,
        to: input.status,
        paidAmount: paid,
      },
    })

    return { id: invoice.id }
  },
})

/* ==========================================================================
 * Réaffiliation — §11 Q13
 * ========================================================================== */

const resetLedgerSchema = z.object({
  ...firmScoped,
  memberId: z.string().min(1),
  asOf: dateField,
})

/** The balance starts again, expressed as two entries rather than a deletion. */
export const resetLedgerOnReaffiliation = firmAction({
  input: resetLedgerSchema,
  minimumRole: "MANAGER",
  module: IPM_MODULE,
  revalidate: (input) => [
    listPath(input.firmSlug, "cotisations"),
    listPath(input.firmSlug, "participants", input.memberId),
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    const member = await tx.member.findFirst({
      where: { id: input.memberId, firmId: ctx.firmId },
      select: { id: true, matricule: true, currentBalance: true },
    })
    if (!member) throw new ActionError("Participant introuvable.")

    const asOf = toDate(input.asOf)
    const entries = reaffiliationEntries(Number(member.currentBalance), asOf)

    for (const row of entries) {
      await post(tx, {
        firmId: ctx.firmId,
        memberId: member.id,
        periodYear: asOf.getFullYear(),
        periodMonth: asOf.getMonth() + 1,
        type: row.type,
        sourceType: row.type === "OPENING" ? "OPENING" : "MANUAL",
        credit: row.credit,
        debit: row.debit,
        note: row.note,
        createdById: ctx.userId,
      })
    }

    await audit({
      action: "RESET_LEDGER",
      entity: "IPM_MEMBER",
      entityId: member.id,
      metadata: {
        matricule: member.matricule,
        previousBalance: Number(member.currentBalance),
        asOf: input.asOf,
      },
    })

    return { entries: entries.length }
  },
})
