import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // §2.1 — Turbopack is the default in 16 and there is deliberately no webpack
  // config here; adding one would fail the build without --webpack.
  reactCompiler: true,
  experimental: {
    // Enables `unauthorized()` and `forbidden()`, which the access errors from
    // src/server/errors.ts map onto.
    authInterrupts: true,
  },
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  poweredByHeader: false,
}

export default nextConfig
