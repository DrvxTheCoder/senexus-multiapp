import type { Metadata } from "next"

import { PlansView } from "@/app/[firmSlug]/ipm/formules/plans-view"
import { TopBar } from "@/components/shell/top-bar"
import { requireFirmPage } from "@/server/auth/firm-page"
import { listCategories, listPlans } from "@/server/queries/ipm/plans"
import { roleAtLeast } from "@/types/auth"

export const metadata: Metadata = { title: "Formules" }

export default async function PlansPage({
  params,
}: PageProps<"/[firmSlug]/ipm/formules">) {
  const { firmSlug } = await params
  const ctx = await requireFirmPage(firmSlug, { module: "ipm" })

  const [plans, categories] = await Promise.all([
    listPlans(ctx),
    listCategories(ctx),
  ])

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/ipm`}
        crumbs={[
          { label: ctx.firm.name, href: `/${firmSlug}/ipm` },
          { label: "IPM", href: `/${firmSlug}/ipm` },
          { label: "Formules" },
        ]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="p-4.5">
          <div className="mb-3.5 flex items-center gap-3">
            <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
              Formules et barèmes
            </h1>
          </div>

          <PlansView
            firmSlug={firmSlug}
            plans={plans}
            categories={categories}
            canWrite={roleAtLeast(ctx.role, "MANAGER")}
          />
        </div>
      </div>
    </>
  )
}
