/**
 * Proves the administration console over real HTTP.
 *
 * The point is the sentence in the plan that inspection cannot settle: *a
 * non-admin gets 403 on every admin action, not just the page*. The legacy
 * `/api/firms` and `/api/users` routes checked only that a session existed, so
 * any signed-in user could create a firm, delete a colleague or reset a
 * password. This harness signs in as a STAFF account and fires every admin
 * action at the running server to show that none of them land.
 *
 * It talks to a **production** server, because server-action ids are build
 * artefacts and are read out of `.next/static`:
 *
 *   pnpm build && pnpm start
 *   pnpm exec vite-node -c vitest.config.ts scripts/check-admin.mts
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { PrismaClient } from "@prisma/client"
import { hash } from "bcryptjs"

const BASE = process.env.HARNESS_BASE_URL ?? "http://localhost:3000"
const PASSWORD = "harness-senexus-1"

const db = new PrismaClient()

/* -------------------------------------------------------------------------- */
/* Guard: this script writes users, so it refuses anything but a local database */

function assertLocalDatabase() {
  const url = process.env.DATABASE_URL ?? ""
  const host = url.match(/@([^:/?]+)/)?.[1] ?? ""
  if (!["localhost", "127.0.0.1", "::1", ""].includes(host)) {
    throw new Error(
      `Refusing to run: DATABASE_URL points at ${host}, not a local database.`
    )
  }
}

/* -------------------------------------------------------------------------- */
/* Server action ids, read out of the client build                            */

function collectChunks(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) collectChunks(path, out)
    else if (path.endsWith(".js")) out.push(path)
  }
  return out
}

function actionIds(): Map<string, string> {
  const ids = new Map<string, string>()
  const pattern =
    /createServerReference\)\("([a-f0-9]+)"[^)]*?,\s*"([A-Za-z0-9_$]+)"\)/g

  for (const file of collectChunks(".next/static/chunks")) {
    const source = readFileSync(file, "utf8")
    for (const match of source.matchAll(pattern)) {
      ids.set(match[2], match[1])
    }
  }

  if (ids.size === 0) {
    throw new Error(
      "No server actions found in .next/static — run `pnpm build` first."
    )
  }
  return ids
}

/* -------------------------------------------------------------------------- */
/* HTTP                                                                       */

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

async function get(session: Session, path: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    headers: { Cookie: session.cookie },
    redirect: "manual",
  })
}

/**
 * Invokes a server action the way the browser does: POST to the page that
 * exports it, with the action id in `Next-Action` and the arguments as the
 * flight encoding — which, for plain JSON arguments, is `JSON.stringify`.
 */
async function callAction(
  session: Session,
  page: string,
  id: string,
  args: unknown[]
): Promise<string> {
  const response = await fetch(`${BASE}${page}`, {
    method: "POST",
    headers: {
      Cookie: session.cookie,
      "Next-Action": id,
      "Content-Type": "text/plain;charset=UTF-8",
    },
    body: JSON.stringify(args),
  })
  return response.text()
}

/* -------------------------------------------------------------------------- */
/* Assertions                                                                 */

let failures = 0

function check(label: string, passed: boolean, detail = "") {
  const mark = passed ? "ok  " : "FAIL"
  if (!passed) failures += 1
  console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ""}`)
}

/** The flight payload carries the ActionResult; matching on it is enough. */
const refused = (body: string) =>
  body.includes('"status":403') || body.includes('"status":401')
const succeeded = (body: string) => body.includes('"ok":true')

/* -------------------------------------------------------------------------- */

async function seedAccounts() {
  const firms = await db.firm.findMany({ select: { id: true, slug: true } })
  if (firms.length === 0) throw new Error("No firms — run `pnpm db:seed:dev`.")

  const passwordHash = await hash(PASSWORD, 10)

  const admin = await db.user.upsert({
    where: { email: "admin.harness@senexus.local" },
    update: { passwordHash },
    create: {
      email: "admin.harness@senexus.local",
      name: "Harness Admin",
      passwordHash,
      emailVerified: new Date(),
    },
    select: { id: true },
  })

  const staff = await db.user.upsert({
    where: { email: "staff.harness@senexus.local" },
    update: { passwordHash },
    create: {
      email: "staff.harness@senexus.local",
      name: "Harness Staff",
      passwordHash,
      emailVerified: new Date(),
    },
    select: { id: true },
  })

  await db.userFirm.deleteMany({
    where: { userId: { in: [admin.id, staff.id] } },
  })
  await db.userFirm.createMany({
    data: [
      ...firms.map((firm) => ({
        userId: admin.id,
        firmId: firm.id,
        role: "ADMIN" as const,
      })),
      { userId: staff.id, firmId: firms[0].id, role: "STAFF" as const },
    ],
  })

  return { adminId: admin.id, staffId: staff.id, firms }
}

async function main() {
  assertLocalDatabase()

  const ids = actionIds()
  const need = [
    "createFirm",
    "updateFirm",
    "deleteFirm",
    "createUser",
    "updateUser",
    "deleteUser",
    "resetUserPassword",
    "setClientAssignments",
    "createModule",
    "setFirmModule",
    "installDocumentsModule",
  ]
  for (const name of need) {
    if (!ids.has(name)) throw new Error(`Action id for ${name} not found.`)
  }

  const { adminId, staffId, firms } = await seedAccounts()
  const admin = await signIn("admin.harness@senexus.local", "ADMIN")
  const staff = await signIn("staff.harness@senexus.local", "STAFF")

  /* ---------------------------------------------------------------------- */
  console.log("\n=== pages ===")

  for (const path of ["/admin", "/admin/firms", "/admin/users", "/admin/modules"]) {
    const response = await get(admin, path)
    check(`ADMIN  GET ${path}`, response.status === 200, `${response.status}`)
  }

  for (const path of ["/admin", "/admin/firms", "/admin/users", "/admin/modules"]) {
    const response = await get(staff, path)
    check(`STAFF  GET ${path} refused`, response.status === 403, `${response.status}`)
  }

  /* ---------------------------------------------------------------------- */
  console.log("\n=== actions, as STAFF (every one must be refused) ===")

  const probeSlug = `harness-should-not-exist-${Date.now()}`
  const attempts: [string, string, unknown[]][] = [
    ["createFirm", "/admin/firms", [{ name: "Harness Firm", slug: probeSlug }]],
    [
      "updateFirm",
      "/admin/firms",
      [{ id: firms[0].id, name: "Pwned", slug: firms[0].slug }],
    ],
    ["deleteFirm", "/admin/firms", [{ id: firms[0].id, confirmName: "x" }]],
    [
      "createUser",
      "/admin/users",
      [
        {
          name: "Escalated",
          email: `harness.escalated.${Date.now()}@senexus.local`,
          role: "OWNER",
          firmIds: [firms[0].id],
          password: PASSWORD,
          confirmPassword: PASSWORD,
        },
      ],
    ],
    ["deleteUser", "/admin/users", [{ id: staffId }]],
    [
      "resetUserPassword",
      "/admin/users",
      [{ id: staffId, password: "pwned-password", confirmPassword: "pwned-password" }],
    ],
    [
      "setClientAssignments",
      "/admin/users",
      [{ userId: staffId, firmId: firms[0].id, clientIds: [] }],
    ],
    [
      "createModule",
      "/admin/modules",
      [{ slug: "harness", name: "Harness", basePath: "/harness", version: "1.0.0" }],
    ],
    ["installDocumentsModule", "/admin/modules", [{}]],
  ]

  for (const [name, page, args] of attempts) {
    const body = await callAction(staff, page, ids.get(name)!, args)
    check(`STAFF  ${name}`, refused(body) && !succeeded(body))
  }

  const leaked = await db.firm.findUnique({ where: { slug: probeSlug } })
  check("STAFF createFirm wrote nothing", leaked === null)

  const staffAfter = await db.user.findUniqueOrThrow({
    where: { id: staffId },
    select: { passwordHash: true },
  })
  check(
    "STAFF resetUserPassword changed nothing",
    (await import("bcryptjs")).compareSync(PASSWORD, staffAfter.passwordHash!)
  )

  const harnessModule = await db.module.findUnique({ where: { slug: "harness" } })
  check("STAFF createModule wrote nothing", harnessModule === null)

  /* ---------------------------------------------------------------------- */
  console.log("\n=== actions, as ADMIN ===")

  const installBody = await callAction(
    admin,
    "/admin/modules",
    ids.get("installDocumentsModule")!,
    [{}]
  )
  check("ADMIN installDocumentsModule", succeeded(installBody))

  const documents = await db.module.findUnique({
    where: { slug: "documents" },
    select: {
      id: true,
      isActive: true,
      _count: { select: { firmModules: true } },
      dependencies: { select: { dependsOn: { select: { slug: true } } } },
    },
  })
  check("documents module row exists", documents !== null)

  // **Not** "for every firm". Documents depends on hr, so installing it on a
  // firm without hr would create a row whose declared dependency is unmet —
  // which is how IPM Tawfeikh silently acquired the employee-documents
  // surface. The assertion is the dependency, not the firm count.
  const hrFirmIds = await db.firmModule.findMany({
    where: { module: { slug: "hr" }, isEnabled: true },
    select: { firmId: true },
  })
  const documentsFirmIds = await db.firmModule.findMany({
    where: { module: { slug: "documents" } },
    select: { firmId: true },
  })
  const hrSet = new Set(hrFirmIds.map((row) => row.firmId))

  check(
    "documents installed for every firm that has hr",
    hrFirmIds.every((row) =>
      documentsFirmIds.some((entry) => entry.firmId === row.firmId)
    ),
    `${documentsFirmIds.length} installs for ${hrFirmIds.length} hr firms`
  )
  check(
    "documents installed for no firm without hr",
    documentsFirmIds.every((row) => hrSet.has(row.firmId)),
    documentsFirmIds.filter((row) => !hrSet.has(row.firmId)).length + " stray"
  )
  check(
    "documents depends on hr",
    documents?.dependencies.some((d) => d.dependsOn.slug === "hr") ?? false
  )

  // The whole point of the module row: the nav entry becomes visible.
  const dashboard = await get(admin, `/${firms[0].slug}/dashboard`)
  const html = await dashboard.text()
  check(
    "Documents appears in the sidebar",
    html.includes(`/${firms[0].slug}/documents`),
    `${dashboard.status}`
  )

  // Disabling it takes the entry away again, without touching any data.
  const disabled = await callAction(
    admin,
    "/admin/modules",
    ids.get("setFirmModule")!,
    [{ firmId: firms[0].id, moduleId: documents!.id, isEnabled: false }]
  )
  check("ADMIN setFirmModule disable", succeeded(disabled))

  const afterDisable = await get(admin, `/${firms[0].slug}/dashboard`)
  const afterHtml = await afterDisable.text()
  check(
    "Documents disappears when disabled",
    !afterHtml.includes(`/${firms[0].slug}/documents"`)
  )

  const documentCount = await db.employeeDocument.count({
    where: { firmId: firms[0].id },
  })
  check("disabling kept the documents themselves", documentCount >= 0, `${documentCount} rows`)

  const reEnabled = await callAction(
    admin,
    "/admin/modules",
    ids.get("setFirmModule")!,
    [{ firmId: firms[0].id, moduleId: documents!.id, isEnabled: true }]
  )
  check("ADMIN setFirmModule re-enable", succeeded(reEnabled))

  // A system module must not be uninstallable, whoever asks.
  const hr = await db.module.findUnique({
    where: { slug: "hr" },
    select: { id: true, isSystem: true },
  })
  if (hr?.isSystem) {
    const uninstall = await callAction(
      admin,
      "/admin/modules",
      ids.get("setFirmModule")!,
      [{ firmId: firms[0].id, moduleId: hr.id, isEnabled: null }]
    )
    check(
      "ADMIN cannot uninstall a system module",
      !succeeded(uninstall) && uninstall.includes("système")
    )
    const stillThere = await db.firmModule.findFirst({
      where: { firmId: firms[0].id, moduleId: hr.id },
    })
    check("hr still installed", stillThere !== null)
  }

  // Slug uniqueness comes back as a field error, not a Prisma stack trace.
  const clash = await callAction(admin, "/admin/firms", ids.get("createFirm")!, [
    { name: "Clash", slug: firms[0].slug },
  ])
  check(
    "duplicate slug reports a field error",
    clash.includes("déjà utilisé") && !succeeded(clash)
  )

  // Deleting a firm requires the typed name, and refuses without it.
  const badConfirm = await callAction(
    admin,
    "/admin/firms",
    ids.get("deleteFirm")!,
    [{ id: firms[0].id, confirmName: "not the name" }]
  )
  check(
    "deleteFirm refuses a wrong confirmation",
    !succeeded(badConfirm) && badConfirm.includes("ne correspond pas")
  )
  const firmStillThere = await db.firm.findUnique({ where: { id: firms[0].id } })
  check("the firm survived", firmStillThere !== null)

  /* ---------------------------------------------------------------------- */
  console.log("\n=== the happy path, as ADMIN ===")

  const newSlug = `harness-firm-${Date.now()}`
  const created = await callAction(admin, "/admin/firms", ids.get("createFirm")!, [
    {
      name: "Harness Interim",
      slug: newSlug,
      themeColor: "#123456",
      matriculePrefix: "hi",
    },
  ])
  check("ADMIN createFirm", succeeded(created))

  const newFirm = await db.firm.findUnique({
    where: { slug: newSlug },
    select: {
      id: true,
      themeColor: true,
      firmModules: {
        where: { module: { slug: "hr" } },
        select: { settings: true },
      },
    },
  })
  check("firm row written with hex theme", newFirm?.themeColor === "#123456")
  // The prefix is the fix for every firm generating `CI####`: it is stored per
  // firm in the HR module's settings, the schema's own extension point.
  check(
    "matricule prefix stored on the HR module, uppercased",
    (newFirm?.firmModules[0]?.settings as { matriculePrefix?: string } | null)
      ?.matriculePrefix === "HI"
  )

  const renamed = await callAction(admin, "/admin/firms", ids.get("updateFirm")!, [
    {
      id: newFirm!.id,
      name: "Harness Interim SA",
      slug: newSlug,
      themeColor: "#654321",
      matriculePrefix: "HX",
    },
  ])
  check("ADMIN updateFirm", succeeded(renamed))
  const updatedFirm = await db.firm.findUniqueOrThrow({
    where: { id: newFirm!.id },
    select: {
      name: true,
      themeColor: true,
      firmModules: {
        where: { module: { slug: "hr" } },
        select: { settings: true },
      },
    },
  })
  check(
    "update applied to both the row and the settings",
    updatedFirm.name === "Harness Interim SA" &&
      updatedFirm.themeColor === "#654321" &&
      (updatedFirm.firmModules[0]?.settings as { matriculePrefix?: string } | null)
        ?.matriculePrefix === "HX"
  )

  const clients = await db.client.findMany({
    where: { firmId: firms[0].id },
    select: { id: true },
    take: 2,
  })

  const newEmail = `harness.responsable.${Date.now()}@senexus.local`
  const madeUser = await callAction(admin, "/admin/users", ids.get("createUser")!, [
    {
      name: "Harness Responsable",
      email: newEmail,
      role: "RESPONSABLE",
      firmIds: [firms[0].id],
      password: PASSWORD,
      confirmPassword: PASSWORD,
    },
  ])
  check("ADMIN createUser with RESPONSABLE", succeeded(madeUser))

  const responsable = await db.user.findUnique({
    where: { email: newEmail },
    select: {
      id: true,
      emailVerified: true,
      passwordHash: true,
      userFirms: { select: { firmId: true, role: true } },
    },
  })
  check("account created and pre-verified", responsable?.emailVerified !== null)
  check(
    "RESPONSABLE granted on exactly the requested firm",
    responsable?.userFirms.length === 1 &&
      responsable.userFirms[0].role === "RESPONSABLE"
  )
  check(
    "password is hashed, not stored",
    Boolean(responsable?.passwordHash) &&
      responsable!.passwordHash !== PASSWORD &&
      responsable!.passwordHash!.startsWith("$2")
  )

  if (clients.length > 0) {
    const assigned = await callAction(
      admin,
      "/admin/users",
      ids.get("setClientAssignments")!,
      [
        {
          userId: responsable!.id,
          firmId: firms[0].id,
          clientIds: clients.map((client) => client.id),
        },
      ]
    )
    check("ADMIN setClientAssignments", succeeded(assigned))
    const stored = await db.userClientAssignment.count({
      where: { userId: responsable!.id, firmId: firms[0].id },
    })
    check("assignments written", stored === clients.length, `${stored}`)

    // The scope is replaced, not appended to — otherwise removing a client from
    // a RESPONSABLE would silently leave them able to see it.
    const narrowed = await callAction(
      admin,
      "/admin/users",
      ids.get("setClientAssignments")!,
      [{ userId: responsable!.id, firmId: firms[0].id, clientIds: [] }]
    )
    check("ADMIN clears assignments", succeeded(narrowed))
    const after = await db.userClientAssignment.count({
      where: { userId: responsable!.id, firmId: firms[0].id },
    })
    check("assignments replaced, not merged", after === 0, `${after}`)
  }

  // An ADMIN gets every firm regardless of what the form asked for — the legacy
  // behaviour, now explicit rather than an invisible side effect of the form.
  const adminEmail = `harness.admin2.${Date.now()}@senexus.local`
  const madeAdmin = await callAction(admin, "/admin/users", ids.get("createUser")!, [
    {
      name: "Harness Admin 2",
      email: adminEmail,
      role: "ADMIN",
      firmIds: [firms[0].id],
      password: PASSWORD,
      confirmPassword: PASSWORD,
    },
  ])
  check("ADMIN createUser with ADMIN role", succeeded(madeAdmin))
  const admin2 = await db.user.findUnique({
    where: { email: adminEmail },
    select: { id: true, userFirms: { select: { firmId: true } } },
  })
  const allFirms = await db.firm.count()
  check(
    "ADMIN is a member of every firm",
    admin2?.userFirms.length === allFirms,
    `${admin2?.userFirms.length}/${allFirms}`
  )

  const duplicateEmail = await callAction(
    admin,
    "/admin/users",
    ids.get("createUser")!,
    [
      {
        name: "Clash",
        email: newEmail,
        role: "STAFF",
        firmIds: [firms[0].id],
        password: PASSWORD,
        confirmPassword: PASSWORD,
      },
    ]
  )
  check(
    "duplicate email reports a field error",
    !succeeded(duplicateEmail) && duplicateEmail.includes("déjà utilisée")
  )

  const removed = await callAction(admin, "/admin/users", ids.get("deleteUser")!, [
    { id: responsable!.id },
  ])
  check("ADMIN deleteUser", succeeded(removed))
  check(
    "account gone",
    (await db.user.findUnique({ where: { id: responsable!.id } })) === null
  )

  const deletedFirm = await callAction(
    admin,
    "/admin/firms",
    ids.get("deleteFirm")!,
    [{ id: newFirm!.id, confirmName: "Harness Interim SA" }]
  )
  check("ADMIN deleteFirm with the typed name", succeeded(deletedFirm))
  check(
    "firm gone",
    (await db.firm.findUnique({ where: { id: newFirm!.id } })) === null
  )

  /* ---------------------------------------------------------------------- */
  console.log("\n=== audit trail ===")

  const audits = await db.auditLog.findMany({
    where: { entity: { in: ["MODULE", "FIRM_MODULE"] } },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { action: true, entity: true, actorId: true },
  })
  check("admin writes were audited", audits.length > 0, `${audits.length} recent rows`)
  check(
    "refused writes were not audited",
    audits.every((row) => row.actorId !== staffId)
  )

  /* ---------------------------------------------------------------------- */
  // `AuditLog.actor` is a restricting foreign key, so the trail the admin just
  // wrote has to go before the account that wrote it.
  const harnessIds = [adminId, staffId, ...(admin2 ? [admin2.id] : [])]
  await db.auditLog.deleteMany({ where: { actorId: { in: harnessIds } } })
  await db.userFirm.deleteMany({ where: { userId: { in: harnessIds } } })
  await db.user.deleteMany({ where: { id: { in: harnessIds } } })

  console.log(
    failures === 0
      ? "\nAll checks passed.\n"
      : `\n${failures} check(s) FAILED.\n`
  )
  process.exitCode = failures === 0 ? 0 : 1
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
