/**
 * Splitting a search box into terms.
 *
 * Every list in the app matches the search box against a handful of columns
 * with OR. That works for one word and silently fails for two: "Fatou Diop"
 * becomes `firstName ILIKE '%Fatou Diop%' OR lastName ILIKE '%Fatou Diop%'`,
 * and neither column ever holds both halves, so a participant who is plainly
 * in the table comes back as no results.
 *
 * The fix is to split on whitespace and require *every* term to match
 * *somewhere* — AND across terms, OR across columns. "Fatou Diop" then asks
 * for a row matching "Fatou" and matching "Diop", which the two name columns
 * satisfy between them. Typing more words keeps narrowing, which is what the
 * box looks like it does.
 *
 * No `server-only` marker: this is string handling with no database access.
 */

/** Terms longer than this are the user leaning on the keyboard, not a name. */
const MAX_TERM_LENGTH = 100

/** More terms than this narrows nothing and only costs us clauses. */
const MAX_TERMS = 8

/**
 * Splits a raw search box value into the terms every column set must satisfy.
 *
 * Returns `[]` for a blank box — callers treat that as "no search predicate"
 * rather than as a predicate matching nothing.
 */
export function searchTerms(raw: string): string[] {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => term.slice(0, MAX_TERM_LENGTH))
    .slice(0, MAX_TERMS)
}

/**
 * Escapes the LIKE wildcards so a literal `%` or `_` typed into the box is
 * matched as itself. Without this a lone `%` matches every row in the table.
 *
 * The backslash is the default LIKE escape character in Postgres, so the
 * callers need no `ESCAPE` clause.
 */
export function likeEscape(term: string): string {
  return term.replace(/[\\%_]/g, "\\$&")
}

/** A term wrapped as a case-insensitive "contains" pattern for SQL `ILIKE`. */
export function likePattern(term: string): string {
  return `%${likeEscape(term)}%`
}
