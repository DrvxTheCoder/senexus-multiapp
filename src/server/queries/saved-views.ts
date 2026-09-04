import "server-only"

import { Prisma } from "@prisma/client"

import { db } from "@/lib/db"
import type { FirmContext } from "@/server/auth/require-firm-access"
import { UI_STATE_VIEW_NAME } from "@/server/preferences/ui-state"

/**
 * §3.5 — a saved view is a serialised query, stored in `DashboardView.config`.
 *
 * The schema already had the right model and the old application never used
 * it. Nothing new is invented: `{ firmId, userId, name, config Json }` is
 * exactly a named query belonging to a person inside a firm.
 *
 * `resource` distinguishes a contracts view from an employees view, and lives
 * inside `config` because the model has no column for it.
 */

export type SavedView = {
  id: string
  name: string
  resource: string
  /** The serialised query. Shape is owned by the resource, not by this module. */
  query: Record<string, unknown>
  updatedAt: Date
}

type StoredConfig = {
  resource?: unknown
  query?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function listSavedViews(
  ctx: FirmContext,
  resource: string
): Promise<SavedView[]> {
  const rows = await db.dashboardView.findMany({
    where: {
      firmId: ctx.firmId,
      userId: ctx.userId,
      // The reserved chrome-state row is not a saved view.
      name: { not: UI_STATE_VIEW_NAME },
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, config: true, updatedAt: true },
  })

  return rows.flatMap((row) => {
    const config = row.config as StoredConfig | null
    if (!isRecord(config) || config.resource !== resource) return []
    const query = isRecord(config.query) ? config.query : {}
    return [
      {
        id: row.id,
        name: row.name,
        resource,
        query,
        updatedAt: row.updatedAt,
      },
    ]
  })
}

export async function createSavedView(
  ctx: FirmContext,
  // The stored query must be JSON by construction, so the input is typed as
  // Prisma expects rather than widened to a record and cast on the way in.
  input: { name: string; resource: string; query: Prisma.InputJsonObject }
): Promise<SavedView> {
  const name = input.name.trim()
  if (!name || name === UI_STATE_VIEW_NAME) {
    throw new Error("Nom de vue invalide.")
  }

  const row = await db.dashboardView.create({
    data: {
      firmId: ctx.firmId,
      userId: ctx.userId,
      name,
      config: { resource: input.resource, query: input.query },
    },
    select: { id: true, name: true, updatedAt: true },
  })

  return { ...row, resource: input.resource, query: input.query }
}

export async function renameSavedView(
  ctx: FirmContext,
  id: string,
  name: string
): Promise<void> {
  // Scoped by firm *and* user: a view belongs to one person in one firm.
  const { count } = await db.dashboardView.updateMany({
    where: { id, firmId: ctx.firmId, userId: ctx.userId },
    data: { name: name.trim() },
  })
  if (count === 0) throw new Error("Vue introuvable.")
}

export async function deleteSavedView(
  ctx: FirmContext,
  id: string
): Promise<void> {
  const { count } = await db.dashboardView.deleteMany({
    where: {
      id,
      firmId: ctx.firmId,
      userId: ctx.userId,
      name: { not: UI_STATE_VIEW_NAME },
    },
  })
  if (count === 0) throw new Error("Vue introuvable.")
}
