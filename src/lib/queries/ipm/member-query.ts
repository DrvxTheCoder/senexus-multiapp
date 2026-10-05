import { z } from "zod"

import { paginationSchema, sortSpecSchema } from "@/lib/queries/query-primitives"

export const MEMBER_STATUSES = [
  "PENDING",
  "ACTIVE",
  "SUSPENDED",
  "TERMINATED",
] as const

/**
 * Portal access, as a filter: the account's status, or NONE for a participant
 * who has no account yet — the value that finds whom to invite next.
 */
export const MEMBER_PORTAL_STATES = ["NONE", "INVITED", "ACTIVE", "LOCKED"] as const

export type MemberPortalState = (typeof MEMBER_PORTAL_STATES)[number]

export const MEMBER_PORTAL_LABELS: Record<MemberPortalState, string> = {
  NONE: "Sans accès",
  INVITED: "Invité",
  ACTIVE: "Actif",
  LOCKED: "Suspendu",
}

export const MEMBER_PORTAL_TONES: Record<
  MemberPortalState,
  "ok" | "signal" | "alert" | "muted"
> = {
  NONE: "muted",
  INVITED: "signal",
  ACTIVE: "ok",
  LOCKED: "alert",
}

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
  portal: z.array(z.enum(MEMBER_PORTAL_STATES)).optional(),
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
