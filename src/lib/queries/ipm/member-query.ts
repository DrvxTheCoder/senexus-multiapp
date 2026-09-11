import { z } from "zod"

import { paginationSchema, sortSpecSchema } from "@/lib/queries/query-primitives"

export const MEMBER_STATUSES = [
  "PENDING",
  "ACTIVE",
  "SUSPENDED",
  "TERMINATED",
] as const

export const MEMBER_SORT_IDS = [
  "name",
  "matricule",
  "employer",
  "status",
  "affiliationDate",
  "dependents",
  "contribution",
] as const

export const memberQuerySchema = z.object({
  /** Matches name, matricule **and** legacyCode — see the resolver. */
  search: z.string().trim().max(120).optional(),
  status: z.array(z.enum(MEMBER_STATUSES)).optional(),
  employerId: z.array(z.string()).optional(),
  /** Only participants who have at least one ayant droit, or none. */
  withDependents: z.boolean().optional(),
  sort: z.array(sortSpecSchema).default([]),
  ...paginationSchema,
})

export type MemberQuery = z.infer<typeof memberQuerySchema>

export const EMPTY_MEMBER_QUERY: MemberQuery = memberQuerySchema.parse({})

export const MEMBER_STATUS_LABELS: Record<
  (typeof MEMBER_STATUSES)[number],
  string
> = {
  PENDING: "En attente",
  ACTIVE: "Actif",
  SUSPENDED: "Suspendu",
  TERMINATED: "Radié",
}

export const MEMBER_STATUS_TONES: Record<
  (typeof MEMBER_STATUSES)[number],
  "ok" | "signal" | "alert" | "muted"
> = {
  PENDING: "signal",
  ACTIVE: "ok",
  SUSPENDED: "alert",
  TERMINATED: "muted",
}
