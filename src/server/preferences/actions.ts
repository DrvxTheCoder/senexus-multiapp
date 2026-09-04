"use server"

import { requireFirmAccess } from "@/server/auth/require-firm-access"
import { setUiState } from "@/server/preferences/ui-state"

/**
 * Persists sidebar collapse per user per firm. Like every server action, it
 * calls `requireFirmAccess` first and takes the slug from the caller rather
 * than trusting an id from the client.
 */
export async function setSidebarCollapsed(
  firmSlug: string,
  collapsed: boolean
): Promise<void> {
  const ctx = await requireFirmAccess(firmSlug)
  await setUiState(ctx.userId, ctx.firmId, { sidebarCollapsed: collapsed })
}
