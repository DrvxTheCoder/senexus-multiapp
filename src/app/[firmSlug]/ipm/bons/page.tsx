import type { Metadata } from "next"
import Link from "next/link"

import { VouchersView } from "@/app/[firmSlug]/ipm/bons/vouchers-view"
import { TopBar } from "@/components/shell/top-bar"
import { requireFirmPage } from "@/server/auth/firm-page"
import { listVouchers, voucherSummary } from "@/server/queries/ipm/vouchers"
import { roleAtLeast } from "@/types/auth"

export const metadata: Metadata = { title: "Bons" }

export default async function VouchersPage({
  params,
  searchParams,
}: PageProps<"/[firmSlug]/ipm/bons">) {
  const { firmSlug } = await params
  const ctx = await requireFirmPage(firmSlug, { module: "ipm" })
  const raw = await searchParams

  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value

  const page = Number(first(raw.page) ?? 1) || 1
  const status = first(raw.status)

  const [vouchers, summary] = await Promise.all([
    listVouchers(ctx, {
      search: first(raw.q) || undefined,
      status: status ? [status] : undefined,
      page,
      perPage: 25,
    }),
    voucherSummary(ctx),
  ])

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/ipm`}
        crumbs={[
          { label: ctx.firm.name, href: `/${firmSlug}/ipm` },
          { label: "IPM", href: `/${firmSlug}/ipm` },
          { label: "Bons" },
        ]}
        actions={
          roleAtLeast(ctx.role, "MANAGER") ? (
            <Link
              href={`/${firmSlug}/ipm/bons/nouveau`}
              className="flex h-8 items-center rounded-control bg-brand px-2.5 text-[13px] font-medium text-on-brand hover:opacity-90"
            >
              Émettre un bon
            </Link>
          ) : null
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="p-4.5">
          <div className="mb-3.5 flex items-center gap-3">
            <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
              Bons de prise en charge
            </h1>
          </div>

          <VouchersView
            firmSlug={firmSlug}
            page={vouchers}
            summary={summary}
            canWrite={roleAtLeast(ctx.role, "MANAGER")}
          />
        </div>
      </div>
    </>
  )
}
