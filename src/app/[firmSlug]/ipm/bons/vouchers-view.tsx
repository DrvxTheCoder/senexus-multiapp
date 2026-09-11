"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { useAction } from "@/components/forms/use-action"
import { Panel } from "@/components/panel"
import { EmptyState, StatusPill, TagCode, TwoFacts } from "@/components/primitives"
import { formatCurrency, formatDate, formatNumber } from "@/lib/format"
import { cancelVoucher, settleVoucher } from "@/server/actions/ipm-vouchers"
import type { VoucherRow, VoucherSummary } from "@/server/queries/ipm/vouchers"
import type { Paged } from "@/server/queries/types"

const STATUS_LABELS: Record<string, string> = {
  ISSUED: "Émis",
  PRESENTED: "Présenté",
  SETTLED: "Réglé",
  INVOICED: "Facturé",
  CANCELLED: "Annulé",
  EXPIRED: "Expiré",
}

const STATUS_TONES: Record<string, "ok" | "signal" | "alert" | "muted" | "brand"> = {
  ISSUED: "signal",
  PRESENTED: "brand",
  SETTLED: "ok",
  INVOICED: "ok",
  CANCELLED: "muted",
  EXPIRED: "alert",
}

const TYPE_LABELS: Record<string, string> = {
  PHARMACY: "Pharmacie",
  OPTICAL: "Optique",
  GUARANTEE: "Garantie",
  HOSPITALIZATION: "Hospitalisation",
}

/**
 * Bons.
 *
 * The two figures in the header are the ones that matter operationally:
 * how many bons are in circulation, and how much the institution has already
 * committed against them. `outstanding` is money promised but not yet settled
 * — it is what a plafond has already consumed and what will land as an
 * invoice, so it belongs next to the count rather than in a report nobody
 * opens.
 */
export function VouchersView({
  firmSlug,
  page,
  summary,
  canWrite,
}: {
  firmSlug: string
  page: Paged<VoucherRow>
  summary: VoucherSummary
  canWrite: boolean
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [search, setSearch] = React.useState(params.get("q") ?? "")

  const settle = useAction(settleVoucher, {
    success: "Bon réglé.",
    onSuccess: () => router.refresh(),
  })
  const cancel = useAction(cancelVoucher, {
    success: "Bon annulé.",
    onSuccess: () => router.refresh(),
  })

  const statusFilter = params.get("status")

  const go = (next: Record<string, string | null>) => {
    const query = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") query.delete(key)
      else query.set(key, value)
    }
    router.push(`/${firmSlug}/ipm/bons?${query.toString()}`)
  }

  return (
    <Panel
      title="Bons émis"
      description="Un bon engage l'institution dès son émission : sa part est comptée dans les plafonds avant même d'être facturée."
      padded={false}
      stats={[
        { label: "En circulation", value: formatNumber(summary.issued) },
        {
          label: "Engagé non réglé",
          value: formatCurrency(summary.outstanding),
          tone: summary.outstanding > 0 ? "signal" : undefined,
        },
        { label: "Réglés ce mois", value: formatCurrency(summary.settledThisMonth) },
      ]}
      tools={
        <div className="flex flex-wrap items-center gap-2">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              go({ q: search || null, page: null })
            }}
          >
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Numéro, nom, matricule…"
              aria-label="Rechercher un bon"
              className="h-8 w-56 rounded-control border border-line bg-surface px-2 text-[13px] outline-none focus:border-brand"
            />
          </form>
          <select
            value={statusFilter ?? ""}
            onChange={(event) => go({ status: event.target.value || null, page: null })}
            aria-label="Filtrer par statut"
            className="h-8 rounded-control border border-line bg-surface px-2 text-[13px] outline-none focus:border-brand"
          >
            <option value="">Tous les statuts</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      }
      footer={{
        summary: `${formatNumber(page.total)} bon${page.total > 1 ? "s" : ""}`,
        action:
          page.pageCount > 1 ? (
            <span className="flex items-center gap-2 text-[13px]">
              <button
                type="button"
                disabled={page.page <= 1}
                onClick={() => go({ page: String(page.page - 1) })}
                className="rounded-control border border-line px-2 py-1 disabled:opacity-40"
              >
                Précédent
              </button>
              <span className="text-ink-3">
                {page.page} / {page.pageCount}
              </span>
              <button
                type="button"
                disabled={page.page >= page.pageCount}
                onClick={() => go({ page: String(page.page + 1) })}
                className="rounded-control border border-line px-2 py-1 disabled:opacity-40"
              >
                Suivant
              </button>
            </span>
          ) : null,
      }}
    >
      {page.rows.length === 0 ? (
        <EmptyState
          title="Aucun bon"
          description="Émettez un bon depuis la fiche d'un participant ou avec le bouton Émettre."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-[13px]">
            <thead>
              <tr className="border-y border-line bg-sub text-left text-[11.5px] text-ink-3">
                <th className="px-[15px] py-2 font-medium">Numéro</th>
                <th className="px-[15px] py-2 font-medium">Bénéficiaire</th>
                <th className="px-[15px] py-2 font-medium">Prestataire</th>
                <th className="px-[15px] py-2 font-medium">Total</th>
                <th className="px-[15px] py-2 font-medium">Part IPM</th>
                <th className="px-[15px] py-2 font-medium">Ticket</th>
                <th className="px-[15px] py-2 font-medium">Statut</th>
                {canWrite ? <th className="px-[15px] py-2" /> : null}
              </tr>
            </thead>
            <tbody>
              {page.rows.map((voucher) => (
                <tr key={voucher.id} className="border-b border-line">
                  <td className="px-[15px] py-2.5">
                    <TagCode>{voucher.number}</TagCode>
                    <div className="mt-px text-[11.5px] text-ink-3">
                      {TYPE_LABELS[voucher.type] ?? voucher.type} ·{" "}
                      {formatDate(voucher.issueDate)}
                    </div>
                  </td>
                  <td className="px-[15px] py-2.5">
                    <TwoFacts
                      primary={voucher.beneficiaryName}
                      secondary={voucher.memberMatricule}
                    />
                  </td>
                  <td className="px-[15px] py-2.5">
                    <TwoFacts
                      primary={voucher.providerName}
                      secondary={voucher.categoryLabel}
                    />
                  </td>
                  <td className="px-[15px] py-2.5 tabular-nums">
                    {formatCurrency(voucher.totalAmount)}
                  </td>
                  <td className="px-[15px] py-2.5 font-medium tabular-nums">
                    {formatCurrency(voucher.insurerShare)}
                  </td>
                  <td className="px-[15px] py-2.5 tabular-nums text-ink-3">
                    {formatCurrency(voucher.memberShare)}
                  </td>
                  <td className="px-[15px] py-2.5">
                    <StatusPill tone={STATUS_TONES[voucher.status] ?? "muted"}>
                      {STATUS_LABELS[voucher.status] ?? voucher.status}
                    </StatusPill>
                  </td>
                  {canWrite ? (
                    <td className="px-[15px] py-2.5 text-right whitespace-nowrap">
                      {voucher.status === "ISSUED" ||
                      voucher.status === "PRESENTED" ? (
                        <>
                          <button
                            type="button"
                            disabled={settle.pending}
                            onClick={() =>
                              void settle.run({
                                firmSlug,
                                voucherId: voucher.id,
                                settledOn: new Date().toISOString().slice(0, 10),
                              })
                            }
                            className="rounded-control border border-line px-2 py-1 text-[12.5px] hover:bg-sub disabled:opacity-50"
                          >
                            Régler
                          </button>
                          <button
                            type="button"
                            disabled={cancel.pending}
                            onClick={() => {
                              const reason = window.prompt(
                                "Motif de l'annulation ?"
                              )
                              if (!reason) return
                              void cancel.run({
                                firmSlug,
                                voucherId: voucher.id,
                                reason,
                              })
                            }}
                            className="ml-1.5 rounded-control border border-line px-2 py-1 text-[12.5px] text-alert hover:bg-sub disabled:opacity-50"
                          >
                            Annuler
                          </button>
                        </>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
