import type { Metadata } from "next"
import Link from "next/link"

import { DisbursementsView } from "@/app/[firmSlug]/ipm/decaissements/disbursements-view"
import { TopBar } from "@/components/shell/top-bar"
import { requireFirmPage } from "@/server/auth/firm-page"
import {
  disbursementSummary,
  listDisbursements,
  listProviderInvoices,
  listReimbursements,
} from "@/server/queries/ipm/disbursements"
import { roleAtLeast } from "@/types/auth"

export const metadata: Metadata = { title: "Décaissements" }

export default async function DisbursementsPage({
  params,
}: PageProps<"/[firmSlug]/ipm/decaissements">) {
  const { firmSlug } = await params
  const ctx = await requireFirmPage(firmSlug, { module: "ipm" })

  const [summary, invoices, reimbursements, disbursements] = await Promise.all([
    disbursementSummary(ctx),
    listProviderInvoices(ctx),
    listReimbursements(ctx),
    listDisbursements(ctx),
  ])

  const year = new Date().getFullYear()

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/ipm`}
        crumbs={[
          { label: ctx.firm.name, href: `/${firmSlug}/ipm` },
          { label: "IPM", href: `/${firmSlug}/ipm` },
          { label: "Décaissements" },
        ]}
        actions={
          <Link
            href={`/${firmSlug}/ipm/decaissements/export?from=${year}-01-01&to=${year}-12-31`}
            className="flex h-8 items-center rounded-[7px] border border-line px-2.5 text-[13px] hover:bg-sub"
          >
            Export comptable
          </Link>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="p-4.5">
          <div className="mb-3.5 flex items-center gap-3">
            <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
              Factures, remboursements et décaissements
            </h1>
          </div>

          <DisbursementsView
            firmSlug={firmSlug}
            summary={summary}
            invoices={invoices}
            reimbursements={reimbursements}
            disbursements={disbursements}
            canWrite={roleAtLeast(ctx.role, "MANAGER")}
          />
        </div>
      </div>
    </>
  )
}
