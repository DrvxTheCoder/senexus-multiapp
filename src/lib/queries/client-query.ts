import { z } from "zod"

import { paginationSchema, sortSpecSchema } from "@/lib/queries/query-primitives"

export const CLIENT_STATUSES = ["ACTIVE", "INACTIVE", "PROSPECT", "ARCHIVED"] as const

export const CLIENT_SORT_IDS = [
  "name",
  "status",
  "placed",
  "payroll",
  "nextExpiry",
] as const

export const clientQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.array(z.enum(CLIENT_STATUSES)).optional(),
  industry: z.array(z.string()).optional(),
  /** Clients with an active contract ending inside this many days. */
  expiringWithin: z.coerce.number().int().min(1).max(400).optional(),
  sort: z.array(sortSpecSchema).default([]),
  ...paginationSchema,
})

export type ClientQuery = z.infer<typeof clientQuerySchema>

export const EMPTY_CLIENT_QUERY: ClientQuery = clientQuerySchema.parse({})
