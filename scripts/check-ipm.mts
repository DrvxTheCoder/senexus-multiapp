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
import sharp from "sharp"
import { hash } from "bcryptjs"

import { FLYER_PLANS } from "@/server/domain/ipm/referentiel"
import {
  issueToken,
  verificationSecret,
} from "@/server/domain/ipm/verification-token"

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

  console.log("\nEvery IPM screen answers")
  for (const path of ["participants", "employeurs", "formules", "referentiel"]) {
    await expectStatus(ipm, `/${IPM_SLUG}/ipm/${path}`, 200)
  }

  // A participant record, fetched by a real id rather than a guessed one.
  const sample = await db.member.findFirst({
    where: { firm: { slug: IPM_SLUG } },
    select: { id: true, matricule: true },
  })
  if (!sample) {
    check("a seeded participant exists to open", false)
  } else {
    const record = await expectStatus(
      ipm,
      `/${IPM_SLUG}/ipm/participants/${sample.id}`,
      200
    )
    const recordHtml = await record.text()
    check(
      "the record shows the participant's matricule",
      recordHtml.includes(sample.matricule)
    )
    // Optique and hospitalisation have no rate, so the record must say so in
    // words — twice, once per category. Counting is the point: asserting only
    // that the phrase appears would also pass if one of the two silently
    // rendered a rate nobody chose.
    //
    // Do not "improve" this into a search for "0 %": `100 %` contains that as
    // a substring, so the test would report a phantom on every passing run.
    const missingCells = recordHtml.split("Barème manquant").length - 1
    check(
      "both unpriced catégories read as a gap, not as a rate",
      missingCells === 2,
      `${missingCells} cells say "Barème manquant"`
    )
  }

  console.log("\nCartes")
  await expectStatus(ipm, `/${IPM_SLUG}/ipm/cartes`, 200)

  if (sample) {
    for (const face of ["recto", "verso"]) {
      const image = await get(ipm, `/${IPM_SLUG}/api/ipm/cards/${sample.id}/${face}`)
      const bytes = Buffer.from(await image.arrayBuffer())
      check(
        `${face} renders as a PNG`,
        image.status === 200 &&
          image.headers.get("content-type") === "image/png" &&
          // PNG magic number. A 200 carrying an HTML error page would
          // otherwise pass a status-only check.
          bytes.subarray(0, 8).equals(
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
          ),
        `status ${image.status}, ${bytes.length} bytes`
      )

      // 54 × 85.6 mm at 300 ppi, and the density written into the file — resvg
      // emits none, and without it a printer places the card at 225 mm.
      const meta = await sharp(bytes).metadata()
      check(
        `${face} is 638×1011 at 300 ppi`,
        meta.width === 638 && meta.height === 1011 && meta.density === 300,
        `${meta.width}×${meta.height} @ ${meta.density}`
      )

      check(
        `${face} is never cached by a shared cache`,
        image.headers.get("cache-control")?.includes("private") === true &&
          image.headers.get("cache-control")?.includes("no-store") === true,
        image.headers.get("cache-control") ?? "(none)"
      )

      // §11 Q8: a real CMYK file for the printer. PNG cannot hold CMYK, so
      // this is a TIFF — and it must come back with 5 channels, not 4.
      const print = await get(
        ipm,
        `/${IPM_SLUG}/api/ipm/cards/${sample.id}/${face}?format=tiff`
      )
      const printBytes = Buffer.from(await print.arrayBuffer())
      const printMeta = await sharp(printBytes).metadata()
      check(
        `${face} print file is CMYK at 300 ppi`,
        print.status === 200 &&
          printMeta.space === "cmyk" &&
          printMeta.density === 300,
        `${printMeta.space} @ ${printMeta.density}`
      )
    }

    // Card images carry the photo, the birth date and the matricule, which §6
    // says are authenticated-only.
    await expectStatus(null, `/${IPM_SLUG}/api/ipm/cards/${sample.id}/recto`, 307)
  }

  console.log("\nBons et prestataires")
  for (const path of ["bons", "bons/nouveau", "prestataires"]) {
    await expectStatus(ipm, `/${IPM_SLUG}/ipm/${path}`, 200)
  }

  // The settlement formula, asserted against every seeded bon rather than a
  // sample: ceil(total × rate), the IPM absorbing the residual franc.
  const [splitMismatch] = await db.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM ipm_vouchers
     WHERE ceil("totalAmount" * "appliedRate") <> "insurerShare"`
  )
  check("every bon splits as ceil(total × taux)", splitMismatch.n === 0,
    `${splitMismatch.n} disagree`)

  const [sumMismatch] = await db.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM ipm_vouchers
     WHERE "insurerShare" + "memberShare" <> "totalAmount"`
  )
  check("part IPM + ticket = total on every bon", sumMismatch.n === 0,
    `${sumMismatch.n} disagree`)

  const [overpaid] = await db.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM ipm_vouchers WHERE "insurerShare" > "totalAmount"`
  )
  check("the institution never pays more than the bill", overpaid.n === 0)

  // A cancelled bon releases the space it held under the plafond.
  const cancelledWithConsumption = await db.ipmConsumption.count({
    where: { firm: { slug: IPM_SLUG }, voucher: { status: "CANCELLED" } },
  })
  check(
    "a cancelled bon holds no consumption",
    cancelledWithConsumption === 0,
    `${cancelledWithConsumption} left behind`
  )

  // Numbering must not reuse a reference already on paper.
  const lowNumbers = await db.ipmVoucher.count({
    where: {
      firm: { slug: IPM_SLUG },
      OR: [
        { type: "PHARMACY", number: { lt: "BPI005431" } },
        { type: "GUARANTEE", number: { lt: "LGI009311" } },
      ],
    },
  })
  check(
    "no bon reuses a number already in circulation",
    lowNumbers === 0,
    `${lowNumbers} below the legacy maxima`
  )

  const duplicates = await db.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM (
       SELECT "number" FROM ipm_vouchers GROUP BY 1 HAVING count(*) > 1
     ) t`
  )
  check("no two bons share a number", duplicates[0].n === 0)

  // Providers that cannot be issued against must not be offered as if they
  // could: the issue form lists only active and agréé.
  const issuable = await db.ipmProvider.count({
    where: { firm: { slug: IPM_SLUG }, accredited: true, status: "ACTIVE" },
  })
  const issuedAgainstUnusable = await db.ipmVoucher.count({
    where: {
      firm: { slug: IPM_SLUG },
      OR: [
        { provider: { accredited: false } },
        { provider: { status: { not: "ACTIVE" } } },
      ],
    },
  })
  check("there is at least one issuable provider", issuable > 0, `${issuable}`)
  check(
    "no bon was issued against a provider that is not agréé and active",
    issuedAgainstUnusable === 0,
    `${issuedAgainstUnusable} found`
  )

  console.log("\nRegistre, cotisations et factures")
  for (const path of ["cotisations", "factures"]) {
    await expectStatus(ipm, `/${IPM_SLUG}/ipm/${path}`, 200)
  }

  const anyEmployer = await db.ipmEmployer.findFirst({
    where: { firm: { slug: IPM_SLUG } },
    select: { id: true },
  })
  if (anyEmployer) {
    const statement = await expectStatus(
      ipm,
      `/${IPM_SLUG}/ipm/employeurs/${anyEmployer.id}/releve`,
      200
    )
    const statementHtml = await statement.text()
    check(
      "the statement reports cotisations against consommation",
      statementHtml.includes("Cotisations") &&
        statementHtml.includes("Consommation")
    )
  }

  // The register is append-only and its cache is rebuildable. If these drift,
  // every balance on every statement is wrong and nothing else says so.
  const [drift] = await db.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM (
       SELECT m."id"
       FROM "ipm_members" m
       LEFT JOIN "ipm_ledger_entries" l ON l."memberId" = m."id"
       GROUP BY m."id", m."currentBalance"
       HAVING COALESCE(SUM(l."credit" - l."debit"), 0) <> m."currentBalance"
     ) t`
  )
  check("every cached balance equals the sum of its register", drift.n === 0,
    `${drift.n} drifted`)

  const bothSides = await db.ipmLedgerEntry.count({
    where: { firm: { slug: IPM_SLUG }, credit: { gt: 0 }, debit: { gt: 0 } },
  })
  check("no entry carries a credit and a debit at once", bothSides === 0)

  const [doubleOpening] = await db.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM (
       SELECT "memberId" FROM "ipm_ledger_entries"
       WHERE "type" = 'OPENING' GROUP BY 1 HAVING count(*) > 1
     ) t`
  )
  check("no register was opened twice", doubleOpening.n === 0)

  // §11 Q9: a prise en charge debits the IPM share, never the voucher total.
  const [wrongBasis] = await db.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n
     FROM "ipm_ledger_entries" l
     JOIN "ipm_vouchers" v ON v."id" = l."sourceId"
     WHERE l."type" = 'CONSUMPTION' AND l."debit" <> v."insurerShare"`
  )
  check(
    "consumption debits the IPM share, not the voucher total",
    wrongBasis.n === 0,
    `${wrongBasis.n} debited otherwise`
  )

  // §11 Q11 stays unanswered, so the unopened registers must be *visible*
  // rather than silently treated as starting at zero.
  const totalMembers = await db.member.count({ where: { firm: { slug: IPM_SLUG } } })
  const openedMembers = await db.ipmLedgerEntry.findMany({
    where: { firm: { slug: IPM_SLUG }, type: "OPENING" },
    select: { memberId: true },
    distinct: ["memberId"],
  })
  const unopened = totalMembers - openedMembers.length
  check(
    "the fixtures include registers with no opening balance",
    unopened > 0,
    `${unopened} of ${totalMembers}`
  )

  const cotisations = await get(ipm, `/${IPM_SLUG}/ipm/cotisations`)
  const cotisationsHtml = await cotisations.text()
  check(
    "the cotisations screen reports them rather than hiding them",
    cotisationsHtml.includes("non ouvert"),
    `${unopened} unopened`
  )

  // An invoice must agree with its own lines, or it is not a document.
  const invoices = await db.ipmEmployerInvoice.findMany({
    where: { firm: { slug: IPM_SLUG } },
    select: {
      id: true,
      totalAmount: true,
      lines: { select: { monthlyContribution: true } },
    },
  })
  const mismatched = invoices.filter(
    (invoice) =>
      Math.abs(
        Number(invoice.totalAmount) -
          invoice.lines.reduce(
            (sum, line) => sum + Number(line.monthlyContribution),
            0
          )
      ) > 0.005
  )
  check(
    "every facture totals its own lines",
    mismatched.length === 0,
    `${mismatched.length} disagree`
  )

  const [duplicatePeriods] = await db.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM (
       SELECT "employerId", "periodYear", "periodMonth"
       FROM "ipm_employer_invoices"
       GROUP BY 1,2,3 HAVING count(*) > 1
     ) t`
  )
  check("no employer was invoiced twice for one month", duplicatePeriods.n === 0)

  console.log("\nDécaissements et export comptable")
  await expectStatus(ipm, `/${IPM_SLUG}/ipm/decaissements`, 200)

  // A remboursement must be priced by the *same* arithmetic as a bon, or a
  // participant who pays up front is reimbursed differently from one who does
  // not — and the one out of pocket is the one who notices.
  const reimbursements = await db.ipmReimbursement.findMany({
    where: { firm: { slug: IPM_SLUG } },
    select: { totalAmount: true, insurerShare: true, appliedRate: true },
  })
  const mispriced = reimbursements.filter(
    (entry) =>
      Math.ceil(Number(entry.totalAmount) * Number(entry.appliedRate)) !==
      Number(entry.insurerShare)
  )
  check(
    "remboursements use the same ceil(total × taux) as the bons",
    mispriced.length === 0,
    `${mispriced.length} of ${reimbursements.length} differ`
  )

  // A décaissement is derived from what it settles; a hand-typed total would
  // eventually disagree with its own list.
  const disbursements = await db.ipmDisbursement.findMany({
    where: { firm: { slug: IPM_SLUG } },
    select: {
      number: true,
      amount: true,
      approvedAt: true,
      accountingAt: true,
      receivedAt: true,
      lines: { select: { amount: true } },
    },
  })
  const unbalanced = disbursements.filter(
    (entry) =>
      Math.abs(
        Number(entry.amount) -
          entry.lines.reduce((sum, line) => sum + Number(line.amount), 0)
      ) > 0.005
  )
  check(
    "every bon de décaissement totals its own lines",
    unbalanced.length === 0,
    `${unbalanced.length} disagree`
  )

  // The three visas are ordered: direction, then comptabilité, then remise.
  const outOfOrder = disbursements.filter(
    (entry) =>
      (entry.accountingAt && !entry.approvedAt) ||
      (entry.receivedAt && !entry.accountingAt)
  )
  check("no visa was applied out of order", outOfOrder.length === 0,
    `${outOfOrder.length} out of order`)

  // The écart is the figure the contrôle exists for. The fixtures must contain
  // some, or the queue is a screen nobody would ever have a reason to open.
  const invoicesWithVariance = await db.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM "ipm_provider_invoices"
     WHERE "totalAmount" <> "matchedAmount"`
  )
  check(
    "some provider invoices carry an écart against the bons",
    invoicesWithVariance[0].n > 0,
    `${invoicesWithVariance[0].n} with a variance`
  )

  // An invoice that does not reconcile must not be sitting approved.
  const [approvedWithVariance] = await db.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM "ipm_provider_invoices"
     WHERE "totalAmount" <> "matchedAmount"
       AND "status" IN ('APPROVED', 'PAID')`
  )
  check(
    "no invoice was approved while its écart is unresolved",
    approvedWithVariance.n === 0,
    `${approvedWithVariance.n} approved with a variance`
  )

  const exportResponse = await get(
    ipm,
    `/${IPM_SLUG}/ipm/decaissements/export?from=2020-01-01&to=2030-12-31`
  )
  const csv = await exportResponse.text()
  check(
    "the accounting export returns a CSV",
    exportResponse.status === 200 &&
      exportResponse.headers.get("content-type")?.includes("text/csv") === true,
    `status ${exportResponse.status}`
  )
  check(
    "it is semicolon-separated with a header, for a French Excel",
    csv.includes("Date;Journal;Référence;Compte;Libellé;Débit;Crédit")
  )

  // Every disbursement produces the pair a payment always produces. Not a
  // ledger — §2 excludes double-entry explicitly — but the rows must still
  // balance, or the bookkeeper importing them has to fix them by hand.
  const dataLines = csv
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => line.trim().length > 0)
  let debits = 0
  let credits = 0
  for (const line of dataLines) {
    const cells = line.split(";")
    debits += Number(cells[5] || 0)
    credits += Number(cells[6] || 0)
  }
  check(
    "the exported rows balance",
    Math.abs(debits - credits) < 0.005,
    `${debits} debit vs ${credits} credit`
  )

  await expectStatus(
    null,
    `/${IPM_SLUG}/ipm/decaissements/export?from=2020-01-01&to=2030-12-31`,
    307
  )

  console.log("\nThe IPM firm exposes nothing else")
  await expectStatus(ipm, `/${IPM_SLUG}/hr/employees`, 404)
  await expectStatus(ipm, `/${IPM_SLUG}/hr/contracts`, 404)
  await expectStatus(ipm, `/${IPM_SLUG}/crm/clients`, 404)
  await expectStatus(ipm, `/${IPM_SLUG}/documents`, 404)

  console.log("\nThe data model holds its invariants")
  const [memberCount, openPeriods, overlapRows, crossFirm] = await Promise.all([
    db.member.count({ where: { firm: { slug: IPM_SLUG } } }),
    db.ipmMemberContribution.count({
      where: { firm: { slug: IPM_SLUG }, validTo: null },
    }),
    db.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM (
         SELECT "memberId" FROM ipm_member_contributions
         WHERE "validTo" IS NULL GROUP BY 1 HAVING count(*) > 1
       ) t`
    ),
    // Nothing IPM may reference a row belonging to another firm.
    db.member.count({
      where: {
        firm: { slug: IPM_SLUG },
        employer: { firm: { slug: { not: IPM_SLUG } } },
      },
    }),
  ])

  check(
    "every participant has exactly one open cotisation",
    openPeriods === memberCount,
    `${openPeriods} open for ${memberCount} participants`
  )
  check("no participant has two open periods", overlapRows[0].n === 0)
  check("no participant points at another firm's employer", crossFirm === 0)

  const orphanPersons = await db.person.count({
    where: { employees: { none: {} }, members: { none: {} }, dependents: { none: {} } },
  })
  check("no orphan person rows", orphanPersons === 0, `${orphanPersons} found`)

  const shared = await db.organization.count({
    where: { clients: { some: {} }, employers: { some: {} } },
  })
  check(
    "at least one organization is both a CRM client and an IPM employer",
    shared > 0,
    // The point of hoisting Organization to the holding: one legal entity,
    // not one row per module.
    `${shared} shared`
  )

  console.log("\nThe seeded formules match the flyer")
  const plans = await db.ipmPlan.findMany({
    where: { firm: { slug: IPM_SLUG } },
    select: {
      code: true,
      monthlyPrice: true,
      rates: {
        select: { rate: true, category: { select: { code: true } } },
      },
    },
  })
  const planByCode = new Map(plans.map((plan) => [plan.code, plan]))

  for (const flyer of FLYER_PLANS) {
    const seeded = planByCode.get(flyer.code)
    if (!seeded) {
      check(`${flyer.code} is seeded`, false)
      continue
    }
    check(
      `${flyer.code} costs ${flyer.monthlyPrice}`,
      Number(seeded.monthlyPrice) === flyer.monthlyPrice,
      `got ${seeded.monthlyPrice}`
    )
    for (const [categoryCode, percent] of Object.entries(flyer.rates)) {
      const rate = seeded.rates.find(
        (entry) => entry.category.code === categoryCode
      )
      check(
        `${flyer.code} / ${categoryCode} = ${percent}%`,
        rate !== undefined && Math.round(Number(rate.rate) * 1000) / 10 === percent,
        rate ? `got ${Number(rate.rate)}` : "missing"
      )
    }
    // The flyer states nothing for optique or hospitalisation, and neither may
    // the database: a guessed rate is indistinguishable from a real one.
    for (const categoryCode of ["OPTIQUE", "HOSPITALISATION"]) {
      check(
        `${flyer.code} / ${categoryCode} is left unset`,
        !seeded.rates.some((entry) => entry.category.code === categoryCode)
      )
    }
  }

  console.log("\nThe dashboard survives a firm with no employees at all")
  await expectStatus(ipm, `/${IPM_SLUG}/dashboard`, 200)

  /* ---- and cannot be reached from the HR firms -------------------------- */

  console.log("\nHR rights confer nothing on the health side")
  for (const slug of HR_SLUGS) {
    await expectStatus(hr, `/${slug}/ipm`, 404)
    // Every screen, not just the landing page — the gate has to hold on each
    // route, because each one calls requireModule for itself.
    await expectStatus(hr, `/${slug}/ipm/participants`, 404)
    await expectStatus(hr, `/${slug}/ipm/formules`, 404)
    await expectStatus(hr, `/${slug}/ipm/bons`, 404)
    await expectStatus(hr, `/${slug}/ipm/prestataires`, 404)
    await expectStatus(hr, `/${slug}/ipm/cotisations`, 404)
    await expectStatus(hr, `/${slug}/ipm/factures`, 404)
    await expectStatus(hr, `/${slug}/ipm/decaissements`, 404)
  }
  if (sample) {
    // A real participant id, aimed at a firm that does not have the module.
    await expectStatus(hr, `/${HR_SLUGS[0]}/ipm/participants/${sample.id}`, 404)
    // And at the IPM firm, where the module is on but the caller is not a
    // member: 403, and still not the record.
    await expectStatus(hr, `/${IPM_SLUG}/ipm/participants/${sample.id}`, 403)
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

  console.log("\nLa page publique de vérification")
  if (sample) {
    const secret = verificationSecret()
    const token = issueToken({ kind: "member", id: sample.id }, secret)

    // Public by design: a pharmacist at a counter has no account.
    const page = await get(null, `/v/${token}`)
    const html = await page.text()
    check("a valid token resolves without a session", page.status === 200,
      `got ${page.status}`)
    check("it states the verdict", html.includes("Couverture"))
    check("it shows the matricule the card carries", html.includes(sample.matricule))

    // The privacy decision, asserted rather than described: §6 requires the
    // photo and the birth date to be authenticated-only, so neither may leak
    // onto a page with no authentication.
    const person = await db.member.findUnique({
      where: { id: sample.id },
      select: { person: { select: { birthDate: true, nationalId: true } } },
    })
    const birthDate = person?.person.birthDate?.toISOString().slice(0, 10)
    check(
      "it does not publish the date of birth",
      !birthDate || !html.includes(birthDate),
      birthDate ?? "(none recorded)"
    )
    check(
      "it does not publish the CNI",
      !person?.person.nationalId || !html.includes(person.person.nationalId)
    )
    check("it does not publish a photo", !/<img[^>]*photo/i.test(html))

    const forged = token.slice(0, -4) + "AAAA"
    const refused = await get(null, `/v/${forged}`)
    const refusedHtml = await refused.text()
    check(
      "a tampered token is refused",
      refusedHtml.includes("non valide"),
      `status ${refused.status}`
    )
    check(
      "a refusal leaks no name",
      !refusedHtml.includes(sample.matricule)
    )
  }

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
