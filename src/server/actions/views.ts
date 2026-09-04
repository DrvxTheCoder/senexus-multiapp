"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { Prisma } from "@prisma/client"

import { requireFirmAccess } from "@/server/auth/require-firm-access"
import { createSavedView, deleteSavedView } from "@/server/queries/saved-views"

/**
 * Saved views, for every resource.
 *
 * A view is a serialised query in `DashboardView.config` (§3.5). The stored
 * shape is the URL parameter set rather than the parsed query, so restoring a
 * view is exactly "put these parameters in the URL" — the same path a pasted
 * link takes, with no second deserialiser to keep in step.
 */

type Resource =
  | "contracts"
  | "employees"
  | "clients"
  | "documents"
  | "leaves"
  | "transfers"

/** Only JSON-safe scalars and arrays of them ever reach the column. */
const storedQuerySchema = z.record(
  z.string(),
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(z.union([z.string(), z.number()])),
  ])
)

export async function saveResourceView(
  firmSlug: string,
  resource: Resource,
  name: string,
  query: unknown
): Promise<void> {
  const ctx = await requireFirmAccess(firmSlug)
  const parsed = storedQuerySchema.parse(query)

  // A saved view is a filter, not a position in a result set.
  delete parsed.page

  await createSavedView(ctx, {
    name,
    resource,
    query: parsed as Prisma.InputJsonObject,
  })

  revalidatePath(`/${firmSlug}`, "layout")
}

export async function removeResourceView(
  firmSlug: string,
  id: string
): Promise<void> {
  const ctx = await requireFirmAccess(firmSlug)
  await deleteSavedView(ctx, id)
  revalidatePath(`/${firmSlug}`, "layout")
}
