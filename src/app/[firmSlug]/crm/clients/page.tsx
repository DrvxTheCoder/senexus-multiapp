import type { Metadata } from "next"
import { Suspense } from "react"

import { ClientsView } from "@/app/[firmSlug]/crm/clients/clients-view"
import { Panel } from "@/components/panel"
import { TableSkeleton } from "@/components/primitives"
import { TopBar } from "@/components/shell/top-bar"
import {
  loadClientSearchParams,
  toClientQuery,
} from "@/lib/queries/client-params"
import { requireFirmPage } from "@/server/auth/firm-page"
import { roleAtLeast } from "@/types/auth"
import {
  clientPlacements,
  clientSummary,
  listClients,
} from "@/server/queries/clients"
import { isScoped } from "@/server/queries/scope"

export const metadata: Metadata = { title: "Clients" }

export default async function ClientsPage({
  params,
  searchParams,
}: PageProps<"/[firmSlug]/crm/clients">) {
  const { firmSlug } = await params
  const ctx = await requireFirmPage(firmSlug, { module: "crm" })
  const raw = await searchParams

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/dashboard`}
        crumbs={[
          { label: ctx.firm.name, href: `/${firmSlug}/dashboard` },
          { label: "CRM" },
          { label: "Clients" },
        ]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className=" p-4.5">
          <div className="mb-3.5 flex items-center gap-3">
            <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
              Clients
            </h1>
          </div>

          <Suspense fallback={<ClientsSkeleton />}>
            <ClientsPanel firmSlug={firmSlug} raw={raw} />
          </Suspense>
        </div>
      </div>
    </>
  )
}

async function ClientsPanel({
  firmSlug,
  raw,
}: {
  firmSlug: string
  raw: Awaited<PageProps<"/[firmSlug]/crm/clients">["searchParams"]>
}) {
  const ctx = await requireFirmPage(firmSlug, { module: "crm" })
  const parsed = loadClientSearchParams(raw)
  const query = toClientQuery(parsed)

  const [page, summary] = await Promise.all([
    listClients(query, ctx),
    clientSummary(query, ctx),
  ])

  // The drawer is part of the URL, so its contents are fetched on the server
  // like everything else — opening one is a navigation, not a client fetch.
  const openClientId = parsed.open
  const placements = openClientId
    ? await clientPlacements(openClientId, ctx)
    : []

  return (
    <ClientsView
      firmSlug={firmSlug}
      page={page}
      summary={summary}
      scoped={isScoped(ctx)}
      openClientId={openClientId}
      placements={placements}
      canWrite={roleAtLeast(ctx.role, "MANAGER")}
      hrEnabled={ctx.firm.modules.includes("hr")}
    />
  )
}

function ClientsSkeleton() {
  return (
    <Panel
      title="Portefeuille"
      description="Comptes clients, effectif placé et prochaines échéances."
      padded={false}
      footer={{ summary: "Chargement…" }}
    >
      <div className="h-[49px] border-b border-line" />
      <TableSkeleton rows={8} columns={[28, 10, 14, 16, 16, 12]} />
    </Panel>
  )
}
