import type { Metadata } from "next"
import { Suspense } from "react"

import { ContractsView } from "@/app/[firmSlug]/hr/contracts/contracts-view"
import { Panel } from "@/components/panel"
import { TableSkeleton } from "@/components/primitives"
import { TopBar } from "@/components/shell/top-bar"
import { ExportButton } from "@/components/export-button"
import {
  loadContractSearchParams,
  toContractQuery,
} from "@/lib/queries/contract-params"
import { db } from "@/lib/db"
import { requireFirmPage } from "@/server/auth/firm-page"
import { listContracts, contractSummary } from "@/server/queries/contracts"
import { listSavedViews } from "@/server/queries/saved-views"
import { isScoped } from "@/server/queries/scope"

export const metadata: Metadata = { title: "Contrats" }

/**
 * §3.4 — a real file-system route, not a component-map entry, and §3.6 — the
 * page is a server component that streams the table in behind a skeleton whose
 * dimensions match the final layout.
 *
 * Everything below reads one `ContractQuery` parsed from the URL. Reload, the
 * back button and a pasted link all restore the same screen.
 */
export default async function ContractsPage({
  params,
  searchParams,
}: PageProps<"/[firmSlug]/hr/contracts">) {
  const { firmSlug } = await params
  const ctx = await requireFirmPage(firmSlug, { module: "hr" })
  const raw = await searchParams

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/dashboard`}
        crumbs={[
          { label: ctx.firm.name, href: `/${firmSlug}/dashboard` },
          { label: "RH" },
          { label: "Contrats" },
        ]}
        actions={<ExportButton basePath={`/${firmSlug}/hr/contracts/export`} />}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1420px] p-4.5">
          <div className="mb-3.5 flex items-center gap-3">
            <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
              Contrats
            </h1>
          </div>

          <Suspense fallback={<ContractsSkeleton />}>
            <ContractsPanel firmSlug={firmSlug} raw={raw} />
          </Suspense>
        </div>
      </div>
    </>
  )
}

async function ContractsPanel({
  firmSlug,
  raw,
}: {
  firmSlug: string
  raw: Awaited<PageProps<"/[firmSlug]/hr/contracts">["searchParams"]>
}) {
  const ctx = await requireFirmPage(firmSlug, { module: "hr" })
  const query = toContractQuery(loadContractSearchParams(raw))

  const [page, summary, savedViews, clients, employees] = await Promise.all([
    listContracts(query, ctx),
    contractSummary(query, ctx),
    listSavedViews(ctx, "contracts"),
    // Facets only carry the clients present in the current result; the filter
    // needs every client the caller may see, so the two are fetched separately.
    // The scope is applied here too - a responsable must not learn the names of
    // clients they are not assigned to.
    db.client.findMany({
      where: {
        firmId: ctx.firmId,
        ...(ctx.assignedClientIds ? { id: { in: ctx.assignedClientIds } } : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    // The picker in the contract dialog. Same scope: a responsable may only
    // write a contract for someone in their own portfolio.
    db.employee.findMany({
      where: {
        firmId: ctx.firmId,
        status: { in: ["ACTIVE", "ON_LEAVE"] },
        ...(ctx.assignedClientIds
          ? { assignedClientId: { in: ctx.assignedClientIds } }
          : {}),
      },
      select: { id: true, firstName: true, lastName: true, matricule: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 1000,
    }),
  ])

  return (
    <ContractsView
      firmSlug={firmSlug}
      page={page}
      summary={summary}
      savedViews={savedViews}
      clients={clients}
      employees={employees.map((employee) => ({
        id: employee.id,
        name: `${employee.firstName} ${employee.lastName}`,
        matricule: employee.matricule,
      }))}
      scoped={isScoped(ctx)}
      canRenew={ctx.role === "OWNER" || ctx.role === "ADMIN" || ctx.role === "MANAGER"}
    />
  )
}

function ContractsSkeleton() {
  return (
    <Panel
      title="Contrats actifs"
      description="Triés par échéance. Le plafond légal de 730 jours s'applique par employeur."
      padded={false}
      footer={{ summary: "Chargement…" }}
    >
      <div className="h-[41px] border-b border-line" />
      <div className="h-[49px] border-b border-line" />
      <TableSkeleton rows={12} columns={[3, 26, 8, 16, 14, 9, 12, 8]} />
    </Panel>
  )
}
