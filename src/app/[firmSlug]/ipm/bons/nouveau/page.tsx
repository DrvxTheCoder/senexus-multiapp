import type { Metadata } from "next"

import { IssueVoucherForm } from "@/app/[firmSlug]/ipm/bons/issue-voucher-form"
import { Panel } from "@/components/panel"
import { TopBar } from "@/components/shell/top-bar"
import { requireFirmPage } from "@/server/auth/firm-page"
import {
  accreditedProviders,
  memberOptions,
  serviceTypeOptions,
} from "@/server/queries/ipm/providers"

export const metadata: Metadata = { title: "Émettre un bon" }

export default async function NewVoucherPage({
  params,
}: PageProps<"/[firmSlug]/ipm/bons/nouveau">) {
  const { firmSlug } = await params
  const ctx = await requireFirmPage(firmSlug, { module: "ipm" })

  const [members, providers, serviceTypes] = await Promise.all([
    memberOptions(ctx, ""),
    accreditedProviders(ctx),
    serviceTypeOptions(ctx),
  ])

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/ipm`}
        crumbs={[
          { label: ctx.firm.name, href: `/${firmSlug}/ipm` },
          { label: "IPM", href: `/${firmSlug}/ipm` },
          { label: "Bons", href: `/${firmSlug}/ipm/bons` },
          { label: "Émettre" },
        ]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="p-4.5">
          <div className="mb-3.5 flex items-center gap-3">
            <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
              Émettre un bon de prise en charge
            </h1>
          </div>

          {serviceTypes.length === 0 ? (
            <Panel
              title="Aucune prestation au référentiel"
              description="Un bon porte sur un type de prestation, qui décide de sa catégorie et donc de son taux."
            >
              <p className="max-w-prose text-[13px] text-ink-3">
                Saisissez les types de prestation dans le référentiel avant
                d&apos;émettre un premier bon.
              </p>
            </Panel>
          ) : (
            <IssueVoucherForm
              firmSlug={firmSlug}
              members={members}
              providers={providers}
              serviceTypes={serviceTypes}
            />
          )}
        </div>
      </div>
    </>
  )
}
