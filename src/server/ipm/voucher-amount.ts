import "server-only"

import type {
  IpmReviewFlag,
  IpmVoucherAmountChangeKind,
  PortalNotificationKind,
  Prisma,
} from "@prisma/client"

import { db } from "@/lib/db"
import { ActionError } from "@/server/actions/define-action"
import {
  AMOUNT_REFUSAL_MESSAGES,
  counts,
  decideAdjustment,
  decideBackOfficeValidation,
  decideProviderValidation,
  decideVoid,
  deferredSplit,
  isValidAmount,
  ledgerCorrection,
  remainingEnvelope,
  validationFlags,
  type AmountRefusal,
  type DeferredSplit,
  type ValidationFlag,
  type VoucherAmountState,
} from "@/server/domain/ipm/deferred-amount"
import { consumptionDebit, DEFAULT_CONSUMPTION_BASIS } from "@/server/domain/ipm/ledger"
import { postLedgerEntry } from "@/server/ipm/ledger-writes"
import { deadToken } from "@/server/ipm/voucher-writes"
import { beneficiaryRef, gatherIssuanceFacts } from "@/server/queries/ipm/vouchers"

/**
 * Le montant d'un bon de pharmacie — every write that sets, changes or voids it.
 *
 * Four entry points: the pharmacy validating from its session, the gestionnaire
 * validating on its behalf, the gestionnaire correcting a validated amount,
 * the gestionnaire voiding the bon. Each one changes **only the voucher row**
 * and then calls `syncVoucherEffects`, which brings everything that depends on
 * that row into line with it, in the same transaction:
 *
 *   - the consumption row the plafonds are summed from;
 *   - the bon's single line (the PDF and the invoice read lines);
 *   - the participant register — a CONSUMPTION at validation, an ADJUSTMENT
 *     for the difference on a correction, a REVERSAL on a void — and with it
 *     `Member.currentBalance`;
 *   - the provider invoice line and the invoice's matched total, when the bon
 *     is already on an invoice that may still change.
 *
 * The provider's list and monthly figure, and the next invoice, read the
 * voucher row directly. So there is one figure, on one row, and every reader
 * either reads it or is rewritten from it here — never a copy that can drift.
 *
 * Nothing is reserved while a bon waits for its amount: the balance moves at
 * validation, not at issue (see `domain/ipm/deferred-amount.ts`).
 */

type Tx = Prisma.TransactionClient
type Client = Tx | typeof db

export type AmountActor =
  | { kind: "provider"; providerAccountId: string; providerId: string }
  | { kind: "user"; userId: string }

export type AmountErrorCode = AmountRefusal | "NOT_FOUND" | "INVALID_AMOUNT" | "REASON_REQUIRED"

/**
 * A refusal with a code the API maps to a status, and a sentence the UI can
 * show as is. An ActionError, so a back-office action surfaces it unchanged.
 */
export class VoucherAmountError extends ActionError {
  readonly code: AmountErrorCode

  constructor(code: AmountErrorCode, message?: string) {
    super(
      message ??
        (code === "NOT_FOUND"
          ? "Bon introuvable."
          : code === "INVALID_AMOUNT"
            ? "Le montant doit être un nombre entier de francs, supérieur à zéro."
            : code === "REASON_REQUIRED"
              ? "Indiquez le motif."
              : AMOUNT_REFUSAL_MESSAGES[code])
    )
    this.name = "VoucherAmountError"
    this.code = code
  }
}

export const GLOBAL_PHARMACY_LINE = "Montant global (pharmacie)"

const STATE_SELECT = {
  id: true,
  firmId: true,
  number: true,
  status: true,
  deferredAmount: true,
  providerId: true,
  expiryDate: true,
  validationKey: true,
  validatedByProviderAccountId: true,
  validatedAt: true,
  memberId: true,
  dependentId: true,
  serviceTypeId: true,
  appliedRate: true,
  totalAmount: true,
  insurerShare: true,
  memberShare: true,
  reviewFlags: true,
  amountSource: true,
  issuedByPortalAccountId: true,
  providerInvoiceId: true,
} satisfies Prisma.IpmVoucherSelect

type StateRow = Prisma.IpmVoucherGetPayload<{ select: typeof STATE_SELECT }> & {
  invoiceStatus: string | null
}

async function load(client: Client, firmId: string, voucherId: string): Promise<StateRow> {
  const row = await client.ipmVoucher.findFirst({
    where: { id: voucherId, firmId },
    select: STATE_SELECT,
  })
  if (!row) throw new VoucherAmountError("NOT_FOUND")
  const invoice = row.providerInvoiceId
    ? await client.ipmProviderInvoice.findUnique({
        where: { id: row.providerInvoiceId },
        select: { status: true },
      })
    : null
  return { ...row, invoiceStatus: invoice?.status ?? null }
}

function stateOf(row: StateRow): VoucherAmountState {
  return {
    status: row.status,
    deferredAmount: row.deferredAmount,
    providerId: row.providerId,
    expiryDate: row.expiryDate,
    validationKey: row.validationKey,
    validatedByProviderAccountId: row.validatedByProviderAccountId,
    invoiceStatus: row.invoiceStatus,
  }
}

function assertAmount(amount: unknown): asserts amount is number {
  if (!isValidAmount(amount)) throw new VoucherAmountError("INVALID_AMOUNT")
}

function assertReason(reason: string | undefined): string {
  const trimmed = reason?.trim() ?? ""
  if (trimmed.length < 3) throw new VoucherAmountError("REASON_REQUIRED")
  return trimmed
}

/* ==========================================================================
 * Le prix
 * ========================================================================== */

export type PricedAmount = DeferredSplit & {
  rate: number
  flags: ValidationFlag[]
}

/**
 * What an amount comes to for this bon, on this date: the taux frozen at
 * issue, the plafonds in force on `on` less what the beneficiary consumed
 * apart from this very bon. The dry run and the write call the same function,
 * so the split the pharmacist confirms is the split that is written.
 */
async function price(
  client: Client,
  row: StateRow,
  amount: number,
  on: Date
): Promise<PricedAmount> {
  const [context, settings] = await Promise.all([
    gatherIssuanceFacts(
      { firmId: row.firmId },
      {
        memberId: row.memberId,
        dependentId: row.dependentId,
        providerId: row.providerId,
        serviceTypeId: row.serviceTypeId,
        totalAmount: amount,
        on,
        excludeVoucherId: row.id,
      },
      client
    ),
    client.ipmPortalSettings.findUnique({
      where: { firmId: row.firmId },
      select: { pharmacyReviewThreshold: true },
    }),
  ])
  if (!context) throw new VoucherAmountError("NOT_FOUND")

  const rate = Number(row.appliedRate)
  const result = deferredSplit(
    amount,
    rate,
    remainingEnvelope(context.facts.ceilings, context.facts.consumed)
  )
  const threshold =
    settings?.pharmacyReviewThreshold == null ? null : Number(settings.pharmacyReviewThreshold)
  return { ...result, rate, flags: validationFlags(result, threshold) }
}

/** The flags a validation owns, replaced wholesale on every re-pricing. */
const PRICING_FLAGS: IpmReviewFlag[] = ["CEILING_CAPPED", "AMOUNT_ABOVE_THRESHOLD"]

function withPricingFlags(current: IpmReviewFlag[], next: ValidationFlag[]): IpmReviewFlag[] {
  return [...current.filter((flag) => !PRICING_FLAGS.includes(flag)), ...next]
}

/* ==========================================================================
 * Résultat
 * ========================================================================== */

export type AmountResult = {
  voucherId: string
  number: string
  status: string
  amount: number
  ipmShare: number
  participantShare: number
  flags: ValidationFlag[]
  validatedAt: string | null
  /** True when this answered a retry with the key already used. */
  replayed: boolean
}

function resultOf(row: StateRow, replayed: boolean): AmountResult {
  return {
    voucherId: row.id,
    number: row.number,
    status: row.status,
    amount: Number(row.totalAmount ?? 0),
    ipmShare: Number(row.insurerShare),
    participantShare: Number(row.memberShare),
    flags: row.reviewFlags.filter((flag): flag is ValidationFlag =>
      PRICING_FLAGS.includes(flag)
    ),
    validatedAt: row.validatedAt?.toISOString() ?? null,
    replayed,
  }
}

/* ==========================================================================
 * Dry run
 * ========================================================================== */

export type AmountPreview = {
  voucherId: string
  amount: number
  ipmShare: number
  participantShare: number
  rate: number
  /** Null when no plafond applies. */
  remainingCeiling: number | null
  flags: ValidationFlag[]
}

function previewOf(row: StateRow, priced: PricedAmount): AmountPreview {
  return {
    voucherId: row.id,
    amount: priced.totalAmount,
    ipmShare: priced.insurerShare,
    participantShare: priced.memberShare,
    rate: priced.rate,
    remainingCeiling: priced.remaining,
    flags: priced.flags,
  }
}

/** What the pharmacist sees before confirming. Writes nothing. */
export async function previewProviderValidation(
  client: Client,
  scope: { firmId: string; providerId: string; providerAccountId: string },
  input: { voucherId: string; amount: unknown; now?: Date }
): Promise<AmountPreview> {
  const now = input.now ?? new Date()
  const row = await load(client, scope.firmId, input.voucherId)
  const decision = decideProviderValidation(stateOf(row), {
    providerId: scope.providerId,
    providerAccountId: scope.providerAccountId,
    // No key on a dry run, so a validated bon is never a "replay" here.
    key: "",
    now,
  })
  if (decision.kind !== "validate") {
    throw new VoucherAmountError(decision.kind === "refuse" ? decision.code : "ALREADY_VALIDATED")
  }
  assertAmount(input.amount)
  return previewOf(row, await price(client, row, input.amount, now))
}

/** The same, for the gestionnaire: a validation on behalf, or a correction. */
export async function previewBackOfficeAmount(
  client: Client,
  scope: { firmId: string },
  input: { voucherId: string; amount: unknown; now?: Date }
): Promise<AmountPreview> {
  const row = await load(client, scope.firmId, input.voucherId)
  const state = stateOf(row)
  const isCorrection = state.status === "SETTLED" || state.status === "INVOICED"
  const decision = isCorrection ? decideAdjustment(state) : decideBackOfficeValidation(state)
  if (decision.kind === "refuse") throw new VoucherAmountError(decision.code)
  assertAmount(input.amount)
  const on = isCorrection ? (row.validatedAt ?? new Date()) : (input.now ?? new Date())
  return previewOf(row, await price(client, row, input.amount, on))
}

/* ==========================================================================
 * Validation
 * ========================================================================== */

/**
 * Sets the amount of a bon waiting for it, and makes it count.
 *
 * From the pharmacy: bound provider only, not expired, idempotent on the key —
 * a retry with the key already used answers what was written, anything else
 * is ALREADY_VALIDATED. From the back office: neither binding nor expiry, but
 * a reason, always.
 *
 * The bon becomes SETTLED with `settledAt` = `validatedAt`, which is what the
 * invoice pipeline already selects on: a validated bon de pharmacie is billed
 * in the month it was validated, like any bon honoured that month.
 */
export async function validateDeferredAmount(
  tx: Tx,
  input: {
    firmId: string
    voucherId: string
    amount: unknown
    actor: AmountActor
    /** Required from a pharmacy. */
    idempotencyKey?: string
    /** Required from the back office. */
    reason?: string
    now?: Date
  }
): Promise<AmountResult> {
  const now = input.now ?? new Date()
  const { actor } = input
  const row = await load(tx, input.firmId, input.voucherId)
  const state = stateOf(row)

  let reason: string | null = null
  if (actor.kind === "provider") {
    const key = input.idempotencyKey ?? ""
    const decision = decideProviderValidation(state, {
      providerId: actor.providerId,
      providerAccountId: actor.providerAccountId,
      key,
      now,
    })
    if (decision.kind === "replay") return resultOf(row, true)
    if (decision.kind === "refuse") throw new VoucherAmountError(decision.code)
  } else {
    const decision = decideBackOfficeValidation(state)
    if (decision.kind === "refuse") throw new VoucherAmountError(decision.code)
    reason = assertReason(input.reason)
  }
  assertAmount(input.amount)

  const priced = await price(tx, row, input.amount, now)

  // Conditional on the status just read: two validations racing — the same
  // pharmacy retrying, or the pharmacy and the gestionnaire at once — and only
  // the first write lands.
  const { count } = await tx.ipmVoucher.updateMany({
    where: { id: row.id, status: row.status },
    data: {
      status: "SETTLED",
      totalAmount: priced.totalAmount,
      insurerShare: priced.insurerShare,
      memberShare: priced.memberShare,
      amountEnteredAt: now,
      amountSource: actor.kind === "provider" ? "PROVIDER" : "BACK_OFFICE",
      validatedByProviderAccountId: actor.kind === "provider" ? actor.providerAccountId : null,
      validatedByUserId: actor.kind === "user" ? actor.userId : null,
      validatedAt: now,
      settledAt: now,
      settledById: actor.kind === "user" ? actor.userId : null,
      validationKey: actor.kind === "provider" ? (input.idempotencyKey ?? null) : null,
      reviewFlags: withPricingFlags(row.reviewFlags, priced.flags),
    },
  })
  if (count === 0) {
    // Lost the race. If the winner was this same request retried, answer it.
    const winner = await load(tx, input.firmId, input.voucherId)
    if (
      actor.kind === "provider" &&
      decideProviderValidation(stateOf(winner), {
        providerId: actor.providerId,
        providerAccountId: actor.providerAccountId,
        key: input.idempotencyKey ?? "",
        now,
      }).kind === "replay"
    ) {
      return resultOf(winner, true)
    }
    throw new VoucherAmountError("ALREADY_VALIDATED")
  }

  await syncVoucherEffects(tx, input.firmId, row.id, {
    createdById: actor.kind === "user" ? actor.userId : null,
    now,
  })
  await recordChange(tx, row, {
    kind: "VALIDATE",
    newAmount: priced.totalAmount,
    newInsurerShare: priced.insurerShare,
    actor,
    reason,
  })
  await notifyParticipant(tx, row, "VOUCHER_VALIDATED")

  return resultOf(await load(tx, input.firmId, row.id), false)
}

/* ==========================================================================
 * Correction et annulation — back office
 * ========================================================================== */

/**
 * Changes the amount of a validated bon. Priced on the date it was validated —
 * the plafonds of that month — so a correction in November does not measure
 * an October bon against November's consumption.
 */
export async function adjustDeferredAmount(
  tx: Tx,
  input: {
    firmId: string
    voucherId: string
    amount: unknown
    userId: string
    reason?: string
    now?: Date
  }
): Promise<AmountResult> {
  const now = input.now ?? new Date()
  const row = await load(tx, input.firmId, input.voucherId)
  const decision = decideAdjustment(stateOf(row))
  if (decision.kind === "refuse") throw new VoucherAmountError(decision.code)
  const reason = assertReason(input.reason)
  assertAmount(input.amount)
  if (row.totalAmount !== null && Number(row.totalAmount) === input.amount) {
    throw new VoucherAmountError("INVALID_AMOUNT", "Le montant est inchangé.")
  }

  const priced = await price(tx, row, input.amount, row.validatedAt ?? now)

  const { count } = await tx.ipmVoucher.updateMany({
    where: { id: row.id, status: row.status, totalAmount: row.totalAmount },
    data: {
      totalAmount: priced.totalAmount,
      insurerShare: priced.insurerShare,
      memberShare: priced.memberShare,
      amountEnteredAt: now,
      amountSource: "BACK_OFFICE",
      reviewFlags: withPricingFlags(row.reviewFlags, priced.flags),
    },
  })
  if (count === 0) {
    throw new VoucherAmountError("ALREADY_VALIDATED", "Ce bon vient d'être modifié. Rechargez la page.")
  }

  await syncVoucherEffects(tx, input.firmId, row.id, { createdById: input.userId, now })
  await recordChange(tx, row, {
    kind: "ADJUST",
    newAmount: priced.totalAmount,
    newInsurerShare: priced.insurerShare,
    actor: { kind: "user", userId: input.userId },
    reason,
  })
  await notifyParticipant(tx, row, "VOUCHER_ADJUSTED")

  return resultOf(await load(tx, input.firmId, row.id), false)
}

/**
 * Annulation by the IPM, waiting or validated. The bon stops counting: its
 * consumption goes, the register is reversed, and it leaves the invoice it was
 * on. Its QR is rotated so the pharmacy can no longer find it.
 */
export async function voidDeferredVoucher(
  tx: Tx,
  input: { firmId: string; voucherId: string; userId: string; reason?: string; now?: Date }
): Promise<AmountResult> {
  const now = input.now ?? new Date()
  const row = await load(tx, input.firmId, input.voucherId)
  const decision = decideVoid(stateOf(row))
  if (decision.kind === "refuse") throw new VoucherAmountError(decision.code)
  const reason = assertReason(input.reason)

  const { count } = await tx.ipmVoucher.updateMany({
    where: { id: row.id, status: row.status },
    data: {
      status: "CANCELLED",
      cancelledAt: now,
      cancelReason: reason,
      qrToken: deadToken(input.firmId),
    },
  })
  if (count === 0) {
    throw new VoucherAmountError("ALREADY_VALIDATED", "Ce bon vient d'être modifié. Rechargez la page.")
  }

  await syncVoucherEffects(tx, input.firmId, row.id, { createdById: input.userId, now })
  await recordChange(tx, row, {
    kind: "VOID",
    newAmount: null,
    newInsurerShare: null,
    actor: { kind: "user", userId: input.userId },
    reason,
  })
  await notifyParticipant(tx, row, "VOUCHER_VOIDED")

  return resultOf(await load(tx, input.firmId, row.id), false)
}

/* ==========================================================================
 * Expiration
 * ========================================================================== */

/**
 * Marks EXPIRED every bon still waiting for its amount past its deadline, and
 * kills its QR. Nothing else to undo: a waiting bon never counted.
 *
 * Run by `/api/cron/expire-vouchers`. Not load-bearing for correctness: the
 * validation refuses on the date whether or not this has run.
 */
export async function expireAwaitingVouchers(
  client: Client,
  input: { now?: Date; firmId?: string } = {}
): Promise<{ expired: number }> {
  const now = input.now ?? new Date()
  const stale = await client.ipmVoucher.findMany({
    where: {
      status: "AWAITING_AMOUNT",
      expiryDate: { lt: now },
      ...(input.firmId ? { firmId: input.firmId } : {}),
    },
    select: { id: true, firmId: true },
  })

  const byFirm = new Map<string, string[]>()
  for (const row of stale) byFirm.set(row.firmId, [...(byFirm.get(row.firmId) ?? []), row.id])

  let expired = 0
  for (const [firmId, ids] of byFirm) {
    const { count } = await client.ipmVoucher.updateMany({
      // The status again, so a validation that landed meanwhile is untouched.
      where: { id: { in: ids }, status: "AWAITING_AMOUNT" },
      data: { status: "EXPIRED", qrToken: deadToken(firmId) },
    })
    expired += count
  }
  return { expired }
}

/* ==========================================================================
 * Ce qui dépend du bon
 * ========================================================================== */

/**
 * Brings everything derived from a bon's amount into line with the voucher
 * row. The single function every mutation path above calls; idempotent, so
 * calling it on a bon already in line writes nothing to the register.
 */
export async function syncVoucherEffects(
  tx: Tx,
  firmId: string,
  voucherId: string,
  options: { createdById: string | null; now?: Date }
): Promise<void> {
  const now = options.now ?? new Date()
  const row = await tx.ipmVoucher.findFirstOrThrow({
    where: { id: voucherId, firmId },
    select: {
      id: true,
      number: true,
      memberId: true,
      dependentId: true,
      categoryId: true,
      status: true,
      totalAmount: true,
      insurerShare: true,
      memberShare: true,
      validatedAt: true,
      settledAt: true,
      providerInvoiceId: true,
    },
  })
  const invoice = row.providerInvoiceId
    ? await tx.ipmProviderInvoice.findUnique({
        where: { id: row.providerInvoiceId },
        select: { origin: true },
      })
    : null

  const total = row.totalAmount === null ? null : Number(row.totalAmount)
  const insurerShare = Number(row.insurerShare)
  const memberShare = Number(row.memberShare)
  const counted = counts({ status: row.status, totalAmount: total })
  const countsOn = row.validatedAt ?? row.settledAt ?? now

  // Plafonds: one consumption row per counted bon, in the month it counts in.
  await tx.ipmConsumption.deleteMany({ where: { voucherId: row.id } })
  if (counted) {
    await tx.ipmConsumption.create({
      data: {
        firmId,
        beneficiaryRef: beneficiaryRef(row.memberId, row.dependentId),
        memberId: row.memberId,
        categoryId: row.categoryId,
        periodYear: countsOn.getFullYear(),
        periodMonth: countsOn.getMonth() + 1,
        voucherId: row.id,
        amount: total!,
        insurerShare,
      },
    })
  }

  // The line: the amount is global, so it is one line carrying it. Kept on a
  // voided bon, which is still a document somebody may read.
  await tx.ipmVoucherLine.deleteMany({ where: { voucherId: row.id } })
  if (total !== null) {
    await tx.ipmVoucherLine.create({
      data: {
        firmId,
        voucherId: row.id,
        label: GLOBAL_PHARMACY_LINE,
        quantity: 1,
        unitPrice: total,
        amount: total,
      },
    })
  }

  // Register: what is posted against this bon, brought to what it should be.
  const posted = await tx.ipmLedgerEntry.aggregate({
    where: { firmId, sourceType: "VOUCHER", sourceId: row.id },
    _sum: { debit: true, credit: true },
  })
  const net = Number(posted._sum.debit ?? 0) - Number(posted._sum.credit ?? 0)
  const target = counted ? consumptionDebit(DEFAULT_CONSUMPTION_BASIS, total!, insurerShare) : 0
  const correction = ledgerCorrection(net, target)
  if (correction) {
    // A first posting belongs to the month the bon counts in; a correction is
    // dated when it is made — the register reads as what happened, and when.
    const on = correction.type === "CONSUMPTION" ? countsOn : now
    await postLedgerEntry(tx, {
      firmId,
      memberId: row.memberId,
      periodYear: on.getFullYear(),
      periodMonth: on.getMonth() + 1,
      type: correction.type,
      sourceType: "VOUCHER",
      sourceId: row.id,
      debit: "debit" in correction ? correction.debit : 0,
      credit: "credit" in correction ? correction.credit : 0,
      note:
        correction.type === "CONSUMPTION"
          ? `Bon ${row.number}`
          : correction.type === "REVERSAL"
            ? `Bon ${row.number} — annulé`
            : `Bon ${row.number} — montant corrigé`,
      createdById: options.createdById,
    })
  }

  // Invoice: the line follows the bon; a bon that stops counting leaves it.
  if (row.providerInvoiceId && invoice) {
    if (counted) {
      await tx.ipmProviderInvoiceLine.updateMany({
        where: { invoiceId: row.providerInvoiceId, voucherId: row.id },
        data: { totalAmount: total!, insurerShare, memberShare },
      })
    } else {
      await tx.ipmProviderInvoiceLine.deleteMany({
        where: { invoiceId: row.providerInvoiceId, voucherId: row.id },
      })
      await tx.ipmVoucher.update({
        where: { id: row.id },
        data: { providerInvoiceId: null },
      })
    }
    const matched = await tx.ipmVoucher.aggregate({
      where: { firmId, providerInvoiceId: row.providerInvoiceId, status: "INVOICED" },
      _sum: { insurerShare: true },
    })
    const matchedAmount = Number(matched._sum.insurerShare ?? 0)
    await tx.ipmProviderInvoice.update({
      where: { id: row.providerInvoiceId },
      data: {
        matchedAmount,
        // A generated invoice states the figure itself, so it is the matched
        // one by construction. A received one keeps what the provider claimed.
        ...(invoice.origin === "GENERATED" ? { totalAmount: matchedAmount } : {}),
      },
    })
  }
}

async function recordChange(
  tx: Tx,
  before: StateRow,
  change: {
    kind: IpmVoucherAmountChangeKind
    newAmount: number | null
    newInsurerShare: number | null
    actor: AmountActor
    reason: string | null
  }
): Promise<void> {
  await tx.ipmVoucherAmountChange.create({
    data: {
      firmId: before.firmId,
      voucherId: before.id,
      kind: change.kind,
      previousAmount: before.totalAmount,
      newAmount: change.newAmount,
      previousInsurerShare:
        before.status === "SETTLED" || before.status === "INVOICED" ? before.insurerShare : null,
      newInsurerShare: change.newInsurerShare,
      providerAccountId:
        change.actor.kind === "provider" ? change.actor.providerAccountId : null,
      userId: change.actor.kind === "user" ? change.actor.userId : null,
      reason: change.reason,
    },
  })
}

/** The family's portal account, if it has one; whoever issued the bon first. */
async function notifyParticipant(
  tx: Tx,
  row: StateRow,
  kind: PortalNotificationKind
): Promise<void> {
  const portalAccountId =
    row.issuedByPortalAccountId ??
    (
      await tx.portalAccount.findUnique({
        where: { memberId: row.memberId },
        select: { id: true },
      })
    )?.id
  if (!portalAccountId) return
  await tx.portalNotification.create({
    data: { firmId: row.firmId, portalAccountId, voucherId: row.id, kind },
  })
}
