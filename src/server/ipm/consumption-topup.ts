import "server-only"

import type { Prisma } from "@prisma/client"

import {
  consumptionDebit,
  type ConsumptionBasis,
} from "@/server/domain/ipm/ledger"

type Tx = Prisma.TransactionClient

/**
 * Brings consumption already in the register up to the current basis.
 *
 * The basis moved from the IPM share to the full amount (2026-10-05), and the
 * register is write-only: a bon debited at its IPM share before the change is
 * not rewritten, it gets a second CONSUMPTION entry for the difference — the
 * ticket modérateur — in the same period, against the same source. So the
 * monthly consumption figures and the balance both come out as if the bon had
 * been posted at the full amount from the start, and the old entry is still
 * there to read.
 *
 * Idempotent: what is posted is compared with what the basis asks for, source
 * by source, and only a shortfall is written. A source with a REVERSAL is left
 * alone — it was taken back, there is nothing to top up.
 *
 * Does not maintain `balanceAfter` or the cached balance: the caller rebuilds
 * both afterwards, which it has to do anyway since these entries land in past
 * periods.
 */
export async function topUpConsumptionDebits(
  tx: Tx,
  firmId: string,
  basis: ConsumptionBasis
): Promise<{ entries: number; amount: number }> {
  const posted = await tx.ipmLedgerEntry.findMany({
    where: {
      firmId,
      type: { in: ["CONSUMPTION", "REVERSAL"] },
      sourceType: { in: ["VOUCHER", "REIMBURSEMENT"] },
      sourceId: { not: null },
    },
    orderBy: { createdAt: "asc" },
    select: {
      memberId: true,
      type: true,
      sourceType: true,
      sourceId: true,
      debit: true,
      periodYear: true,
      periodMonth: true,
      note: true,
    },
  })
  if (posted.length === 0) return { entries: 0, amount: 0 }

  type Source = {
    memberId: string
    sourceType: "VOUCHER" | "REIMBURSEMENT"
    sourceId: string
    debited: number
    reversed: boolean
    periodYear: number
    periodMonth: number
    note: string | null
  }
  const sources = new Map<string, Source>()
  for (const row of posted) {
    const key = `${row.sourceType}:${row.sourceId}`
    const source =
      sources.get(key) ??
      ({
        memberId: row.memberId,
        sourceType: row.sourceType as Source["sourceType"],
        sourceId: row.sourceId!,
        debited: 0,
        reversed: false,
        // The first posting's period: the top-up belongs where the bon was.
        periodYear: row.periodYear,
        periodMonth: row.periodMonth,
        note: row.note,
      } satisfies Source)
    if (row.type === "REVERSAL") source.reversed = true
    else source.debited += Number(row.debit)
    sources.set(key, source)
  }

  const ids = (type: Source["sourceType"]) =>
    [...sources.values()]
      .filter((source) => source.sourceType === type && !source.reversed)
      .map((source) => source.sourceId)

  const [vouchers, reimbursements] = await Promise.all([
    tx.ipmVoucher.findMany({
      where: { firmId, id: { in: ids("VOUCHER") } },
      select: { id: true, totalAmount: true, insurerShare: true },
    }),
    tx.ipmReimbursement.findMany({
      where: { firmId, id: { in: ids("REIMBURSEMENT") } },
      select: { id: true, totalAmount: true, insurerShare: true },
    }),
  ])
  const due = new Map<string, number>()
  for (const row of vouchers) {
    due.set(
      `VOUCHER:${row.id}`,
      consumptionDebit(basis, Number(row.totalAmount), Number(row.insurerShare))
    )
  }
  for (const row of reimbursements) {
    due.set(
      `REIMBURSEMENT:${row.id}`,
      consumptionDebit(basis, Number(row.totalAmount), Number(row.insurerShare))
    )
  }

  const topUps: Prisma.IpmLedgerEntryCreateManyInput[] = []
  let amount = 0
  for (const [key, source] of sources) {
    const target = due.get(key)
    if (target === undefined || source.reversed) continue
    const shortfall = Math.round((target - source.debited) * 100) / 100
    if (shortfall <= 0.005) continue
    topUps.push({
      firmId,
      memberId: source.memberId,
      periodYear: source.periodYear,
      periodMonth: source.periodMonth,
      type: "CONSUMPTION",
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      debit: shortfall,
      // Rebuilt by the caller, in order.
      balanceAfter: 0,
      note: `Ticket modérateur — ${source.note ?? source.sourceId}`,
    })
    amount += shortfall
  }

  if (topUps.length > 0) await tx.ipmLedgerEntry.createMany({ data: topUps })
  return { entries: topUps.length, amount }
}
