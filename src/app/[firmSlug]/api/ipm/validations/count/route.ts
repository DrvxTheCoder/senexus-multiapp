import { requireFirmAccess, requireModule } from "@/server/auth/require-firm-access"
import { isAccessError, statusForError } from "@/server/errors"
import { validationCounts } from "@/server/queries/ipm/validations"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET — `{ pending, toVerify }` for the Validations badge.
 *
 * Polled by the sidebar every 30 s and on focus, so it is two indexed counts
 * and nothing else. Same gate as the page: IPM module, MANAGER.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ firmSlug: string }> }
) {
  const { firmSlug } = await params
  try {
    const ctx = await requireFirmAccess(firmSlug, "MANAGER")
    requireModule(ctx, "ipm")
    return Response.json(await validationCounts(ctx), {
      headers: { "Cache-Control": "private, no-store" },
    })
  } catch (error) {
    if (!isAccessError(error)) console.error("Validation count failed")
    return new Response(null, { status: statusForError(error) })
  }
}
