import { z } from "zod"

import { paginationSchema, sortSpecSchema } from "@/lib/queries/query-primitives"

export const VOUCHER_STATUSES = [
  "ISSUED",
  "PRESENTED",
  "SETTLED",
  "INVOICED",
  "CANCELLED",
  "EXPIRED",
] as const

export const VOUCHER_TYPES = [
  "PHARMACY",
  "OPTICAL",
  "GUARANTEE",
  "HOSPITALIZATION",
] as const

export const VOUCHER_SORT_IDS = [
  "number",
  "issueDate",
  "beneficiary",
  "provider",
  "totalAmount",
  "insurerShare",
  "status",
] as const

export const voucherQuerySchema = z.object({
  /** Matches the number, the beneficiary and both matricule forms. */
  search: z.string().trim().max(120).optional(),
  status: z.array(z.enum(VOUCHER_STATUSES)).optional(),
  type: z.array(z.enum(VOUCHER_TYPES)).optional(),
  providerId: z.array(z.string()).optional(),
  categoryId: z.array(z.string()).optional(),
  memberId: z.string().optional(),
  /** Bons issued on or after this date. */
  from: z.string().optional(),
  to: z.string().optional(),
  sort: z.array(sortSpecSchema).default([]),
  ...paginationSchema,
})

export type VoucherQuery = z.infer<typeof voucherQuerySchema>

export const EMPTY_VOUCHER_QUERY: VoucherQuery = voucherQuerySchema.parse({})

export const VOUCHER_STATUS_LABELS: Record<
  (typeof VOUCHER_STATUSES)[number],
  string
> = {
  ISSUED: "Émis",
  PRESENTED: "Présenté",
  SETTLED: "Réglé",
  INVOICED: "Facturé",
  CANCELLED: "Annulé",
  EXPIRED: "Expiré",
}

export const VOUCHER_STATUS_TONES: Record<
  (typeof VOUCHER_STATUSES)[number],
  "ok" | "signal" | "alert" | "muted" | "brand"
> = {
  ISSUED: "signal",
  PRESENTED: "brand",
  SETTLED: "ok",
  INVOICED: "ok",
  CANCELLED: "muted",
  EXPIRED: "alert",
}

export const VOUCHER_TYPE_LABELS: Record<
  (typeof VOUCHER_TYPES)[number],
  string
> = {
  PHARMACY: "Pharmacie",
  OPTICAL: "Optique",
  GUARANTEE: "Garantie",
  HOSPITALIZATION: "Hospitalisation",
}

/** The legacy document family each type corresponds to, shown beside the code. */
export const VOUCHER_TYPE_PREFIX: Record<
  (typeof VOUCHER_TYPES)[number],
  string
> = {
  PHARMACY: "BPI",
  OPTICAL: "BCI",
  GUARANTEE: "LGI",
  HOSPITALIZATION: "LHI",
}
