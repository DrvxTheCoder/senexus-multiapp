import "server-only"

import type { Prisma } from "@prisma/client"

import { ActionError } from "@/server/actions/define-action"
import type { LedgerType } from "@/server/domain/ipm/ledger"

type Tx = Prisma.TransactionClient

/**
 * Posts one entry to the participant register and advances the derived values.
 *
 * The only function in the codebase that inserts into the register. That is
 * deliberate: `balanceAfter` and the cached `Member.currentBalance` are derived
 * values, and letting two call sites maintain them is how they diverge. One
 * door, and the door does the arithmetic.
 *
 * Lives here rather than in `actions/ipm-ledger.ts` because that file is
 * "use server": every export there is a callable endpoint, and this must not
 * be one. The back-office actions and the bon amount path both come through.
 *
 * Reads the current balance from the register itself rather than from the
 * cache, so a stale cache cannot propagate into the next `balanceAfter`.
 */
export async function postLedgerEntry(
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
