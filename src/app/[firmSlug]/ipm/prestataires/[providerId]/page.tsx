import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { ProviderAccessPanel } from "@/app/[firmSlug]/ipm/prestataires/[providerId]/provider-access"
import { Panel } from "@/components/panel"
import { StatusPill } from "@/components/primitives"
import { TopBar } from "@/components/shell/top-bar"
import { formatCurrency, formatNumber } from "@/lib/format"
import { vouchersHref } from "@/lib/queries/ipm/voucher-params"
import { requireFirmPage } from "@/server/auth/firm-page"
import { providerAccessRecord } from "@/server/queries/ipm/providers"
import { roleAtLeast } from "@/types/auth"

export const metadata: Metadata = { title: "Prestataire" }

/**
 * Fiche prestataire — for now, what the bon de pharmacie needs: the
 * pharmacy's access to the portal (created, reset and switched off here, never
 * by the pharmacy itself) and where its bons stand this month.
 */
export default async function ProviderPage({
  params,
}: PageProps<"/[firmSlug]/ipm/prestataires/[providerId]">) {
  const { firmSlug, providerId } = await params
  const ctx = await requireFirmPage(firmSlug, { module: "ipm" })
  const record = await providerAccessRecord(ctx, providerId)
  if (!record) notFound()

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/ipm`}
        crumbs={[
          { label: ctx.firm.name, href: `/${firmSlug}/ipm` },
          { label: "Prestataires", href: `/${firmSlug}/ipm/prestataires` },
          { label: record.name },
        ]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-3.5 p-4.5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
              {record.name}
            </h1>
            {record.accredited ? (
              <StatusPill tone="ok">Agréé</StatusPill>
            ) : (
              <StatusPill tone="muted">Non agréé</StatusPill>
            )}
            {record.specialtyLabel ? (
              <span className="text-[13px] text-ink-3">{record.specialtyLabel}</span>
            ) : null}
          </div>

          <ProviderAccessPanel
            firmSlug={firmSlug}
            record={record}
            canWrite={roleAtLeast(ctx.role, "MANAGER")}
          />

          <Panel
            titleAs="h2"
            title="Bons de pharmacie"
            stats={[
              {
                label: "En attente de montant",
                value: formatNumber(record.pharmacy.awaiting),
                tone: record.pharmacy.awaiting > 0 ? "signal" : undefined,
              },
              {
                label: "Validés ce mois",
                value: formatNumber(record.pharmacy.validatedThisMonth),
              },
              {
                label: "Montant validé ce mois",
                value: formatCurrency(record.pharmacy.validatedAmountThisMonth),
              },
            ]}
          >
            <a
              href={vouchersHref(firmSlug, { providerId: [record.id], type: ["PHARMACY"] })}
              className="text-[13px] text-brand hover:underline"
            >
              Voir les bons de ce prestataire
            </a>
          </Panel>
        </div>
      </div>
    </>
  )
}
