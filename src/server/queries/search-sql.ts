import { Prisma } from "@prisma/client"

import { likePattern, searchTerms } from "@/server/queries/search-terms"

/**
 * The raw-SQL half of multi-term search — see `search-terms.ts` for why the
 * box is split at all.
 *
 * AND across terms, OR across columns: every word the user typed has to match
 * at least one of the columns, so "Fatou Diop" is satisfied by the first and
 * last name columns between them.
 */
export function searchPredicate(
  raw: string,
  columns: Prisma.Sql[]
): Prisma.Sql | undefined {
  const terms = searchTerms(raw)
  if (!terms.length || !columns.length) return undefined

  const perTerm = terms.map((term) => {
    const pattern = likePattern(term)
    const matches = columns.map((column) => Prisma.sql`${column} ILIKE ${pattern}`)
    return Prisma.sql`(${Prisma.join(matches, " OR ")})`
  })

  return Prisma.sql`(${Prisma.join(perTerm, " AND ")})`
}
