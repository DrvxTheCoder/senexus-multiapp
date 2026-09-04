import type { Metadata } from "next"
import { Suspense } from "react"

import { LeavesView } from "@/app/[firmSlug]/hr/leaves/leaves-view"
import { Panel } from "@/components/panel"
import { TableSkeleton } from "@/components/primitives"
import { TopBar } from "@/components/shell/top-bar"
import {
  currentMonth,
  loadLeaveSearchParams,
  toLeaveQuery,
} from "@/lib/queries/leave-params"
import { requireFirmPage } from "@/server/auth/firm-page"
import {
  leaveQuerySchema,
  leaveSummary,
  leavesInMonth,
  listLeaves,
} from "@/server/queries/leaves"
import { isScoped } from "@/server/queries/scope"

export const metadata: Metadata = { title: "Congés" }

export default async function LeavesPage({
  params,
  searchParams,
}: PageProps<"/[firmSlug]/hr/leaves">) {
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
          { label: "Congés" },
        ]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1420px] p-4.5">
          <div className="mb-3.5 flex items-center gap-3">
            <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
              Congés
            </h1>
          </div>

          <Suspense fallback={<LeavesSkeleton />}>
            <LeavesPanel firmSlug={firmSlug} raw={raw} />
          </Suspense>
        </div>
      </div>
    </>
  )
}

async function LeavesPanel({
  firmSlug,
  raw,
}: {
  firmSlug: string
  raw: Awaited<PageProps<"/[firmSlug]/hr/leaves">["searchParams"]>
}) {
  const ctx = await requireFirmPage(firmSlug, { module: "hr" })
  const parsed = loadLeaveSearchParams(raw)
  const query = leaveQuerySchema.parse(toLeaveQuery(parsed))
  const month = parsed.month ?? currentMonth()

  // The calendar and the list run the same resolver; only the shape differs.
  const [page, summary, calendar] = await Promise.all([
    listLeaves(query, ctx),
    leaveSummary(query, ctx),
    parsed.view === "calendrier" ? leavesInMonth(month, ctx) : Promise.resolve(null),
  ])

  return (
    <LeavesView
      firmSlug={firmSlug}
      page={page}
      summary={summary}
      calendar={calendar?.rows ?? []}
      month={month}
      scoped={isScoped(ctx)}
    />
  )
}

function LeavesSkeleton() {
  return (
    <Panel
      title="Demandes de congé"
      description="Triées par ancienneté de la demande."
      padded={false}
      footer={{ summary: "Chargement…" }}
    >
      <div className="h-[49px] border-b border-line" />
      <TableSkeleton rows={10} columns={[26, 12, 18, 10, 12, 12]} />
    </Panel>
  )
}
