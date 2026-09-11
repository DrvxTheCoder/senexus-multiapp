import "server-only"

import type { Prisma } from "@prisma/client"

import { LEGACY_MAXIMA, type VoucherType } from "@/server/domain/ipm/issuance"

/**
 * Numérotation séquentielle, par type et par exercice.
 *
 * A counter row advanced inside the caller's transaction, **not** `max + 1`
 * over the documents. That distinction is the whole reason this file exists:
 * two concurrent issues computing `max + 1` produce the same number, and for a
 * bon that means two different people walking out with the same reference. The
 * HR module shipped exactly that bug and needed a migration to recover.
 *
 * `UPDATE … RETURNING` on a single row takes a row lock for the length of the
 * transaction, so the second caller waits rather than reading a stale maximum.
 */

export type SequenceKind = "BPI" | "BCI" | "LGI" | "LHI" | "DEC" | "FACT" | "REMB"

/**
 * Reserves the next number in a series and returns it.
 *
 * The first call in a series seeds the counter above whatever the legacy
 * export already carries — BPI005430 and LGI009310 exist on paper, and reusing
 * either number would put two documents into the world with one reference.
 */
export async function nextInSequence(
  tx: Prisma.TransactionClient,
  firmId: string,
  kind: SequenceKind,
  year: number,
  floor = 0
): Promise<number> {
  const existing = await tx.ipmSequence.findUnique({
    where: { firmId_kind_year: { firmId, kind, year } },
    select: { id: true },
  })

  if (!existing) {
    await tx.ipmSequence.create({
      data: { firmId, kind, year, next: floor + 1 },
    })
  }

  // One statement: read and advance together, under the row lock.
  const [row] = await tx.$queryRaw<{ next: number }[]>`
    UPDATE "ipm_sequences"
    SET "next" = "next" + 1, "updatedAt" = now()
    WHERE "firmId" = ${firmId} AND "kind" = ${kind} AND "year" = ${year}
    RETURNING "next" - 1 AS "next"
  `

  if (!row) {
    throw new Error(`Séquence ${kind}/${year} introuvable après création.`)
  }

  return row.next
}

const VOUCHER_KIND: Record<VoucherType, SequenceKind> = {
  PHARMACY: "BPI",
  OPTICAL: "BCI",
  GUARANTEE: "LGI",
  HOSPITALIZATION: "LHI",
}

/**
 * The next voucher number for a type.
 *
 * Vouchers are numbered in **one continuous series per type**, not per
 * exercice: BPI005431 follows BPI005430 whatever year it is, because the paper
 * documents in circulation are numbered that way and the reconciliation has to
 * line up. Financial documents (§4.9) restart each exercice — that is what the
 * `year` argument is for elsewhere.
 */
export async function nextVoucherSequence(
  tx: Prisma.TransactionClient,
  firmId: string,
  type: VoucherType
): Promise<number> {
  return nextInSequence(
    tx,
    firmId,
    VOUCHER_KIND[type],
    // Year 0 is the sentinel for a series that does not reset.
    0,
    LEGACY_MAXIMA[type]
  )
}
