/**
 * Rebuilds the demo database from nothing: every migration, then the seed.
 *
 *   pnpm db:reset:demo
 *
 * `prisma migrate reset` drops the whole schema — users, firms, everything —
 * so this refuses to run unless DATABASE_URL names a database with `demo` in
 * it. That is the only guard, and it is deliberately blunt: a production or
 * shared development URL does not contain the word, so pointing .env at one
 * makes this script stop instead of wiping it.
 *
 * Once that check has passed, the seed's own remote pin is satisfied for the
 * same target (`--allow-remote=host:port/db`), since the reset just above it
 * has already done far more than the seed will.
 */
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"

if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile(".env")

const url = process.env.DATABASE_URL ?? ""
if (!url.toLowerCase().includes("demo")) {
  console.error(
    "Refusing to reset: DATABASE_URL does not contain \"demo\".\n" +
      "This drops every table. Point DATABASE_URL at the demo database first, e.g.\n\n" +
      '  $env:DATABASE_URL="postgresql://user:pass@localhost:5432/senexus_demo"; pnpm db:reset:demo\n'
  )
  process.exit(1)
}

let pin = ""
try {
  const u = new URL(url)
  pin = `${u.hostname}:${u.port || "5432"}/${decodeURIComponent(u.pathname.replace(/^\//, ""))}`
} catch {
  console.error("Refusing to reset: DATABASE_URL is unparseable.")
  process.exit(1)
}

function run(command, args) {
  console.log(`\n> ${command} ${args.join(" ")}`)
  const result = spawnSync(command, args, { stdio: "inherit", shell: true, env: process.env })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run("npx", ["prisma", "migrate", "reset", "--force", "--skip-seed"])
run("node", ["prisma/seed.dev.mjs", `--allow-remote=${pin}`])
