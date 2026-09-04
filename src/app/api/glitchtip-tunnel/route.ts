/**
 * §7 — client-side error tunnel.
 *
 * Ad blockers drop direct browser reports to a telemetry host, so the browser
 * posts envelopes here and this route forwards them server-side. The GlitchTip
 * key never reaches the client.
 *
 * The route is intentionally public (it is in the proxy allow-list): an
 * unauthenticated page that crashes still needs to report. It forwards the raw
 * body untouched and returns no upstream detail.
 */
export const runtime = "nodejs"

const MAX_ENVELOPE_BYTES = 200_000

export async function POST(request: Request) {
  const url = process.env.GLITCHTIP_URL
  const key = process.env.GLITCHTIP_KEY
  const projectId = process.env.GLITCHTIP_PROJECT_ID

  if (!url || !key || !projectId) {
    return new Response(null, { status: 204 })
  }

  const body = await request.text()

  if (body.length > MAX_ENVELOPE_BYTES) {
    return new Response(null, { status: 413 })
  }

  const target =
    `${url.replace(/\/$/, "")}/api/${projectId}/envelope/` +
    `?sentry_version=7&sentry_key=${encodeURIComponent(key)}`

  try {
    const upstream = await fetch(target, {
      method: "POST",
      body,
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      cache: "no-store",
    })

    return new Response(null, { status: upstream.ok ? 200 : 502 })
  } catch {
    // A telemetry outage must never surface as an application error.
    return new Response(null, { status: 204 })
  }
}
