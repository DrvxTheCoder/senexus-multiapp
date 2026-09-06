import type { Metadata } from "next"
import { Suspense } from "react"

import { EmployeesView } from "@/app/[firmSlug]/hr/employees/employees-view"
import { ExportButton } from "@/components/export-button"
import { Panel } from "@/components/panel"
import { TableSkeleton } from "@/components/primitives"
import { TopBar } from "@/components/shell/top-bar"
import { db } from "@/lib/db"
import {
  loadEmployeeSearchParams,
  toEmployeeQuery,
} from "@/lib/queries/employee-params"
import { requireFirmPage } from "@/server/auth/firm-page"
import { employeeSummary, listEmployees } from "@/server/queries/employees"
import { listSavedViews } from "@/server/queries/saved-views"
import { isScoped } from "@/server/queries/scope"
import { roleAtLeast } from "@/types/auth"

export const metadata: Metadata = { title: "Employés" }

export default async function EmployeesPage({
  params,
  searchParams,
}: PageProps<"/[firmSlug]/hr/employees">) {
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
          { label: "Employés" },
        ]}
        actions={<ExportButton basePath={`/${firmSlug}/hr/employees/export`} />}
      />

      <div className="flex-1 overflow-y-auto">
        <div className=" p-4.5">
          <div className="mb-3.5 flex items-center gap-3">
            <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
              Employés
            </h1>
          </div>

          <Suspense fallback={<EmployeesSkeleton />}>
            <EmployeesPanel firmSlug={firmSlug} raw={raw} />
          </Suspense>
        </div>
      </div>
    </>
  )
}

async function EmployeesPanel({
  firmSlug,
  raw,
}: {
  firmSlug: string
  raw: Awaited<PageProps<"/[firmSlug]/hr/employees">["searchParams"]>
}) {
  const ctx = await requireFirmPage(firmSlug, { module: "hr" })
  const query = toEmployeeQuery(loadEmployeeSearchParams(raw))

  const canWrite = roleAtLeast(ctx.role, "MANAGER")

  const [page, summary, savedViews, departments, clients, transferTargets] =
    await Promise.all([
      listEmployees(query, ctx),
      employeeSummary(query, ctx),
      listSavedViews(ctx, "employees"),
      db.department.findMany({
        where: { firmId: ctx.firmId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      db.client.findMany({
        where: {
          firmId: ctx.firmId,
          status: { in: ["ACTIVE", "PROSPECT"] },
          // A responsable can only assign within their own portfolio.
          ...(ctx.assignedClientIds ? { id: { in: ctx.assignedClientIds } } : {}),
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      canWrite
        ? db.firm.findMany({
            where: { holdingId: ctx.firm.holdingId, NOT: { id: ctx.firmId } },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          })
        : Promise.resolve([]),
    ])

  return (
    <EmployeesView
      firmSlug={firmSlug}
      page={page}
      summary={summary}
      savedViews={savedViews}
      departments={departments}
      clients={clients}
      transferTargets={transferTargets}
      canWrite={canWrite}
      scoped={isScoped(ctx)}
    />
  )
}

function EmployeesSkeleton() {
  return (
    <Panel
      title="Effectif"
      description="Trié par exposition au plafond légal."
      padded={false}
      footer={{ summary: "Chargement…" }}
    >
      <div className="h-[41px] border-b border-line" />
      <div className="h-[49px] border-b border-line" />
      <TableSkeleton rows={12} columns={[3, 28, 10, 16, 12, 12, 10]} />
    </Panel>
  )
}
