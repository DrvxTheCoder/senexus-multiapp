import type { Metadata } from "next"
import { Suspense } from "react"

import { MembersView } from "@/app/[firmSlug]/ipm/participants/members-view"
import { Panel } from "@/components/panel"
import { TableSkeleton } from "@/components/primitives"
import { TopBar } from "@/components/shell/top-bar"
import {
  loadMemberSearchParams,
  toMemberQuery,
} from "@/lib/queries/ipm/member-params"
import { requireFirmPage } from "@/server/auth/firm-page"
import { employerOptions } from "@/server/queries/ipm/employers"
import { listMembers, memberSummary } from "@/server/queries/ipm/members"
import { roleAtLeast } from "@/types/auth"

export const metadata: Metadata = { title: "Participants" }

export default async function MembersPage({
  params,
  searchParams,
}: PageProps<"/[firmSlug]/ipm/participants">) {
  const { firmSlug } = await params
  const ctx = await requireFirmPage(firmSlug, { module: "ipm" })
  const raw = await searchParams

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/ipm`}
        crumbs={[
          { label: ctx.firm.name, href: `/${firmSlug}/ipm` },
          { label: "IPM", href: `/${firmSlug}/ipm` },
          { label: "Participants" },
        ]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="p-4.5">
          <div className="mb-3.5 flex items-center gap-3">
            <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
              Participants
            </h1>
          </div>

          <Suspense fallback={<MembersSkeleton />}>
            <MembersPanel firmSlug={firmSlug} raw={raw} />
          </Suspense>
        </div>
      </div>
    </>
  )
}

async function MembersPanel({
  firmSlug,
  raw,
}: {
  firmSlug: string
  raw: Awaited<PageProps<"/[firmSlug]/ipm/participants">["searchParams"]>
}) {
  const ctx = await requireFirmPage(firmSlug, { module: "ipm" })
  const query = toMemberQuery(loadMemberSearchParams(raw))

  const [page, summary, employers] = await Promise.all([
    listMembers(ctx, query),
    memberSummary(ctx),
    employerOptions(ctx),
  ])

  return (
    <MembersView
      firmSlug={firmSlug}
      page={page}
      summary={summary}
      employers={employers}
      canWrite={roleAtLeast(ctx.role, "MANAGER")}
    />
  )
}

function MembersSkeleton() {
  return (
    <Panel title="Participants" padded={false}>
      <div className="h-[49px] border-b border-line" />
      <TableSkeleton rows={10} columns={[30, 20, 12, 14, 12, 12]} />
    </Panel>
  )
}
