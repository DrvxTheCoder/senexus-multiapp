"use server"

import { requireFirmAccess } from "@/server/auth/require-firm-access"
import { searchFirm, type SearchHit } from "@/server/queries/search"

/**
 * The palette talks to the server through this action rather than a route
 * handler: it is a read that must be authorised and firm-scoped, and an action
 * gets `requireFirmAccess` for free without a second URL to protect.
 */
export async function commandSearch(
  firmSlug: string,
  term: string
): Promise<SearchHit[]> {
  const ctx = await requireFirmAccess(firmSlug)
  return searchFirm(term, ctx)
}
