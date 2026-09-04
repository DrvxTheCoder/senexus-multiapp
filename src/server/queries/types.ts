import { z } from "zod"

/**
 * §3.5 — shared vocabulary for every list resource.
 *
 * Filtering, sorting, pagination, faceted counts, export, saved views and
 * "select all matching" are all the same query. These are the pieces each
 * resource schema is assembled from, so the URL, the saved view, the export
 * and the bulk action cannot drift apart.
 */

export const sortSpecSchema = z.object({
  id: z.string(),
  desc: z.boolean().default(false),
})

export type SortSpec = z.infer<typeof sortSpecSchema>

/** Page size is capped: no caller may ask the server to materialise the world. */
export const paginationSchema = {
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(10).max(200).default(50),
}

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
