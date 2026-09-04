import type { NextConfig } from "next"
import { withSentryConfig } from "@sentry/nextjs/config"

const nextConfig: NextConfig = {
  // §2.1 — Turbopack is the default in 16 and there is deliberately no webpack
  // config here; adding one would fail the build without --webpack.
  reactCompiler: true,
  productionBrowserSourceMaps: true,
  experimental: {
    // Enables `unauthorized()` and `forbidden()`, which the access errors from
    // src/server/errors.ts map onto.
    authInterrupts: true,
  },
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  poweredByHeader: false,
}

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  sentryUrl: process.env.GLITCHTIP_URL,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  silent: process.env.NODE_ENV !== "production",
  // Source maps are uploaded, then removed from the served bundle.
  sourcemaps: { deleteSourcemapsAfterUpload: true },
})
