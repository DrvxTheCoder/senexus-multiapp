import "server-only"

import type { Prisma } from "@prisma/client"

import { db } from "@/lib/db"
import type { FirmContext } from "@/server/auth/require-firm-access"

/**
 * La file de validation — portal bons waiting for a gestionnaire.
 *
 * Two lists with one definition each, shared by the page and the badge, so
 * the number in the sidebar is always the number of rows the page shows:
 *
 *   - **en attente**: PENDING_REVIEW, oldest first — the participant who has
 *     been waiting longest is served first;
 *   - **à vérifier**: issued at once but flagged, and nobody has looked yet.
 */

const PENDING: Prisma.IpmVoucherWhereInput = {
  origin: "PORTAL",
  status: "PENDING_REVIEW",
}

const TO_VERIFY: Prisma.IpmVoucherWhereInput = {
  origin: "PORTAL",
  status: { notIn: ["PENDING_REVIEW", "REJECTED", "CANCELLED"] },
  reviewedAt: null,
  NOT: { reviewFlags: { isEmpty: true } },
}

export type ValidationCounts = { pending: number; toVerify: number }

export async function validationCounts(
  ctx: Pick<FirmContext, "firmId">
): Promise<ValidationCounts> {
  const [pending, toVerify] = await Promise.all([
    db.ipmVoucher.count({ where: { firmId: ctx.firmId, ...PENDING } }),
    db.ipmVoucher.count({ where: { firmId: ctx.firmId, ...TO_VERIFY } }),
  ])
  return { pending, toVerify }
}

export type ReviewHistoryRow = {
  id: string
  number: string
  issueDate: Date
  status: string
  totalAmount: number
  providerName: string
}

export type ReviewItem = {
  id: string
  number: string
  type: string
  status: string
  issueDate: Date
  createdAt: Date
  beneficiaryName: string
  memberId: string
  memberMatricule: string
  providerName: string
  serviceTypeLabel: string
  categoryLabel: string
  totalAmount: number
  insurerShare: number
  memberShare: number
  appliedRate: number
  ocrTotal: number | null
  entryMode: string | null
  receiptUrl: string | null
  flags: string[]
  lines: { id: string; label: string; quantity: number; unitPrice: number; amount: number }[]
  /** The beneficiary's last 5 bons in the same category, this one excluded. */
  history: ReviewHistoryRow[]
}

async function listFor(
  ctx: FirmContext,
  where: Prisma.IpmVoucherWhereInput,
  orderBy: Prisma.IpmVoucherOrderByWithRelationInput[]
): Promise<ReviewItem[]> {
  const rows = await db.ipmVoucher.findMany({
    where: { firmId: ctx.firmId, ...where },
    orderBy,
    take: 100,
    select: {
      id: true,
      number: true,
      type: true,
      status: true,
      issueDate: true,
      createdAt: true,
      beneficiaryName: true,
      memberId: true,
      dependentId: true,
      categoryId: true,
      totalAmount: true,
      insurerShare: true,
      memberShare: true,
      appliedRate: true,
      ocrTotal: true,
      entryMode: true,
      receiptUrl: true,
      reviewFlags: true,
      member: { select: { matricule: true } },
      provider: { select: { name: true } },
      serviceType: { select: { label: true } },
      category: { select: { label: true } },
      lines: {
        orderBy: { createdAt: "asc" },
        select: { id: true, label: true, quantity: true, unitPrice: true, amount: true },
      },
    },
  })

  // One query per row, at most a hundred, on an indexed (firmId, memberId)
  // path. A queue this size does not justify a window function.
  const histories = await Promise.all(
    rows.map((row) =>
      db.ipmVoucher.findMany({
        where: {
          firmId: ctx.firmId,
          memberId: row.memberId,
          dependentId: row.dependentId,
          categoryId: row.categoryId,
          id: { not: row.id },
        },
        orderBy: { issueDate: "desc" },
        take: 5,
        select: {
          id: true,
          number: true,
          issueDate: true,
          status: true,
          totalAmount: true,
          provider: { select: { name: true } },
        },
      })
    )
  )

  return rows.map((row, index) => ({
    id: row.id,
    number: row.number,
    type: row.type,
    status: row.status,
    issueDate: row.issueDate,
    createdAt: row.createdAt,
    beneficiaryName: row.beneficiaryName,
    memberId: row.memberId,
    memberMatricule: row.member.matricule,
    providerName: row.provider.name,
    serviceTypeLabel: row.serviceType.label,
    categoryLabel: row.category.label,
    totalAmount: Number(row.totalAmount),
    insurerShare: Number(row.insurerShare),
    memberShare: Number(row.memberShare),
    appliedRate: Number(row.appliedRate),
    ocrTotal: row.ocrTotal === null ? null : Number(row.ocrTotal),
    entryMode: row.entryMode,
    receiptUrl: row.receiptUrl,
    flags: row.reviewFlags,
    lines: row.lines.map((line) => ({
      id: line.id,
      label: line.label,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPrice),
      amount: Number(line.amount),
    })),
    history: histories[index].map((h) => ({
      id: h.id,
      number: h.number,
      issueDate: h.issueDate,
      status: h.status,
      totalAmount: Number(h.totalAmount),
      providerName: h.provider.name,
    })),
  }))
}

export function listPendingReview(ctx: FirmContext): Promise<ReviewItem[]> {
  return listFor(ctx, PENDING, [{ createdAt: "asc" }])
}

export function listToVerify(ctx: FirmContext): Promise<ReviewItem[]> {
  return listFor(ctx, TO_VERIFY, [{ createdAt: "asc" }])
}
