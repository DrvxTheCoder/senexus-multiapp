import "server-only"

import { cache } from "react"
import { z } from "zod"

import { db } from "@/lib/db"

/**
 * Per-user UI chrome state, stored server-side as §5.1 requires.
 *
 * The schema has no preferences table and §1.1 forbids adding one, so this
 * lives in `DashboardView` — the model the brief points at for saved views —
 * under a reserved name. Rows named `__ui_state` are filtered out of the saved
 * views UI. Recorded as Q6 in docs/OPEN_QUESTIONS.md.
 */
export const UI_STATE_VIEW_NAME = "__ui_state"

const uiStateSchema = z.object({
  sidebarCollapsed: z.boolean().default(false),
})

export type UiState = z.infer<typeof uiStateSchema>

const DEFAULT_UI_STATE: UiState = { sidebarCollapsed: false }

export const getUiState = cache(
  async (userId: string, firmId: string): Promise<UiState> => {
    const row = await db.dashboardView.findFirst({
      where: { userId, firmId, name: UI_STATE_VIEW_NAME },
      select: { config: true },
    })

    if (!row) return DEFAULT_UI_STATE

    const parsed = uiStateSchema.safeParse(row.config)
    return parsed.success ? parsed.data : DEFAULT_UI_STATE
  }
)

export async function setUiState(
  userId: string,
  firmId: string,
  patch: Partial<UiState>
): Promise<UiState> {
  const current = await getUiState(userId, firmId)
  const next = uiStateSchema.parse({ ...current, ...patch })

  const existing = await db.dashboardView.findFirst({
    where: { userId, firmId, name: UI_STATE_VIEW_NAME },
    select: { id: true },
  })

  if (existing) {
    await db.dashboardView.update({
      where: { id: existing.id },
      data: { config: next },
    })
  } else {
    await db.dashboardView.create({
      data: { userId, firmId, name: UI_STATE_VIEW_NAME, config: next },
    })
  }

  return next
}
