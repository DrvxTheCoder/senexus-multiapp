import * as Sentry from "@sentry/nextjs"

import { scrubEvent } from "@/lib/telemetry/scrub"

/**
 * Browser telemetry.
 *
 * @sentry/nextjs v10 loads this file instead of the `sentry.client.config.ts`
 * the brief names — the file was renamed upstream. The `tunnel` is not
 * optional: ad blockers drop direct reports to a third-party host, so client
 * events go through our own route (see src/app/api/glitchtip-tunnel/route.ts).
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: process.env.NEXT_PUBLIC_SENTRY_DISABLED !== "true",
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  sendDefaultPii: false,
  tunnel: "/api/glitchtip-tunnel",
  beforeSend: scrubEvent,
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
