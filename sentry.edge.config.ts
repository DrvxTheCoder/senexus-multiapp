import * as Sentry from "@sentry/nextjs"

import { scrubEvent } from "@/lib/telemetry/scrub"

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: process.env.NEXT_PUBLIC_SENTRY_DISABLED !== "true",
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  sendDefaultPii: false,
  beforeSend: scrubEvent,
})
