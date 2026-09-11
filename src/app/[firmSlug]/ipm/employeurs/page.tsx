import type { Metadata } from "next"

import { EmployersView } from "@/app/[firmSlug]/ipm/employeurs/employers-view"
import { TopBar } from "@/components/shell/top-bar"
import { requireFirmPage } from "@/server/auth/firm-page"
import {
  availableOrganizations,
  listEmployers,
} from "@/server/queries/ipm/employers"
import { listPlans } from "@/server/queries/ipm/plans"
import { roleAtLeast } from "@/types/auth"

export const metadata: Metadata = { title: "Employeurs" }

export default async function EmployersPage({
  params,
}: PageProps<"/[firmSlug]/ipm/employeurs">) {
  const { firmSlug } = await params
  const ctx = await requireFirmPage(firmSlug, { module: "ipm" })

  const [employers, plans, organizations] = await Promise.all([
    listEmployers(ctx),
    listPlans(ctx),
    availableOrganizations(ctx),
  ])

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/ipm`}
        crumbs={[
          { label: ctx.firm.name, href: `/${firmSlug}/ipm` },
          { label: "IPM", href: `/${firmSlug}/ipm` },
          { label: "Employeurs" },
        ]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="p-4.5">
          <div className="mb-3.5 flex items-center gap-3">
            <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
              Employeurs
            </h1>
          </div>

          <EmployersView
            firmSlug={firmSlug}
            employers={employers}
            plans={plans
              .filter((plan) => plan.active)
              .map((plan) => ({ id: plan.id, code: plan.code, name: plan.name }))}
            organizations={organizations}
            canWrite={roleAtLeast(ctx.role, "MANAGER")}
          />
        </div>
      </div>
    </>
  )
}
