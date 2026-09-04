import { z } from "zod"

export {
  paginationSchema,
  sortSpecSchema,
  type SortSpec,
} from "@/lib/queries/query-primitives"

/**
 * Server-side result shapes. The query *inputs* live in
 * `src/lib/queries/query-primitives.ts` because the client needs them; what a
 * resolver returns is only ever read on the server.
 */

export type FacetBucket = {
  value: string
  label: string
  count: number
}

export type Facets = Record<string, FacetBucket[]>

export type Paged<TRow> = {
  rows: TRow[]
  total: number
  page: number
  perPage: number
  pageCount: number
  facets: Facets
}

/**
 * A bulk action takes a *query*, not an array of ids, so "select all 396
 * matching" costs nothing to express. `except` carries the rows the user
 * unticked after selecting everything.
 */
export const selectionSchema = <TQuery extends z.ZodTypeAny>(query: TQuery) =>
  z.union([
    z.object({ ids: z.array(z.string()).min(1) }),
    z.object({
      query,
      except: z.array(z.string()).default([]),
    }),
  ])

export type Selection<TQuery> =
  | { ids: string[] }
  | { query: TQuery; except: string[] }

export function isIdSelection<TQuery>(
  selection: Selection<TQuery>
): selection is { ids: string[] } {
  return "ids" in selection
}

/** Number of rows a selection covers, for the bulk bar and confirmations. */
export type SelectionSummary = {
  count: number
  /** True when the selection was expressed as a query rather than as ids. */
  fromQuery: boolean
}
