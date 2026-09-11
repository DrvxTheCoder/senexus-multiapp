import type { Metadata } from "next"

import { CardsView } from "@/app/[firmSlug]/ipm/cartes/cards-view"
import { TopBar } from "@/components/shell/top-bar"
import { requireFirmPage } from "@/server/auth/firm-page"
import { listCards } from "@/server/queries/ipm/cards"
import { roleAtLeast } from "@/types/auth"

export const metadata: Metadata = { title: "Cartes" }

export default async function CardsPage({
  params,
}: PageProps<"/[firmSlug]/ipm/cartes">) {
  const { firmSlug } = await params
  const ctx = await requireFirmPage(firmSlug, { module: "ipm" })

  const cards = await listCards(ctx)

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/ipm`}
        crumbs={[
          { label: ctx.firm.name, href: `/${firmSlug}/ipm` },
          { label: "IPM", href: `/${firmSlug}/ipm` },
          { label: "Cartes" },
        ]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="p-4.5">
          <div className="mb-3.5 flex items-center gap-3">
            <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
              Cartes
            </h1>
          </div>

          <CardsView
            firmSlug={firmSlug}
            cards={cards}
            canWrite={roleAtLeast(ctx.role, "MANAGER")}
          />
        </div>
      </div>
    </>
  )
}
