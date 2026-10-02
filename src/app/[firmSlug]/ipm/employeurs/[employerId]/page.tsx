import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { EmployerRatesPanel } from "@/app/[firmSlug]/ipm/coverage-panels"
import { Panel } from "@/components/panel"
import { TopBar } from "@/components/shell/top-bar"
import { formatNumber } from "@/lib/format"
import { membersHref } from "@/lib/queries/ipm/member-params"
import { requireFirmPage } from "@/server/auth/firm-page"
import { coverageFor } from "@/server/queries/ipm/ceilings"
import { getEmployerSummary } from "@/server/queries/ipm/employers"
import { roleAtLeast } from "@/types/auth"

export const metadata: Metadata = { title: "Employeur" }

/**
 * La fiche employeur — its barème.
 *
 * Every participant of the employer inherits what is set here, above the
 * formule and below any plafond particulier. Each figure says where it comes
 * from, and the formule's value is shown beside every field of the dérogation
 * so nobody overrides a number they cannot see.
 */
export default async function EmployerPage({
  params,
}: PageProps<"/[firmSlug]/ipm/employeurs/[employerId]">) {
  const { firmSlug, employerId } = await params
  const ctx = await requireFirmPage(firmSlug, { module: "ipm" })

  const [employer, coverage] = await Promise.all([
    getEmployerSummary(ctx, employerId),
    coverageFor(ctx, { employerId }),
  ])
  // Scoped on firmId: an id from another firm 404s rather than resolving.
  if (!employer || !coverage) notFound()

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/ipm`}
        crumbs={[
          { label: ctx.firm.name, href: `/${firmSlug}/ipm` },
          { label: "IPM", href: `/${firmSlug}/ipm` },
          { label: "Employeurs", href: `/${firmSlug}/ipm/employeurs` },
          { label: employer.name },
        ]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-3.5 p-4.5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
              {employer.name}
            </h1>
          </div>

          <Panel title="Affiliation">
            <dl className="grid grid-cols-2 gap-x-5 gap-y-2 text-[13px] sm:grid-cols-4">
              <div>
                <dt className="text-[11.5px] text-ink-3">Formule</dt>
                <dd>{employer.planName ?? "Aucune — barème propre"}</dd>
              </div>
              <div>
                <dt className="text-[11.5px] text-ink-3">Participants actifs</dt>
                <dd>
                  <Link
                    href={membersHref(firmSlug, { employerId: [employer.id] })}
                    className="text-brand hover:underline"
                  >
                    {formatNumber(employer.activeMembers)}
                  </Link>
                </dd>
              </div>
              <div>
                <dt className="text-[11.5px] text-ink-3">Relevé</dt>
                <dd>
                  <Link
                    href={`/${firmSlug}/ipm/employeurs/${employer.id}/releve`}
                    className="text-brand hover:underline"
                  >
                    Cotisations et consommation
                  </Link>
                </dd>
              </div>
            </dl>
          </Panel>

          <EmployerRatesPanel
            firmSlug={firmSlug}
            employerId={employer.id}
            hasPlan={employer.planId !== null}
            rows={coverage}
            canWrite={roleAtLeast(ctx.role, "MANAGER")}
          />
        </div>
      </div>
    </>
  )
}
