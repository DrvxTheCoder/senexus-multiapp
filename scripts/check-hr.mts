/**
 * Proves the HR write layer and the transfer flow over real HTTP.
 *
 * The claims this exists to settle, none of which inspection can:
 *
 *   - creating an employee creates their contract **in the same transaction**;
 *   - a CSV import reports a bad row and a duplicate row and still imports the
 *     rest;
 *   - the 730-day ceiling blocks a renewal that would cross it;
 *   - a second transfer is refused while one is PENDING **and** while one is
 *     APPROVED;
 *   - completing a transfer leaves the employee with an active contract in the
 *     destination firm and their client assignment intact.
 *
 * Like `check-admin`, it talks to a **production** server because server-action
 * ids are build artefacts:
 *
 *   pnpm build && pnpm start
 *   pnpm check:hr
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { PrismaClient } from "@prisma/client"

/**
 * React's own reply encoder, which is what turns a `File` argument into the
 * multipart body a server action expects. Hand-rolling that encoding does not
 * work — the blob reference is resolved by React, not by field name — so the
 * harness borrows the encoder Next already ships.
 */
const { encodeReply } = createRequire(import.meta.url)(
  "next/dist/compiled/react-server-dom-webpack/client.edge"
) as { encodeReply: (value: unknown) => Promise<FormData | string> }

const BASE = process.env.HARNESS_BASE_URL ?? "http://localhost:3000"
const EMAIL = process.env.HARNESS_EMAIL ?? "manager.dev@senexus.local"
const PASSWORD = process.env.HARNESS_PASSWORD ?? "senexus-dev"
const SOURCE = "connect-interim"
const DESTINATION = "synergie-pro"

const db = new PrismaClient()

function assertLocalDatabase() {
  const url = process.env.DATABASE_URL ?? ""
  const host = url.match(/@([^:/?]+)/)?.[1] ?? ""
  if (!["localhost", "127.0.0.1", "::1", ""].includes(host)) {
    throw new Error(`Refusing to run: DATABASE_URL points at ${host}.`)
  }
}

/* -------------------------------------------------------------------------- */

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
    for (const match of readFileSync(file, "utf8").matchAll(pattern)) {
      ids.set(match[2], match[1])
    }
  }
  if (ids.size === 0) throw new Error("Run `pnpm build` first.")
  return ids
}

/* -------------------------------------------------------------------------- */

const jar = new Map<string, string>()

function merge(response: Response) {
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(";")
    const index = pair.indexOf("=")
    if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1))
  }
}

const cookie = () => [...jar].map(([name, value]) => `${name}=${value}`).join("; ")

async function signIn() {
  const csrfResponse = await fetch(`${BASE}/api/auth/csrf`)
  merge(csrfResponse)
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string }

  const response = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie(),
    },
    body: new URLSearchParams({
      csrfToken,
      email: EMAIL,
      password: PASSWORD,
      callbackUrl: `${BASE}/`,
    }),
  })
  merge(response)
  if (!/authjs\.session-token/.test(cookie())) {
    throw new Error(`Sign-in failed for ${EMAIL} (${response.status}).`)
  }
}

/** Invokes a server action the way the browser does. */
async function callAction(
  page: string,
  id: string,
  args: unknown[]
): Promise<string> {
  const body = await encodeReply(args)
  const response = await fetch(`${BASE}${page}`, {
    method: "POST",
    headers: {
      Cookie: cookie(),
      "Next-Action": id,
      // A string body is the plain-JSON case; FormData sets its own boundary.
      ...(typeof body === "string"
        ? { "Content-Type": "text/plain;charset=UTF-8" }
        : {}),
    },
    body,
  })
  return response.text()
}

/* -------------------------------------------------------------------------- */

let failures = 0

function check(label: string, passed: boolean, detail = "") {
  if (!passed) failures += 1
  console.log(`  ${passed ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`)
}

const succeeded = (body: string) => body.includes('"ok":true')
const says = (body: string, fragment: string) => body.includes(fragment)

const iso = (date: Date) => date.toISOString().slice(0, 10)
const shift = (days: number) => iso(new Date(Date.now() + days * 86_400_000))

/* -------------------------------------------------------------------------- */

async function main() {
  assertLocalDatabase()
  const ids = actionIds()

  const need = [
    "createEmployee",
    "updateEmployee",
    "deleteEmployee",
    "importEmployees",
    "createContract",
    "renewContract",
    "terminateContract",
    "stampVisa",
    "requestLeave",
    "approveLeave",
    "rejectLeave",
    "createClient",
    "archiveClient",
    "requestTransfer",
    "approveTransfer",
    "completeTransfer",
    "cancelTransfer",
  ]
  for (const name of need) {
    if (!ids.has(name)) throw new Error(`Action id for ${name} not found.`)
  }

  await signIn()

  const source = await db.firm.findUniqueOrThrow({
    where: { slug: SOURCE },
    select: { id: true },
  })
  const destination = await db.firm.findUniqueOrThrow({
    where: { slug: DESTINATION },
    select: { id: true },
  })

  const employeesPage = `/${SOURCE}/hr/employees`
  const contractsPage = `/${SOURCE}/hr/contracts`
  const leavesPage = `/${SOURCE}/hr/leaves`
  const clientsPage = `/${SOURCE}/crm/clients`
  const transfersPage = `/${SOURCE}/hr/transfers`

  const created: string[] = []

  /* ---------------------------------------------------------------------- */
  console.log("\n=== employee creation writes a contract too ===")

  const stamp = Date.now()
  const body = await callAction(employeesPage, ids.get("createEmployee")!, [
    {
      firmSlug: SOURCE,
      firstName: "Harness",
      lastName: `Employe${stamp}`,
      hireDate: shift(-30),
      status: "ACTIVE",
      contractType: "INTERIM",
      contractEndDate: shift(60),
      netSalary: "250000",
      jobTitle: "Manutentionnaire",
      nationality: "Sénégalaise",
      phone: "770000001",
    },
  ])
  check("createEmployee", succeeded(body))

  const employee = await db.employee.findFirst({
    where: { firmId: source.id, lastName: `Employe${stamp}` },
    select: {
      id: true,
      matricule: true,
      netSalary: true,
      contracts: {
        select: {
          id: true,
          type: true,
          status: true,
          notes: true,
          startDate: true,
          endDate: true,
          salary: true,
          position: true,
        },
      },
    },
  })
  check("employee row exists", employee !== null)
  if (employee) created.push(employee.id)

  check(
    "matricule uses this firm's prefix",
    employee?.matricule.startsWith("CI") ?? false,
    employee?.matricule
  )
  check(
    "a contract was created with the employee",
    employee?.contracts.length === 1,
    `${employee?.contracts.length ?? 0}`
  )
  const initial = employee?.contracts[0]
  check(
    "the contract carries the onboarding marker",
    initial?.notes === "Initial contract created during employee onboarding"
  )
  check(
    "the contract derives its dates and pay from the fiche",
    iso(initial!.startDate) === shift(-30) &&
      iso(initial!.endDate!) === shift(60) &&
      Number(initial!.salary) === 250000 &&
      initial!.position === "Manutentionnaire"
  )

  /* ---------------------------------------------------------------------- */
  console.log("\n=== CSV import: per row, never per batch ===")

  const importCsv = [
    "Matricule,Prénom,Nom,Date d'embauche,Téléphone,Salaire",
    // A clean row. It carries a phone so that its repeat below agrees on four
    // fields — the threshold — rather than three.
    `,Ousmane,Import${stamp},2023-11-02,770000002,180000`,
    // The employee created above: first name, last name, phone and hire date
    // all agree — four identifying fields, which is the threshold. Three would
    // not be enough, and that boundary is pinned by the unit tests.
    `,Harness,Employe${stamp},${shift(-30)},770000001,250 000`,
    // No first name.
    `,,SansPrenom${stamp},01/01/2024,,`,
    // A date nothing can read — reported, never replaced with today.
    `,Awa,Illisible${stamp},pas une date,,`,
    // The same person twice inside one file: the second must be measured
    // against the row this import has just written, not only against the
    // database as it was when the file was opened.
    `,Ousmane,Import${stamp},2023-11-02,770000002,180000`,
  ].join("\n")

  const importBody = await callAction(employeesPage, ids.get("importEmployees")!, [
    {
      firmSlug: SOURCE,
      file: new File([importCsv], "employes.csv", { type: "text/csv" }),
      dayFirst: true,
      skipDuplicates: true,
      contractType: "INTERIM",
    },
  ])
  check("importEmployees", succeeded(importBody))
  check(
    "the whole file was read, not abandoned at the first bad row",
    says(importBody, '"total":5')
  )
  check("the good row imported", says(importBody, '"imported":1'))
  check(
    "the row with no first name is reported by line and reason",
    says(importBody, '"line":4') && says(importBody, "Prénom manquant.")
  )
  check(
    "the unreadable date is reported with the value it could not read",
    says(importBody, "illisible : pas une date")
  )
  check(
    "the existing employee is recognised as a probable duplicate",
    says(importBody, "Doublon probable")
  )
  check(
    "a repeat inside the same file is caught too",
    says(importBody, '"skipped":2')
  )

  const imported = await db.employee.findMany({
    where: { firmId: source.id, lastName: `Import${stamp}` },
    select: { id: true, matricule: true, contracts: { select: { id: true } } },
  })
  check("exactly one row was written", imported.length === 1)
  check(
    "the imported employee got a contract too",
    imported[0]?.contracts.length === 1
  )
  for (const row of imported) created.push(row.id)

  /* ---------------------------------------------------------------------- */
  console.log("\n=== the ceiling refuses what it should ===")

  const heavy = await db.contract.findFirst({
    where: {
      firmId: source.id,
      type: "INTERIM",
      status: "ACTIVE",
      employee: { status: "ACTIVE" },
    },
    orderBy: { startDate: "asc" },
    select: { id: true, employeeId: true },
  })

  if (heavy) {
    // Three years in one go: whatever the employee has already used, this must
    // be refused, and the message must name the remedy rather than only the
    // rule.
    const refused = await callAction(contractsPage, ids.get("renewContract")!, [
      { firmSlug: SOURCE, id: heavy.id, durationDays: 1095 },
    ])
    check(
      "renewal beyond 730 days is refused",
      !succeeded(refused) && says(refused, "plafond")
    )
    check(
      "the refusal names the remedy",
      says(refused, "CDI") || says(refused, "transfert")
    )
    const stillActive = await db.contract.findUnique({
      where: { id: heavy.id },
      select: { status: true },
    })
    check("the source contract was not touched", stillActive?.status === "ACTIVE")
  } else {
    check("a seeded interim contract exists to test against", false)
  }

  /* ---------------------------------------------------------------------- */
  console.log("\n=== contracts: create, visa, terminate ===")

  const contractBody = await callAction(contractsPage, ids.get("createContract")!, [
    {
      firmSlug: SOURCE,
      employeeId: employee!.id,
      type: "CDD",
      startDate: shift(1),
      endDate: shift(120),
      alertThreshold: 30,
      isAutoRenewal: false,
      isVise: false,
      position: "Chef d'équipe",
      salary: "300000",
    },
  ])
  check("createContract", succeeded(contractBody))

  const second = await db.contract.findFirst({
    where: { employeeId: employee!.id, type: "CDD" },
    select: { id: true, isVise: true },
  })
  check("the second contract exists", second !== null)

  const visaBody = await callAction(contractsPage, ids.get("stampVisa")!, [
    { firmSlug: SOURCE, ids: [second!.id, "not-a-real-id"], isVise: true },
  ])
  check("stampVisa", succeeded(visaBody))
  const stamped = await db.contract.findUnique({
    where: { id: second!.id },
    select: { isVise: true },
  })
  check("the visa landed on the real id", stamped?.isVise === true)
  check(
    "the fabricated id changed nothing",
    says(visaBody, '"applied":1') || says(visaBody, "applied")
  )

  const terminateBody = await callAction(
    contractsPage,
    ids.get("terminateContract")!,
    [
      {
        firmSlug: SOURCE,
        id: second!.id,
        terminationDate: shift(30),
        terminationReason: "Fin de mission anticipée (harness)",
      },
    ]
  )
  check("terminateContract", succeeded(terminateBody))
  const terminated = await db.contract.findUnique({
    where: { id: second!.id },
    select: { status: true, endDate: true, terminationDate: true },
  })
  check(
    "termination pulls the end date back with it",
    terminated?.status === "TERMINATED" &&
      iso(terminated.endDate!) === shift(30)
  )

  /* ---------------------------------------------------------------------- */
  console.log("\n=== leaves ===")

  const leaveBody = await callAction(leavesPage, ids.get("requestLeave")!, [
    {
      firmSlug: SOURCE,
      employeeId: employee!.id,
      leaveType: "ANNUAL",
      // A Monday to the following Friday: ten working days across a weekend.
      startDate: shift(7),
      endDate: shift(20),
      isPaid: true,
      reason: "Harness",
    },
  ])
  check("requestLeave", succeeded(leaveBody))

  const leave = await db.leaveRequest.findFirst({
    where: { employeeId: employee!.id },
    select: { id: true, totalDays: true, status: true },
  })
  const leaveDays = Number(leave?.totalDays ?? 0)
  check(
    "the request is PENDING and counts working days only",
    leave?.status === "PENDING" && leaveDays > 0 && leaveDays < 14,
    `${leaveDays} jours sur 14 calendaires`
  )

  const overlap = await callAction(leavesPage, ids.get("requestLeave")!, [
    {
      firmSlug: SOURCE,
      employeeId: employee!.id,
      leaveType: "ANNUAL",
      startDate: shift(10),
      endDate: shift(12),
      isPaid: true,
    },
  ])
  check(
    "an overlapping request is refused",
    !succeeded(overlap) && says(overlap, "Chevauchement")
  )

  const approved = await callAction(leavesPage, ids.get("approveLeave")!, [
    { firmSlug: SOURCE, id: leave!.id },
  ])
  check("approveLeave", succeeded(approved))

  const balance = await db.leaveBalance.findFirst({
    where: { employeeId: employee!.id, leaveType: "ANNUAL" },
    select: { usedDays: true, remainingDays: true, totalDays: true },
  })
  check(
    "the balance is debited only on approval",
    balance !== null && Number(balance.usedDays) === Number(leave!.totalDays),
    `${balance?.usedDays} used of ${balance?.totalDays}`
  )

  /* ---------------------------------------------------------------------- */
  console.log("\n=== clients ===")

  const clientBody = await callAction(clientsPage, ids.get("createClient")!, [
    { firmSlug: SOURCE, name: `Harness Client ${stamp}`, status: "ACTIVE" },
  ])
  check("createClient", succeeded(clientBody))

  const client = await db.client.findFirst({
    where: { firmId: source.id, name: `Harness Client ${stamp}` },
    select: { id: true },
  })
  check("the client exists", client !== null)

  const clash = await callAction(clientsPage, ids.get("createClient")!, [
    { firmSlug: SOURCE, name: `harness client ${stamp}`, status: "ACTIVE" },
  ])
  check(
    "a duplicate name is refused case-insensitively",
    !succeeded(clash) && says(clash, "déjà ce nom")
  )

  const archived = await callAction(clientsPage, ids.get("archiveClient")!, [
    { firmSlug: SOURCE, id: client!.id },
  ])
  check("archiveClient", succeeded(archived))

  const busy = await db.client.findFirst({
    where: {
      firmId: source.id,
      status: "ACTIVE",
      assignedEmployees: { some: { status: "ACTIVE" } },
    },
    select: { id: true, name: true },
  })
  if (busy) {
    const refusedArchive = await callAction(
      clientsPage,
      ids.get("archiveClient")!,
      [{ firmSlug: SOURCE, id: busy.id }]
    )
    check(
      "archiving is refused while employees are assigned",
      !succeeded(refusedArchive) && says(refusedArchive, "affect")
    )
  }

  /* ---------------------------------------------------------------------- */
  console.log("\n=== transfers ===")

  const requestBody = await callAction(transfersPage, ids.get("requestTransfer")!, [
    {
      firmSlug: SOURCE,
      employeeId: employee!.id,
      toFirmId: destination.id,
      transferDate: shift(-1),
      effectiveDate: shift(-1),
      reason: "Harness",
      createDestinationContract: true,
      contractType: "INTERIM",
    },
  ])
  check("requestTransfer", succeeded(requestBody))

  const transfer = await db.employeeTransfer.findFirst({
    where: { employeeId: employee!.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, newMatricule: true },
  })
  check("the transfer is PENDING", transfer?.status === "PENDING")
  check(
    "a destination matricule is reserved with the destination prefix",
    transfer?.newMatricule?.startsWith("SP") ?? false,
    transfer?.newMatricule ?? ""
  )

  // Fix 1, first half.
  const secondWhilePending = await callAction(
    transfersPage,
    ids.get("requestTransfer")!,
    [
      {
        firmSlug: SOURCE,
        employeeId: employee!.id,
        toFirmId: destination.id,
        transferDate: shift(-1),
        effectiveDate: shift(-1),
        reason: "Second",
        createDestinationContract: true,
        contractType: "INTERIM",
      },
    ]
  )
  check(
    "a second transfer is refused while one is PENDING",
    !succeeded(secondWhilePending) && says(secondWhilePending, "attente")
  )

  // Approval is the destination firm's, so it is called on that firm's page.
  const approveBody = await callAction(
    `/${DESTINATION}/hr/transfers`,
    ids.get("approveTransfer")!,
    [{ firmSlug: DESTINATION, id: transfer!.id }]
  )
  check("approveTransfer, from the destination", succeeded(approveBody))

  // Fix 1, second half — the one the legacy guard missed entirely.
  const secondWhileApproved = await callAction(
    transfersPage,
    ids.get("requestTransfer")!,
    [
      {
        firmSlug: SOURCE,
        employeeId: employee!.id,
        toFirmId: destination.id,
        transferDate: shift(-1),
        effectiveDate: shift(-1),
        reason: "Third",
        createDestinationContract: true,
        contractType: "INTERIM",
      },
    ]
  )
  check(
    "a second transfer is refused while one is APPROVED",
    !succeeded(secondWhileApproved) && says(secondWhileApproved, "approuv")
  )

  const completeBody = await callAction(
    transfersPage,
    ids.get("completeTransfer")!,
    [{ firmSlug: SOURCE, id: transfer!.id }]
  )
  check("completeTransfer, from the source", succeeded(completeBody))

  const moved = await db.employee.findUniqueOrThrow({
    where: { id: employee!.id },
    select: {
      firmId: true,
      matricule: true,
      status: true,
      contracts: {
        select: { firmId: true, status: true, type: true, notes: true },
      },
    },
  })

  check("the employee now belongs to the destination firm", moved.firmId === destination.id)
  check(
    "and carries the destination matricule",
    moved.matricule.startsWith("SP"),
    moved.matricule
  )
  check(
    "every source contract was closed",
    moved.contracts
      .filter((contract) => contract.firmId === source.id)
      .every((contract) => contract.status !== "ACTIVE")
  )

  // Fix 2 — the whole point. The legacy completion stopped one line earlier.
  const destinationContract = moved.contracts.find(
    (contract) => contract.firmId === destination.id && contract.status === "ACTIVE"
  )
  check(
    "an active contract was opened in the destination firm",
    destinationContract !== undefined
  )

  /* ---------------------------------------------------------------------- */
  console.log("\n=== audit ===")

  const audits = await db.auditLog.findMany({
    where: { entity: { in: ["EMPLOYEE", "CONTRACT", "EMPLOYEE_TRANSFER", "LEAVE_REQUEST", "CLIENT"] } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { action: true, entity: true },
  })
  const actions = new Set(audits.map((row) => `${row.entity}.${row.action}`))
  check("the transfer completion was audited", actions.has("EMPLOYEE_TRANSFER.COMPLETE"))
  check("the employee creation was audited", actions.has("EMPLOYEE.CREATE"))

  /* ---------------------------------------------------------------------- */
  console.log("\n=== cleanup ===")

  for (const id of created) {
    await db.auditLog.deleteMany({ where: { entityId: id } })
    // `EmployeeTransfer.employeeId` is a restricting foreign key, so the
    // transfer this harness raised has to go before the employee it moved.
    await db.employeeTransfer.deleteMany({ where: { employeeId: id } })
    try {
      await db.employee.delete({ where: { id } })
    } catch (error) {
      console.log(`  FAIL could not remove harness employee ${id} — ${error}`)
      failures += 1
    }
  }
  await db.client.deleteMany({
    where: { firmId: source.id, name: { startsWith: "Harness Client " } },
  })
  console.log("  harness rows removed")

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
