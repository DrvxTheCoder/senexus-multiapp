/**
 * Proves the IPM module boundary over real HTTP.
 *
 * §7 of the plan asks for one guarantee: no health data is readable from
 * Connect Interim or Synergie Pro, and a right on the HR side confers nothing
 * on the health side. That is an authorisation claim, and authorisation claims
 * are only ever settled by a real request carrying a real session — a unit test
 * over `nav-config` proves the link is hidden, not that the route refuses.
 *
 * So this harness signs in as two accounts that differ only in what they are
 * members of, and fires the same URLs at both:
 *
 *   - an IPM account reaches /ipm-tawfeikh/ipm and nothing else in that firm;
 *   - an HR manager with full rights on both HR firms gets 404 on their /ipm,
 *     because the module is not installed there, and 403 on the IPM firm,
 *     because they are not a member of it;
 *   - the sidebar offers the IPM link in one firm and not in the others.
 *
 * Unlike check:admin and check:hr this exercises no server action, so it runs
 * against a dev server as well as a production one:
 *
 *   pnpm dev          (or: pnpm build && pnpm start)
 *   pnpm check:ipm
 */
import { PrismaClient } from "@prisma/client"
import { hash } from "bcryptjs"

const BASE = process.env.HARNESS_BASE_URL ?? "http://localhost:3000"
const PASSWORD = "harness-senexus-1"

const IPM_SLUG = "ipm-tawfeikh"
const HR_SLUGS = ["connect-interim", "synergie-pro"]

const db = new PrismaClient()

function assertLocalDatabase() {
  const url = process.env.DATABASE_URL ?? ""
  const host = url.match(/@([^:/?]+)/)?.[1] ?? ""
  if (!["localhost", "127.0.0.1", "::1", ""].includes(host)) {
    throw new Error(`Refusing to run: DATABASE_URL points at ${host}.`)
  }
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                   */

type Session = { label: string; cookie: string }

function mergeCookies(jar: Map<string, string>, response: Response) {
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(";")
    const index = pair.indexOf("=")
    if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1))
  }
}

function jarHeader(jar: Map<string, string>): string {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ")
}

async function signIn(email: string, label: string): Promise<Session> {
  const jar = new Map<string, string>()

  const csrfResponse = await fetch(`${BASE}/api/auth/csrf`)
  mergeCookies(jar, csrfResponse)
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string }

  const response = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: jarHeader(jar),
    },
    body: new URLSearchParams({
      csrfToken,
      email,
      password: PASSWORD,
      callbackUrl: `${BASE}/`,
    }),
  })
  mergeCookies(jar, response)

  const cookie = jarHeader(jar)
  if (!/authjs\.session-token/.test(cookie)) {
    throw new Error(`Sign-in failed for ${email} (status ${response.status}).`)
  }
  return { label, cookie }
}

async function get(session: Session | null, path: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    headers: session ? { Cookie: session.cookie } : {},
    redirect: "manual",
  })
}

/* -------------------------------------------------------------------------- */

let failures = 0

function check(label: string, passed: boolean, detail = "") {
  if (!passed) failures += 1
  console.log(`  ${passed ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`)
}

async function expectStatus(
  session: Session | null,
  path: string,
  expected: number
) {
  const response = await get(session, path)
  check(
    `${session?.label ?? "anonymous"} → ${path} = ${expected}`,
    response.status === expected,
    response.status === expected ? "" : `got ${response.status}`
  )
  return response
}

/* -------------------------------------------------------------------------- */
/* Harness accounts                                                           */

async function ensureUser(email: string, name: string) {
  const passwordHash = await hash(PASSWORD, 10)
  return db.user.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, name, passwordHash, emailVerified: new Date() },
  })
}

async function ensureMembership(userId: string, firmId: string, role: "OWNER" | "MANAGER") {
  await db.userFirm.upsert({
    where: { userId_firmId: { userId, firmId } },
    update: { role },
    create: { userId, firmId, role },
  })
}

/* -------------------------------------------------------------------------- */

async function main() {
  assertLocalDatabase()

  const firms = await db.firm.findMany({
    where: { slug: { in: [IPM_SLUG, ...HR_SLUGS] } },
    select: { id: true, slug: true, holdingId: true },
  })
  const bySlug = Object.fromEntries(firms.map((firm) => [firm.slug, firm]))

  for (const slug of [IPM_SLUG, ...HR_SLUGS]) {
    if (!bySlug[slug]) {
      throw new Error(`Firm ${slug} is missing — run \`pnpm db:seed:dev\` first.`)
    }
  }

  // All three sit under one holding, which is what makes the test meaningful:
  // the HR account is *inside* the group and still cannot read the IPM.
  const holdings = new Set(firms.map((firm) => firm.holdingId))
  check("the three firms share one holding", holdings.size === 1)

  console.log("\nModule installation")
  const installed = await db.firmModule.findMany({
    where: { firm: { slug: { in: [IPM_SLUG, ...HR_SLUGS] } }, isEnabled: true },
    select: { firm: { select: { slug: true } }, module: { select: { slug: true } } },
  })
  const modulesOf = (slug: string) =>
    installed.filter((row) => row.firm.slug === slug).map((row) => row.module.slug).sort()

  check(`${IPM_SLUG} has ipm and only ipm`, JSON.stringify(modulesOf(IPM_SLUG)) === '["ipm"]',
    modulesOf(IPM_SLUG).join(", "))
  for (const slug of HR_SLUGS) {
    check(`${slug} does not have ipm`, !modulesOf(slug).includes("ipm"), modulesOf(slug).join(", "))
  }

  /* ---- accounts --------------------------------------------------------- */

  const ipmUser = await ensureUser("ipm.harness@senexus.local", "Harness IPM")
  const hrUser = await ensureUser("hr.harness@senexus.local", "Harness RH")

  await ensureMembership(ipmUser.id, bySlug[IPM_SLUG].id, "OWNER")
  for (const slug of HR_SLUGS) {
    await ensureMembership(hrUser.id, bySlug[slug].id, "MANAGER")
  }
  // Explicitly *not* a member of the IPM firm. The absence is the test.
  await db.userFirm.deleteMany({
    where: { userId: hrUser.id, firmId: bySlug[IPM_SLUG].id },
  })

  const ipm = await signIn("ipm.harness@senexus.local", "IPM")
  const hr = await signIn("hr.harness@senexus.local", "RH")

  /* ---- the module reaches its own firm ---------------------------------- */

  console.log("\nThe IPM module answers inside its own firm")
  const landing = await expectStatus(ipm, `/${IPM_SLUG}/ipm`, 200)
  const html = await landing.text()
  check(
    "the landing page renders for a firm with no HR data",
    html.includes("Prévoyance maladie"),
    html.length < 400 ? html.slice(0, 200) : ""
  )
  check(
    "the sidebar offers the IPM link there",
    html.includes(`/${IPM_SLUG}/ipm`)
  )

  console.log("\nThe IPM firm exposes nothing else")
  await expectStatus(ipm, `/${IPM_SLUG}/hr/employees`, 404)
  await expectStatus(ipm, `/${IPM_SLUG}/hr/contracts`, 404)
  await expectStatus(ipm, `/${IPM_SLUG}/crm/clients`, 404)
  await expectStatus(ipm, `/${IPM_SLUG}/documents`, 404)

  console.log("\nThe dashboard survives a firm with no employees at all")
  await expectStatus(ipm, `/${IPM_SLUG}/dashboard`, 200)

  /* ---- and cannot be reached from the HR firms -------------------------- */

  console.log("\nHR rights confer nothing on the health side")
  for (const slug of HR_SLUGS) {
    await expectStatus(hr, `/${slug}/ipm`, 404)
  }
  // Same holding, no membership: 403, not 404 — the firm is not hidden from a
  // colleague, its contents are.
  await expectStatus(hr, `/${IPM_SLUG}/ipm`, 403)
  await expectStatus(hr, `/${IPM_SLUG}/dashboard`, 403)

  console.log("\nThe sidebar hides what the gate refuses")
  const hrDashboard = await get(hr, `/${HR_SLUGS[0]}/dashboard`)
  const hrHtml = await hrDashboard.text()
  check("HR dashboard renders", hrDashboard.status === 200, `got ${hrDashboard.status}`)
  check("no IPM link in an HR firm's sidebar", !hrHtml.includes(`/${HR_SLUGS[0]}/ipm`))

  console.log("\nAn anonymous request reaches nothing")
  const anonymous = await get(null, `/${IPM_SLUG}/ipm`)
  check(
    `anonymous → /${IPM_SLUG}/ipm is refused`,
    anonymous.status !== 200,
    `got ${anonymous.status}`
  )

  /* ---- cleanup ---------------------------------------------------------- */

  console.log("\nCleanup")
  await db.userFirm.deleteMany({ where: { userId: { in: [ipmUser.id, hrUser.id] } } })
  await db.user.deleteMany({ where: { id: { in: [ipmUser.id, hrUser.id] } } })
  console.log("  harness accounts removed")

  console.log(
    failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) FAILED.\n`
  )
  process.exitCode = failures === 0 ? 0 : 1
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
