import type { Metadata } from "next"

import { ContributionsView } from "@/app/[firmSlug]/ipm/cotisations/contributions-view"
import { TopBar } from "@/components/shell/top-bar"
import { db } from "@/lib/db"
import { requireFirmPage } from "@/server/auth/firm-page"
import { contributionSummary } from "@/server/queries/ipm/ledger"
import { roleAtLeast } from "@/types/auth"

export const metadata: Metadata = { title: "Cotisations" }

export default async function ContributionsPage({
  params,
}: PageProps<"/[firmSlug]/ipm/cotisations">) {
  const { firmSlug } = await params
  const ctx = await requireFirmPage(firmSlug, { module: "ipm" })

  const [summary, unopenedRows] = await Promise.all([
    contributionSummary(ctx),
    // Participants whose register carries no OPENING entry. `none` rather than
    // a left join in application code: the absence is the filter.
    db.member.findMany({
      where: {
        firmId: ctx.firmId,
        status: "ACTIVE",
        ledgerEntries: { none: { type: "OPENING" } },
      },
      orderBy: { matricule: "asc" },
      take: 200,
      select: {
        id: true,
        matricule: true,
        person: { select: { firstName: true, lastName: true } },
        employer: { select: { organization: { select: { name: true } } } },
        contributions: {
          where: { validTo: null },
          select: { monthlyAmount: true },
          take: 1,
        },
      },
    }),
  ])

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/ipm`}
        crumbs={[
          { label: ctx.firm.name, href: `/${firmSlug}/ipm` },
          { label: "IPM", href: `/${firmSlug}/ipm` },
          { label: "Cotisations" },
        ]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="p-4.5">
          <div className="mb-3.5 flex items-center gap-3">
            <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
              Cotisations et registre
            </h1>
          </div>

          <ContributionsView
            firmSlug={firmSlug}
            summary={summary}
            unopened={unopenedRows.map((member) => ({
              id: member.id,
              matricule: member.matricule,
              name: `${member.person.lastName.toUpperCase()} ${member.person.firstName}`,
              employerName: member.employer.organization.name,
              monthlyContribution: member.contributions[0]
                ? Number(member.contributions[0].monthlyAmount)
                : null,
            }))}
            canWrite={roleAtLeast(ctx.role, "MANAGER")}
          />
        </div>
      </div>
    </>
  )
}
