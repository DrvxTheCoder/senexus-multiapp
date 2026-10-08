import { timingSafeEqual } from "node:crypto"

import { db } from "@/lib/db"
import { expireAwaitingVouchers } from "@/server/ipm/voucher-amount"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/cron/expire-vouchers — marks EXPIRED every bon de pharmacie still
 * waiting for its amount past its deadline. `Authorization: Bearer
 * $CRON_SECRET`; unset, the route answers 503 rather than running open.
 *
 * Meant to run every hour or so from the host's scheduler. Nothing depends on
 * its timing: a validation refuses an overdue bon by its date whether or not
 * this has run, and the screens read an overdue bon as expired already. What
 * it adds is the stored status — the back-office filter, the dead QR.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 16) {
    return Response.json({ error: "NOT_CONFIGURED" }, { status: 503 })
  }
  const given = Buffer.from(
    /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? ""
  )
  const expected = Buffer.from(secret)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })
  }

  return Response.json(await expireAwaitingVouchers(db))
}
