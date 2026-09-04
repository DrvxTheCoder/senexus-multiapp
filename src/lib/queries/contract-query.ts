import { z } from "zod"

import { paginationSchema, sortSpecSchema } from "@/lib/queries/query-primitives"

/**
 * The contract query — the *shape*, with no database in it.
 *
 * This is deliberately separate from the resolver in
 * `src/server/queries/contracts.ts`. The URL parsers, the filter bar and the
 * saved views all need the schema, and they run in the browser; the resolver
 * needs Prisma, and must never reach it. Keeping the schema here is what lets
 * `server-only` stay on the resolver, so a future import cannot quietly drag
 * the database into a client bundle.
 */

export const CONTRACT_TYPES = ["CDI", "CDD", "INTERIM", "STAGE", "PRESTATION"] as const
export const CONTRACT_STATUSES = ["ACTIVE", "EXPIRED", "TERMINATED", "RENEWED"] as const

export const CONTRACT_SORT_IDS = [
  "employee",
  "type",
  "client",
  "period",
  "remaining",
  "ceiling",
  "visa",
  "status",
] as const

export const contractQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  type: z.array(z.enum(CONTRACT_TYPES)).optional(),
  status: z.array(z.enum(CONTRACT_STATUSES)).optional(),
  clientId: z.array(z.string()).optional(),
  departmentId: z.array(z.string()).optional(),
  /** `true` = visa obtained, `false` = still awaiting the labour inspectorate. */
  vise: z.boolean().optional(),
  /** Active contracts whose endDate falls inside this many days. */
  expiringWithin: z.coerce.number().int().min(1).max(400).optional(),
  /** Cumulative interim days, computed in SQL by the resolver. */
  interimDaysMin: z.coerce.number().int().min(0).max(2000).optional(),
  interimDaysMax: z.coerce.number().int().min(0).max(2000).optional(),
  sort: z.array(sortSpecSchema).default([]),
  ...paginationSchema,
  columns: z.array(z.string()).optional(),
})

export type ContractQuery = z.infer<typeof contractQuerySchema>

export const EMPTY_CONTRACT_QUERY: ContractQuery = contractQuerySchema.parse({})
