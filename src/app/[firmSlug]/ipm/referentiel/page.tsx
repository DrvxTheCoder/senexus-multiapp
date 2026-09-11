import type { Metadata } from "next"

import { ReferentielView } from "@/app/[firmSlug]/ipm/referentiel/referentiel-view"
import { TopBar } from "@/components/shell/top-bar"
import { db } from "@/lib/db"
import { requireFirmPage } from "@/server/auth/firm-page"
import { roleAtLeast } from "@/types/auth"

export const metadata: Metadata = { title: "Référentiel" }

export default async function ReferentielPage({
  params,
}: PageProps<"/[firmSlug]/ipm/referentiel">) {
  const { firmSlug } = await params
  const ctx = await requireFirmPage(firmSlug, { module: "ipm" })

  const [categories, serviceTypes, specialties] = await Promise.all([
    db.ipmServiceCategory.findMany({
      where: { firmId: ctx.firmId },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        label: true,
        sortOrder: true,
        active: true,
        _count: { select: { serviceTypes: true } },
      },
    }),
    db.ipmServiceType.findMany({
      where: { firmId: ctx.firmId },
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        label: true,
        accountCode: true,
        category: { select: { label: true } },
      },
      take: 200,
    }),
    db.ipmProviderSpecialty.findMany({
      where: { firmId: ctx.firmId },
      orderBy: { code: "asc" },
      select: { id: true, code: true, label: true, accountCode: true },
      take: 200,
    }),
  ])

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/ipm`}
        crumbs={[
          { label: ctx.firm.name, href: `/${firmSlug}/ipm` },
          { label: "IPM", href: `/${firmSlug}/ipm` },
          { label: "Référentiel" },
        ]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="p-4.5">
          <div className="mb-3.5 flex items-center gap-3">
            <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
              Référentiel
            </h1>
          </div>

          <ReferentielView
            firmSlug={firmSlug}
            categories={categories.map((category) => ({
              id: category.id,
              code: category.code,
              label: category.label,
              sortOrder: category.sortOrder,
              active: category.active,
              serviceTypeCount: category._count.serviceTypes,
            }))}
            serviceTypes={serviceTypes.map((serviceType) => ({
              id: serviceType.id,
              code: serviceType.code,
              label: serviceType.label,
              accountCode: serviceType.accountCode,
              categoryLabel: serviceType.category.label,
            }))}
            specialties={specialties}
            canWrite={roleAtLeast(ctx.role, "MANAGER")}
          />
        </div>
      </div>
    </>
  )
}
