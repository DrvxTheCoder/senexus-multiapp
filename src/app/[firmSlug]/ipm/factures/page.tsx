import type { Metadata } from "next"

import { InvoicesView } from "@/app/[firmSlug]/ipm/factures/invoices-view"
import { TopBar } from "@/components/shell/top-bar"
import { requireFirmPage } from "@/server/auth/firm-page"
import { listInvoices } from "@/server/queries/ipm/ledger"
import { roleAtLeast } from "@/types/auth"

export const metadata: Metadata = { title: "Factures" }

export default async function InvoicesPage({
  params,
}: PageProps<"/[firmSlug]/ipm/factures">) {
  const { firmSlug } = await params
  const ctx = await requireFirmPage(firmSlug, { module: "ipm" })
  const invoices = await listInvoices(ctx)

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/ipm`}
        crumbs={[
          { label: ctx.firm.name, href: `/${firmSlug}/ipm` },
          { label: "IPM", href: `/${firmSlug}/ipm` },
          { label: "Factures" },
        ]}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4.5">
          <div className="mb-3.5 flex items-center gap-3">
            <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
              Factures employeur
            </h1>
          </div>
          <InvoicesView
            firmSlug={firmSlug}
            invoices={invoices}
            canWrite={roleAtLeast(ctx.role, "MANAGER")}
          />
        </div>
      </div>
    </>
  )
}
