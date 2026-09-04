/**
 * Stable colour for a client dot (§4.7). Categorical, never semantic: it
 * distinguishes clients in a table, it does not encode state. Deterministic so
 * the same client keeps its colour across pages and reloads.
 */
export function clientDotVar(clientId: string): string {
  let hash = 0
  for (let i = 0; i < clientId.length; i += 1) {
    hash = (hash * 31 + clientId.charCodeAt(i)) >>> 0
  }
  return `var(--sx-dot-${(hash % 8) + 1})`
}
