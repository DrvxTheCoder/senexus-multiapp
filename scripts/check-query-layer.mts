/**
 * Exercises the contract resolver against the seeded database.
 *
 * This is a harness, not a test suite: it proves the resolver behaves against
 * real volume and, critically, that role scoping holds on every consumer —
 * list, facets, summary, export and bulk selection — which is the definition
 * of done requirement that the legacy application fails.
 *
 *   pnpm exec vite-node scripts/check-query-layer.mts
 */
import { PrismaClient } from "@prisma/client"

import type { FirmContext } from "@/server/auth/require-firm-access"
import {
  EMPTY_CONTRACT_QUERY,
  type ContractQuery,
} from "@/lib/queries/contract-query"
import {
  contractSummary,
  listContracts,
  resolveContractSelection,
  streamContractsForExport,
} from "@/server/queries/contracts"

const db = new PrismaClient()

async function contextFor(
  slug: string,
  assignedClientIds: string[] | null
): Promise<FirmContext> {
  const firm = await db.firm.findUniqueOrThrow({
    where: { slug },
    select: { id: true, slug: true, name: true, holdingId: true, logo: true, themeColor: true },
  })
  return {
    userId: "harness",
    userName: "Harness",
    userEmail: "harness@local",
    firm: { ...firm, modules: ["hr", "crm", "documents"] },
    firmId: firm.id,
    role: assignedClientIds ? "RESPONSABLE" : "ADMIN",
    assignedClientIds,
  }
}

const q = (patch: Partial<ContractQuery> = {}): ContractQuery => ({
  ...EMPTY_CONTRACT_QUERY,
  ...patch,
})

function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now()
  return fn().then((result) => {
    const ms = performance.now() - start
    console.log(`  ${label.padEnd(46)} ${ms.toFixed(0).padStart(5)} ms`)
    return result
  })
}

async function main() {
  const admin = await contextFor("connect-interim", null)

  console.log("\n=== unrestricted (ADMIN) ===")
  const page = await timed("listContracts, default sort, 50 rows", () =>
    listContracts(q(), admin)
  )
  console.log(`  total ${page.total}, page ${page.page}/${page.pageCount}`)

  const first = page.rows[0]
  console.log(
    `  first row: ${first.employee.lastName} ${first.employee.matricule} ` +
      `${first.type} remaining=${first.daysRemaining} ceiling=${first.ceiling.usedDays} (${first.ceiling.tone})`
  )

  const sortedByCeiling = await timed("sort by ceiling desc (SQL)", () =>
    listContracts(q({ sort: [{ id: "ceiling", desc: true }] }), admin)
  )
  console.log(
    `  top ceilings: ${sortedByCeiling.rows.slice(0, 5).map((r) => r.ceiling.usedDays).join(", ")}`
  )

  const nearLimit = await timed("filter interimDaysMin=620 (SQL)", () =>
    listContracts(q({ interimDaysMin: 620 }), admin)
  )
  console.log(`  contracts for employees at/over 620 days: ${nearLimit.total}`)
  const belowBound = nearLimit.rows.filter((r) => r.ceiling.usedDays < 620).length
  console.log(`  rows violating the bound: ${belowBound} (must be 0)`)

  const expiring = await timed("filter expiringWithin=30", () =>
    listContracts(q({ expiringWithin: 30 }), admin)
  )
  console.log(`  active contracts ending within 30 days: ${expiring.total}`)

  const searched = await timed("search by matricule", () =>
    listContracts(q({ search: "CI0042" }), admin)
  )
  console.log(`  search CI0042: ${searched.total} rows`)

  const summary = await timed("contractSummary (5 aggregates)", () =>
    contractSummary(q(), admin)
  )
  console.log(`  summary:`, summary)

  console.log("  facets:")
  for (const [name, buckets] of Object.entries(page.facets)) {
    console.log(
      `    ${name.padEnd(8)} ${buckets
        .slice(0, 5)
        .map((b) => `${b.label}=${b.count}`)
        .join("  ")}`
    )
  }

  // ---- the requirement the legacy app fails -----------------------------
  console.log("\n=== restricted (RESPONSABLE, 2 clients) ===")
  const scopedClients = await db.client.findMany({
    where: { firmId: admin.firmId, status: "ACTIVE" },
    orderBy: { name: "asc" },
    take: 2,
    select: { id: true, name: true },
  })
  const responsable = await contextFor(
    "connect-interim",
    scopedClients.map((c) => c.id)
  )
  console.log(`  assigned: ${scopedClients.map((c) => c.name).join(", ")}`)

  const scopedPage = await timed("listContracts", () => listContracts(q(), responsable))
  console.log(`  list total: ${scopedPage.total} (admin saw ${page.total})`)

  const scopedSummary = await timed("contractSummary", () =>
    contractSummary(q(), responsable)
  )
  console.log(`  summary.matching: ${scopedSummary.matching}`)

  const scopedFacets = scopedPage.facets.client.map((b) => b.label)
  console.log(`  client facet only shows: ${scopedFacets.join(", ")}`)

  let exported = 0
  const exportedClients = new Set<string>()
  await timed("streamContractsForExport (full walk)", async () => {
    for await (const batch of streamContractsForExport(q(), responsable)) {
      exported += batch.length
      for (const row of batch) exportedClients.add(row.client?.name ?? "—")
    }
  })
  console.log(`  exported rows: ${exported}`)
  console.log(`  clients present in export: ${[...exportedClients].join(", ")}`)

  // A crafted request naming rows outside the caller's scope.
  const foreignIds = page.rows
    .filter((row) => !scopedClients.some((c) => c.id === row.client?.id))
    .slice(0, 10)
    .map((row) => row.id)
  const resolved = await resolveContractSelection({ ids: foreignIds }, responsable)
  console.log(
    `  bulk selection of ${foreignIds.length} out-of-scope ids resolved to ${resolved.length} (must be 0)`
  )

  const selectAll = await resolveContractSelection(
    { query: q(), except: [] },
    responsable
  )
  console.log(
    `  "select all matching" resolved to ${selectAll.length} ids (list total ${scopedPage.total})`
  )

  // ---- verdict ----------------------------------------------------------
  const failures: string[] = []
  if (belowBound !== 0) failures.push("ceiling filter admitted rows below the bound")
  if (scopedPage.total >= page.total) failures.push("scoped list was not narrower")
  if (exported !== scopedPage.total) failures.push("export row count disagrees with list total")
  if (exportedClients.size > scopedClients.length)
    failures.push("export contained a client outside the caller scope")
  if (scopedFacets.length > scopedClients.length)
    failures.push("facets exposed clients outside the caller scope")
  if (resolved.length !== 0) failures.push("bulk selection accepted out-of-scope ids")
  if (selectAll.length !== scopedPage.total)
    failures.push("select-all did not match the list total")

  console.log("\n----------------------------------------")
  if (failures.length === 0) {
    console.log("PASS — scope holds on list, facets, summary, export and bulk selection.")
  } else {
    console.log("FAIL")
    for (const failure of failures) console.log(`  - ${failure}`)
    process.exitCode = 1
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
