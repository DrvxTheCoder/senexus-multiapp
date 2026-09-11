import type { Metadata } from "next"
import { Suspense } from "react"

import { VouchersView } from "@/app/[firmSlug]/ipm/bons/vouchers-view"
import { Panel } from "@/components/panel"
import { TableSkeleton } from "@/components/primitives"
import { TopBar } from "@/components/shell/top-bar"
import {
  loadVoucherSearchParams,
  toVoucherQuery,
} from "@/lib/queries/ipm/voucher-params"
import { requireFirmPage } from "@/server/auth/firm-page"
import { getVoucher, listVouchers, voucherSummary } from "@/server/queries/ipm/vouchers"
import { roleAtLeast } from "@/types/auth"

export const metadata: Metadata = { title: "Bons" }

export default async function VouchersPage({
  params,
  searchParams,
}: PageProps<"/[firmSlug]/ipm/bons">) {
  const { firmSlug } = await params
  const ctx = await requireFirmPage(firmSlug, { module: "ipm" })
  const raw = await searchParams

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/ipm`}
        crumbs={[
          { label: ctx.firm.name, href: `/${firmSlug}/ipm` },
          { label: "IPM", href: `/${firmSlug}/ipm` },
          { label: "Bons" },
        ]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="p-4.5">
          <div className="mb-3.5 flex items-center gap-3">
            <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
              Bons de prise en charge
            </h1>
          </div>

          <Suspense fallback={<VouchersSkeleton />}>
            <VouchersPanel firmSlug={firmSlug} raw={raw} />
          </Suspense>
        </div>
      </div>
    </>
  )
}

async function VouchersPanel({
  firmSlug,
  raw,
}: {
  firmSlug: string
  raw: Awaited<PageProps<"/[firmSlug]/ipm/bons">["searchParams"]>
}) {
  const ctx = await requireFirmPage(firmSlug, { module: "ipm" })
  const parsed = loadVoucherSearchParams(raw)
  const query = toVoucherQuery(parsed)

  const [page, summary] = await Promise.all([
    listVouchers(ctx, query),
    voucherSummary(ctx),
  ])

  // The drawer is part of the URL, so its contents are fetched on the server
  // like everything else — opening one is a navigation, not a client fetch.
  const open = parsed.open ? await getVoucher(ctx, parsed.open) : null

  return (
    <VouchersView
      firmSlug={firmSlug}
      page={page}
      summary={summary}
      open={
        open
          ? {
              id: open.id,
              number: open.number,
              type: open.type,
              status: open.status,
              issueDate: open.issueDate,
              expiryDate: open.expiryDate,
              beneficiaryName: open.beneficiaryName,
              memberId: open.member.id,
              memberMatricule: open.member.matricule,
              providerName: open.provider.name,
              categoryLabel: open.category.label,
              serviceTypeLabel: open.serviceType.label,
              totalAmount: Number(open.totalAmount),
              insurerShare: Number(open.insurerShare),
              memberShare: Number(open.memberShare),
              appliedRate: Number(open.appliedRate),
              rateSource: open.rateSource,
              settledAt: open.settledAt,
              cancelledAt: open.cancelledAt,
              cancelReason: open.cancelReason,
              issuedByName: open.issuedBy?.name ?? open.issuedBy?.email ?? null,
              settledByName:
                open.settledBy?.name ?? open.settledBy?.email ?? null,
              lines: open.lines.map((line) => ({
                id: line.id,
                label: line.label,
                quantity: Number(line.quantity),
                unitPrice: Number(line.unitPrice),
                amount: Number(line.amount),
              })),
            }
          : null
      }
      canWrite={roleAtLeast(ctx.role, "MANAGER")}
    />
  )
}

function VouchersSkeleton() {
  return (
    <Panel title="Bons émis" padded={false}>
      <div className="h-[49px] border-b border-line" />
      <TableSkeleton rows={10} columns={[18, 22, 20, 12, 12, 10, 10]} />
    </Panel>
  )
}
