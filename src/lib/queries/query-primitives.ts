import { z } from "zod"

/**
 * §3.5 — shared vocabulary for every list resource, with no database in it.
 *
 * Filtering, sorting, pagination, faceted counts, export, saved views and
 * "select all matching" are all the same query. These are the pieces each
 * resource schema is assembled from, so the URL, the saved view, the export
 * and the bulk action cannot drift apart.
 *
 * Lives under `lib` rather than `server` because the filter bar and the URL
 * parsers run in the browser and need exactly these pieces.
 */

export const sortSpecSchema = z.object({
  id: z.string(),
  desc: z.boolean().default(false),
})

export type SortSpec = z.infer<typeof sortSpecSchema>

/** Page size is capped: no caller may ask the server to materialise the world. */
export const paginationSchema = {
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(10).max(200).default(25),
}

