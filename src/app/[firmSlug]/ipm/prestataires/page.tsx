import type { Metadata } from "next"

import { ProvidersView } from "@/app/[firmSlug]/ipm/prestataires/providers-view"
import { TopBar } from "@/components/shell/top-bar"
import { db } from "@/lib/db"
import { requireFirmPage } from "@/server/auth/firm-page"
import { listProviders } from "@/server/queries/ipm/providers"
import { roleAtLeast } from "@/types/auth"

export const metadata: Metadata = { title: "Prestataires" }

export default async function ProvidersPage({
  params,
}: PageProps<"/[firmSlug]/ipm/prestataires">) {
  const { firmSlug } = await params
  const ctx = await requireFirmPage(firmSlug, { module: "ipm" })

  const [providers, specialties] = await Promise.all([
    listProviders(ctx),
    db.ipmProviderSpecialty.findMany({
      where: { firmId: ctx.firmId, active: true },
      orderBy: { code: "asc" },
      select: { id: true, label: true },
    }),
  ])

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/ipm`}
        crumbs={[
          { label: ctx.firm.name, href: `/${firmSlug}/ipm` },
          { label: "IPM", href: `/${firmSlug}/ipm` },
          { label: "Prestataires" },
        ]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="p-4.5">
          <div className="mb-3.5 flex items-center gap-3">
            <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
              Prestataires et conventions
            </h1>
          </div>

          <ProvidersView
            firmSlug={firmSlug}
            providers={providers}
            specialties={specialties}
            canWrite={roleAtLeast(ctx.role, "MANAGER")}
          />
        </div>
      </div>
    </>
  )
}
