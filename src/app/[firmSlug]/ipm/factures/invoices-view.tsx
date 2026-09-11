"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { useAction } from "@/components/forms/use-action"
import { Panel } from "@/components/panel"
import { EmptyState, StatusPill, TagCode, TwoFacts } from "@/components/primitives"
import { formatCurrency, formatDate, formatNumber } from "@/lib/format"
import { setInvoiceStatus } from "@/server/actions/ipm-ledger"
import type { InvoiceRow } from "@/server/queries/ipm/ledger"

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Brouillon",
  ISSUED: "Émise",
  PARTIALLY_PAID: "Partiellement réglée",
  PAID: "Réglée",
  OVERDUE: "En retard",
  CANCELLED: "Annulée",
}

const STATUS_TONES: Record<string, "ok" | "signal" | "alert" | "muted" | "brand"> = {
  DRAFT: "muted",
  ISSUED: "signal",
  PARTIALLY_PAID: "brand",
  PAID: "ok",
  OVERDUE: "alert",
  CANCELLED: "muted",
}

const MONTHS = [
  "janv.", "févr.", "mars", "avr.", "mai", "juin",
  "juil.", "août", "sept.", "oct.", "nov.", "déc.",
]

/**
 * Factures employeur.
 *
 * The status is editable, and each change records who set it and when. §4.8ter
 * is explicit about the reason: a "réglée" with no trace of who entered it has
 * no evidential value, so the field only exists on those terms.
 *
 * "En retard" is **derived from the due date**, not stored. A row does not
 * become overdue by somebody writing to it; it becomes overdue by a date
 * passing, and a stored flag would be wrong every morning until a job ran.
 */
export function InvoicesView({
  firmSlug,
  invoices,
  canWrite,
}: {
  firmSlug: string
  invoices: InvoiceRow[]
  canWrite: boolean
}) {
  const router = useRouter()
  const { run, pending } = useAction(setInvoiceStatus, {
    success: "Statut mis à jour.",
    onSuccess: () => router.refresh(),
  })

  const outstanding = invoices
    .filter((invoice) => !["PAID", "CANCELLED"].includes(invoice.status))
    .reduce((sum, invoice) => sum + invoice.totalAmount - invoice.paidAmount, 0)
  const overdue = invoices.filter((invoice) => invoice.overdue)

  return (
    <Panel
      title="Factures employeur"
      description="Une facture par employeur et par mois. La liste des participants est figée à la date d'arrêté."
      padded={false}
      stats={[
        { label: "Factures", value: formatNumber(invoices.length) },
        { label: "Restant dû", value: formatCurrency(outstanding) },
        {
          label: "En retard",
          value: formatNumber(overdue.length),
          tone: overdue.length > 0 ? "alert" : undefined,
        },
      ]}
    >
      {invoices.length === 0 ? (
        <EmptyState
          title="Aucune facture"
          description="Clôturez un mois depuis l'écran Cotisations pour émettre les factures."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-[13px]">
            <thead>
              <tr className="border-y border-line bg-sub text-left text-[11.5px] text-ink-3">
                <th className="px-[15px] py-2 font-medium">Numéro</th>
                <th className="px-[15px] py-2 font-medium">Employeur</th>
                <th className="px-[15px] py-2 font-medium">Période</th>
                <th className="px-[15px] py-2 font-medium">Participants</th>
                <th className="px-[15px] py-2 font-medium">Total</th>
                <th className="px-[15px] py-2 font-medium">Réglé</th>
                <th className="px-[15px] py-2 font-medium">Échéance</th>
                <th className="px-[15px] py-2 font-medium">Statut</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id} className="border-b border-line">
                  <td className="px-[15px] py-2.5">
                    <TagCode>{invoice.number}</TagCode>
                  </td>
                  <td className="px-[15px] py-2.5">
                    <TwoFacts
                      primary={invoice.employerName}
                      secondary={formatDate(invoice.issueDate)}
                    />
                  </td>
                  <td className="px-[15px] py-2.5 text-ink-3">
                    {MONTHS[invoice.periodMonth - 1]} {invoice.periodYear}
                  </td>
                  <td className="px-[15px] py-2.5 tabular-nums text-ink-3">
                    {formatNumber(invoice.memberCount)}
                  </td>
                  <td className="px-[15px] py-2.5 font-medium tabular-nums">
                    {formatCurrency(invoice.totalAmount)}
                  </td>
                  <td className="px-[15px] py-2.5 tabular-nums text-ink-3">
                    {invoice.paidAmount ? formatCurrency(invoice.paidAmount) : "—"}
                  </td>
                  <td className="px-[15px] py-2.5 tabular-nums">
                    <span className={invoice.overdue ? "text-alert" : "text-ink-3"}>
                      {formatDate(invoice.dueDate)}
                    </span>
                  </td>
                  <td className="px-[15px] py-2.5">
                    {canWrite ? (
                      <select
                        value={invoice.status}
                        disabled={pending}
                        onChange={(event) =>
                          void run({
                            firmSlug,
                            invoiceId: invoice.id,
                            status: event.target
                              .value as keyof typeof STATUS_LABELS as never,
                            paidAmount:
                              event.target.value === "PAID"
                                ? String(invoice.totalAmount)
                                : undefined,
                          })
                        }
                        aria-label={`Statut de ${invoice.number}`}
                        className="h-7 rounded-[7px] border border-line bg-surface px-1.5 text-[12.5px]"
                      >
                        {Object.entries(STATUS_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <StatusPill tone={STATUS_TONES[invoice.status] ?? "muted"}>
                        {STATUS_LABELS[invoice.status] ?? invoice.status}
                      </StatusPill>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
