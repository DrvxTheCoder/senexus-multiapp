import { db } from "@/lib/db"
import { requirePortalAccount } from "@/server/portal/auth"
import type { NotificationsResponse } from "@/server/portal/contract"
import { json, portalRoute, preflight } from "@/server/portal/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** GET /api/portail/notifications — the account's unread notifications, newest first. */
export const GET = portalRoute(async (request) => {
  const principal = await requirePortalAccount(request)

  const rows = await db.portalNotification.findMany({
    where: { portalAccountId: principal.portalAccountId, readAt: null },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      kind: true,
      createdAt: true,
      readAt: true,
      voucher: {
        select: { id: true, number: true, status: true, reviewReason: true },
      },
    },
  })

  const body: NotificationsResponse = {
    notifications: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt ? row.readAt.toISOString() : null,
    })),
  }
  return json(body)
})

export const OPTIONS = preflight
