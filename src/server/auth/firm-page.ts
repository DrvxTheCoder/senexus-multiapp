import "server-only"

import { forbidden, notFound, unauthorized } from "next/navigation"
import type { FirmRole } from "@prisma/client"

import {
  requireFirmAccess,
  requireModule,
  type FirmContext,
} from "@/server/auth/require-firm-access"
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "@/server/errors"

/**
 * `requireFirmAccess` for pages and layouts.
 *
 * Next renders a layout and its page *in parallel*, so both reach the access
 * check independently. If only the layout converted the typed error, the page
 * would still throw an uncaught one on every 403 and 404 — the request would
 * render correctly but log a spurious error and report it as a crash.
 *
 * Route handlers and server actions do not use this: they keep the typed error
 * and map it to a status with `statusForError`.
 */
export async function requireFirmPage(
  firmSlug: string,
  options: { minimumRole?: FirmRole; module?: string } = {}
): Promise<FirmContext> {
  try {
    const ctx = await requireFirmAccess(firmSlug, options.minimumRole)
    if (options.module) {
      requireModule(ctx, options.module)
    }
    return ctx
  } catch (error) {
    if (error instanceof UnauthorizedError) unauthorized()
    if (error instanceof ForbiddenError) forbidden()
    if (error instanceof NotFoundError) notFound()
    throw error
  }
}
