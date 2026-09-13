import { searchTerms } from "@/server/queries/search-terms"

/**
 * The Prisma half of multi-term search — see `search-terms.ts` for why the
 * box is split at all.
 *
 * Callers describe the searchable columns once, as a function from one term to
 * the OR branches for that term. This builds the AND-of-ORs: every word has to
 * match at least one branch, so "Fatou Diop" is satisfied by the first and last
 * name columns between them.
 *
 * `contains` needs no wildcard escaping — Prisma parameterises the value and
 * does not treat `%` or `_` as wildcards, unlike raw `ILIKE`.
 */
export function searchWhere<W>(
  raw: string,
  branches: (contains: { contains: string; mode: "insensitive" }) => W[]
): { AND: { OR: W[] }[] } | undefined {
  const terms = searchTerms(raw)
  if (!terms.length) return undefined

  const and = terms.map((term) => ({
    OR: branches({ contains: term, mode: "insensitive" as const }),
  }))

  return and.length ? { AND: and } : undefined
}
