import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { MemberRecordView } from "@/app/[firmSlug]/ipm/participants/[memberId]/member-record-view"
import { TopBar } from "@/components/shell/top-bar"
import { requireFirmPage } from "@/server/auth/firm-page"
import { employerOptions } from "@/server/queries/ipm/employers"
import { getMemberRecord } from "@/server/queries/ipm/member-record"
import { roleAtLeast } from "@/types/auth"

export const metadata: Metadata = { title: "Participant" }

export default async function MemberPage({
  params,
}: PageProps<"/[firmSlug]/ipm/participants/[memberId]">) {
  const { firmSlug, memberId } = await params
  const ctx = await requireFirmPage(firmSlug, { module: "ipm" })

  const [record, employers] = await Promise.all([
    getMemberRecord(ctx, memberId),
    employerOptions(ctx),
  ])

  // `getMemberRecord` scopes on firmId, so an id belonging to another firm
  // does not resolve — it 404s here rather than rendering somebody else's
  // health data (§7).
  if (!record) notFound()

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/ipm`}
        crumbs={[
          { label: ctx.firm.name, href: `/${firmSlug}/ipm` },
          { label: "IPM", href: `/${firmSlug}/ipm` },
          { label: "Participants", href: `/${firmSlug}/ipm/participants` },
          { label: record.matricule },
        ]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="p-4.5">
          <MemberRecordView
            firmSlug={firmSlug}
            record={record}
            employers={employers}
            canWrite={roleAtLeast(ctx.role, "MANAGER")}
          />
        </div>
      </div>
    </>
  )
}
