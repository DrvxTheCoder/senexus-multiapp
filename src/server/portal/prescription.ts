import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"

import { appOrigin } from "@/lib/app-url"
import { portalTokenSecret } from "@/server/portal/auth"

/**
 * L'ordonnance — medical data, so never a public link.
 *
 * The file is stored on Zipline like every other upload, but its Zipline URL
 * is never sent to a client. What the API hands out instead is a link to
 * `/api/portail/prescriptions/{voucherId}`, signed for that bon and valid for
 * a few minutes, and **minted only for a caller already authorised to read
 * it**: the participant whose family the bon belongs to, or the session of the
 * pharmacy it is bound to. The route checks the signature and streams the
 * bytes from Zipline itself.
 *
 * A signed link rather than a bearer header because the portal shows the file
 * in an `<img>` or a new tab, neither of which can carry a header. Short-lived
 * so a link copied out of the page stops working before it can travel far.
 * The back office reads it through its own session-checked route.
 */

export const PRESCRIPTION_LINK_TTL_SECONDS = 10 * 60

function signature(voucherId: string, exp: number, secret: string): string {
  return createHmac("sha256", secret)
    .update(`prescription:${voucherId}:${exp}`)
    .digest("base64url")
}

export function prescriptionLink(voucherId: string, now: Date = new Date()): string {
  const exp = Math.floor(now.getTime() / 1000) + PRESCRIPTION_LINK_TTL_SECONDS
  const sig = signature(voucherId, exp, portalTokenSecret())
  return `${appOrigin()}/api/portail/prescriptions/${encodeURIComponent(voucherId)}?exp=${exp}&sig=${sig}`
}

export function verifyPrescriptionLink(
  voucherId: string,
  exp: string | null,
  sig: string | null,
  now: Date = new Date(),
  secret: string = portalTokenSecret()
): boolean {
  if (!exp || !sig || !/^\d{1,12}$/.test(exp)) return false
  const expiry = Number(exp)
  if (Math.floor(now.getTime() / 1000) >= expiry) return false
  const a = Buffer.from(sig)
  const b = Buffer.from(signature(voucherId, expiry, secret))
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Streams a stored ordonnance. The response is private and never cached: a
 * shared cache keeping a prescription is the leak this whole file prevents.
 */
export async function streamPrescription(
  storedUrl: string,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  const upstream = await fetch(storedUrl, { cache: "no-store" })
  if (!upstream.ok || !upstream.body) {
    return new Response("Ordonnance indisponible.", { status: 502, headers: extraHeaders })
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...extraHeaders,
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
