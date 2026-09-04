import { z } from "zod"

import { paginationSchema, sortSpecSchema } from "@/lib/queries/query-primitives"

/**
 * The employee query — shape only, no database. Same split as the contract
 * query: the URL parsers and the filter bar run in the browser and need this;
 * the resolver needs Prisma and must never reach the client.
 */

export const EMPLOYEE_STATUSES = [
  "ACTIVE",
  "INACTIVE",
  "SUSPENDED",
  "TERMINATED",
  "ON_LEAVE",
] as const

export const CONTRACT_TYPES = ["CDI", "CDD", "INTERIM", "STAGE", "PRESTATION"] as const

export const EMPLOYEE_SORT_IDS = [
  "name",
  "matricule",
  "client",
  "contract",
  "ceiling",
  "seniority",
  "status",
] as const

/**
 * `incomplete` surfaces records missing something the payroll or the labour
 * inspectorate will eventually ask for. It feeds the Décisions queue, so the
 * definition lives with the query rather than in a screen.
 */
export const INCOMPLETE_REASONS = ["cni", "contact", "contract"] as const
export type IncompleteReason = (typeof INCOMPLETE_REASONS)[number]

export const employeeQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.array(z.enum(EMPLOYEE_STATUSES)).optional(),
  contractType: z.array(z.enum(CONTRACT_TYPES)).optional(),
  clientId: z.array(z.string()).optional(),
  departmentId: z.array(z.string()).optional(),
  interimDaysMin: z.coerce.number().int().min(0).max(2000).optional(),
  interimDaysMax: z.coerce.number().int().min(0).max(2000).optional(),
  incomplete: z.array(z.enum(INCOMPLETE_REASONS)).optional(),
  sort: z.array(sortSpecSchema).default([]),
  ...paginationSchema,
  columns: z.array(z.string()).optional(),
})

export type EmployeeQuery = z.infer<typeof employeeQuerySchema>

export const EMPTY_EMPLOYEE_QUERY: EmployeeQuery = employeeQuerySchema.parse({})
