import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

/**
 * Vitest does not read `.env` — Vite only exposes `VITE_`-prefixed variables,
 * and never on `process.env`. Reading it here is what lets the card tests
 * assert against the origin this deployment is actually configured with,
 * rather than against a URL copied into a test file.
 *
 * That matters because the QR budget is measured in characters: a longer
 * domain is the realistic way the code stops fitting on the card, and a test
 * holding its own copy of the origin would never notice.
 *
 * `vite`'s own `loadEnv` would do this, but it is not a direct dependency —
 * only a transitive one through vitest — so a five-line reader is preferred to
 * importing something this project does not declare.
 */
function readEnvFile(name: string): Record<string, string> {
  let contents: string
  try {
    contents = readFileSync(new URL(name, import.meta.url), "utf8")
  } catch {
    // Gitignored, so absent on CI and on a fresh clone. That is expected.
    return {}
  }

  const values: Record<string, string> = {}
  // Split on CRLF as well as LF. A stray `\r` is a line terminator to the
  // regex engine, so `(.*)$` will not match across one — the file parses as
  // empty and the fallback takes over silently.
  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line)
    if (!match) continue
    values[match[1]!] = match[2]!.trim().replace(/^["']|["']$/g, "")
  }
  return values
}

const env = readEnvFile("./.env")

/**
 * The fallback keeps the suite runnable without a `.env`. It is a test default
 * in one labelled place, not an origin baked into application code — and the
 * assertions that depend on it are written as budget properties, so they stay
 * meaningful whichever value is in force.
 */
const APP_URL = env.AUTH_URL || env.NEXTAUTH_URL || "http://localhost:3000"

export default defineConfig({
  test: {
    // Node by default; the component smoke tests opt into jsdom with a
    // `@vitest-environment jsdom` docblock, so the domain tests stay fast.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    env: {
      AUTH_URL: APP_URL,
      NEXTAUTH_URL: APP_URL,
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws when imported outside a React Server Component.
      // Domain logic under test is plain TypeScript, so it is stubbed here.
      "server-only": fileURLToPath(new URL("./src/test/server-only.ts", import.meta.url)),
    },
  },
})
