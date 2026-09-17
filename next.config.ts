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
  // Packages that must be resolved by Node rather than bundled, because they
  // reach for files on disk that a bundler cannot represent:
  //
  //   - `@resvg/resvg-js` loads a `.node` binary, which cannot sit in an ESM
  //     chunk at all;
  //   - `satori` loads `hb.wasm` through harfbuzzjs by path. Bundled, that
  //     path is rewritten to a location that does not exist and the card
  //     renderer dies at runtime with an ENOENT for `C:\ROOT\...` — a failure
  //     that only shows up in a production build, never in dev;
  //   - `sharp` is a native addon in the same position;
  //   - `@react-pdf/renderer` loads font files from `public/fonts/pdf/` by
  //     absolute path and pulls in `fontkit`, which reaches for its own data
  //     files the same way. Bundled, the paths are rewritten and every
  //     document renders with no text — the exact failure `satori` has above,
  //     and again only in a production build.
  serverExternalPackages: [
    "@prisma/client",
    "bcryptjs",
    "satori",
    "@resvg/resvg-js",
    "sharp",
    "@react-pdf/renderer",
  ],
  poweredByHeader: false,
}

export default nextConfig
