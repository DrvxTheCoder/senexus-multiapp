"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { useAction } from "@/components/forms/use-action"
import { Panel } from "@/components/panel"
import {
  EmptyState,
  SegmentedControl,
  StatusPill,
  TagCode,
  TwoFacts,
} from "@/components/primitives"
import { formatCurrency, formatDate, formatNumber } from "@/lib/format"
import {
  checkProviderInvoice,
  createDisbursement,
  reviewReimbursement,
  visaDisbursement,
} from "@/server/actions/ipm-disbursements"
import { amountInWords } from "@/server/domain/ipm/amount-in-words"
import type {
  DisbursementRow,
  DisbursementSummary,
  ProviderInvoiceRow,
  ReimbursementRow,
} from "@/server/queries/ipm/disbursements"

type Tab = "INVOICES" | "REIMBURSEMENTS" | "DISBURSEMENTS"

const INVOICE_STATUS: Record<string, string> = {
  RECEIVED: "Reçue",
  CHECKED: "Contrôlée",
  APPROVED: "Approuvée",
  PAID: "Réglée",
  REJECTED: "Rejetée",
}

const REIMB_STATUS: Record<string, string> = {
  SUBMITTED: "Déposé",
  REVIEWING: "En cours",
  APPROVED: "Approuvé",
  REJECTED: "Rejeté",
  PAID: "Réglé",
}

const DISB_STATUS: Record<string, string> = {
  DRAFT: "Brouillon",
  APPROVED: "Visa direction",
  POSTED: "Visa comptabilité",
  PAID: "Remis",
  CANCELLED: "Annulé",
}

const TONE: Record<string, "ok" | "signal" | "alert" | "muted" | "brand"> = {
  RECEIVED: "signal",
  CHECKED: "brand",
  APPROVED: "brand",
  PAID: "ok",
  REJECTED: "alert",
  SUBMITTED: "signal",
  REVIEWING: "brand",
  DRAFT: "muted",
  POSTED: "brand",
  CANCELLED: "muted",
}

/**
 * Décaissements.
 *
 * Three queues in one screen, because they are three stages of one flow:
 * a provider invoice or a member claim is checked, then approved, then a bon
 * de décaissement settles it. Splitting them across three pages would hide
 * the fact that the third cannot happen without the first two.
 *
 * The **écart** column is the reason the invoice queue exists at all: what a
 * provider claims against the sum of the bons actually issued to them. Nobody
 * checks invoices today because WebLamps cannot produce that number.
 */
export function DisbursementsView({
  firmSlug,
  summary,
  invoices,
  reimbursements,
  disbursements,
  canWrite,
}: {
  firmSlug: string
  summary: DisbursementSummary
  invoices: ProviderInvoiceRow[]
  reimbursements: ReimbursementRow[]
  disbursements: DisbursementRow[]
  canWrite: boolean
}) {
  const router = useRouter()
  const [tab, setTab] = React.useState<Tab>("INVOICES")
  const [selected, setSelected] = React.useState<Set<string>>(new Set())

  const check = useAction(checkProviderInvoice, {
    success: "Facture mise à jour.",
    onSuccess: () => router.refresh(),
  })
  const review = useAction(reviewReimbursement, {
    success: "Remboursement traité.",
    onSuccess: () => router.refresh(),
  })
  const visa = useAction(visaDisbursement, {
    success: "Visa apposé.",
    onSuccess: () => router.refresh(),
  })
  const create = useAction(createDisbursement, {
    success: (data: { number: string; amount: number }) =>
      `Bon n° ${data.number} — ${amountInWords(data.amount)}.`,
    onSuccess: () => {
      setSelected(new Set())
      router.refresh()
    },
  })

  const approvedInvoices = invoices.filter(
    (invoice) => invoice.status === "APPROVED" && !invoice.disbursementNumber
  )
  const approvedReimbursements = reimbursements.filter(
    (entry) => entry.status === "APPROVED" && !entry.disbursementNumber
  )

  const selectedTotal =
    approvedInvoices
      .filter((invoice) => selected.has(invoice.id))
      .reduce((sum, invoice) => sum + invoice.totalAmount, 0) +
    approvedReimbursements
      .filter((entry) => selected.has(entry.id))
      .reduce((sum, entry) => sum + entry.insurerShare, 0)

  const toggle = (id: string) =>
    setSelected((state) => {
      const next = new Set(state)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="space-y-3.5">
      <Panel
        title="Décaissements"
        description="Facture ou remboursement, contrôlé puis approuvé, puis réglé par un bon de décaissement."
        stats={[
          {
            label: "Factures à contrôler",
            value: formatNumber(summary.invoicesToCheck),
            tone: summary.invoicesToCheck > 0 ? "signal" : undefined,
          },
          {
            label: "Remboursements à traiter",
            value: formatNumber(summary.reimbursementsToReview),
            tone: summary.reimbursementsToReview > 0 ? "signal" : undefined,
          },
          {
            label: "Écart en cours",
            value: formatCurrency(summary.openVariance),
            tone: summary.openVariance !== 0 ? "alert" : "ok",
          },
          {
            label: "Approuvé non remis",
            value: formatCurrency(summary.approvedUnpaid),
          },
        ]}
        tools={
          <SegmentedControl
            ariaLabel="Type de pièce"
            value={tab}
            onChange={setTab}
            options={[
              { value: "INVOICES", label: `Factures (${invoices.length})` },
              {
                value: "REIMBURSEMENTS",
                label: `Remboursements (${reimbursements.length})`,
              },
              { value: "DISBURSEMENTS", label: `Bons (${disbursements.length})` },
            ]}
          />
        }
      >
        <p className="max-w-prose text-[13px] text-ink-3">
          L&apos;écart est la différence entre ce que le prestataire réclame et
          la somme des parts IPM des bons réellement émis sur la période. Un
          écart positif veut dire que la facture dépasse les bons rapprochés.
        </p>
      </Panel>

      {tab === "INVOICES" ? (
        <Panel
          titleAs="h2"
          title="Factures prestataires"
          padded={false}
          footer={
            canWrite && selected.size > 0
              ? {
                  summary: `${selected.size} pièce(s) — ${formatCurrency(selectedTotal)}`,
                  action: (
                    <button
                      type="button"
                      disabled={create.pending}
                      onClick={() =>
                        void create.run({
                          firmSlug,
                          journalCode: "B1",
                          date: new Date().toISOString().slice(0, 10),
                          payeeType: "PROVIDER",
                          payeeName:
                            approvedInvoices.find((invoice) =>
                              selected.has(invoice.id)
                            )?.providerName ?? "Prestataire",
                          motif: "Règlement factures prestataires",
                          paymentMethod: "TRANSFER",
                          providerInvoiceIds: approvedInvoices
                            .filter((invoice) => selected.has(invoice.id))
                            .map((invoice) => invoice.id),
                          reimbursementIds: [],
                        })
                      }
                      className="h-8 rounded-[7px] bg-brand px-2.5 text-[13px] font-medium text-brand-contrast hover:opacity-90 disabled:opacity-50"
                    >
                      Établir le bon de décaissement
                    </button>
                  ),
                }
              : undefined
          }
        >
          {invoices.length === 0 ? (
            <EmptyState
              title="Aucune facture prestataire"
              description="Les factures arrivent par courrier et sont enregistrées ici pour être rapprochées des bons."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-[13px]">
                <thead>
                  <tr className="border-y border-line bg-sub text-left text-[11.5px] text-ink-3">
                    {canWrite ? <th className="px-[15px] py-2" /> : null}
                    <th className="px-[15px] py-2 font-medium">Facture</th>
                    <th className="px-[15px] py-2 font-medium">Période</th>
                    <th className="px-[15px] py-2 font-medium">Réclamé</th>
                    <th className="px-[15px] py-2 font-medium">Bons rapprochés</th>
                    <th className="px-[15px] py-2 font-medium">Écart</th>
                    <th className="px-[15px] py-2 font-medium">Statut</th>
                    {canWrite ? <th className="px-[15px] py-2" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id} className="border-b border-line">
                      {canWrite ? (
                        <td className="px-[15px] py-2.5">
                          {invoice.status === "APPROVED" &&
                          !invoice.disbursementNumber ? (
                            <input
                              type="checkbox"
                              checked={selected.has(invoice.id)}
                              onChange={() => toggle(invoice.id)}
                              aria-label={`Sélectionner ${invoice.number}`}
                            />
                          ) : null}
                        </td>
                      ) : null}
                      <td className="px-[15px] py-2.5">
                        <TwoFacts
                          primary={invoice.providerName}
                          secondary={invoice.number}
                        />
                      </td>
                      <td className="px-[15px] py-2.5 tabular-nums text-ink-3">
                        {formatDate(invoice.periodFrom)} →{" "}
                        {formatDate(invoice.periodTo)}
                      </td>
                      <td className="px-[15px] py-2.5 tabular-nums">
                        {formatCurrency(invoice.totalAmount)}
                      </td>
                      <td className="px-[15px] py-2.5 tabular-nums text-ink-3">
                        {formatCurrency(invoice.matchedAmount)}
                      </td>
                      <td className="px-[15px] py-2.5">
                        <span
                          className={`tabular-nums ${invoice.variance !== 0 ? "text-alert" : "text-ok"}`}
                        >
                          {invoice.variance > 0 ? "+" : ""}
                          {formatCurrency(invoice.variance)}
                        </span>
                      </td>
                      <td className="px-[15px] py-2.5">
                        <StatusPill tone={TONE[invoice.status] ?? "muted"}>
                          {INVOICE_STATUS[invoice.status] ?? invoice.status}
                        </StatusPill>
                      </td>
                      {canWrite ? (
                        <td className="px-[15px] py-2.5 text-right whitespace-nowrap">
                          {["RECEIVED", "CHECKED"].includes(invoice.status) ? (
                            <>
                              <button
                                type="button"
                                disabled={check.pending}
                                onClick={() =>
                                  void check.run({
                                    firmSlug,
                                    invoiceId: invoice.id,
                                    decision:
                                      invoice.status === "RECEIVED"
                                        ? "CHECKED"
                                        : "APPROVED",
                                  })
                                }
                                className="rounded-[7px] border border-line px-2 py-1 text-[12.5px] hover:bg-sub disabled:opacity-50"
                              >
                                {invoice.status === "RECEIVED"
                                  ? "Contrôler"
                                  : "Approuver"}
                              </button>
                              <button
                                type="button"
                                disabled={check.pending}
                                onClick={() => {
                                  const reason = window.prompt("Motif du rejet ?")
                                  if (!reason) return
                                  void check.run({
                                    firmSlug,
                                    invoiceId: invoice.id,
                                    decision: "REJECTED",
                                    rejectReason: reason,
                                  })
                                }}
                                className="ml-1.5 rounded-[7px] border border-line px-2 py-1 text-[12.5px] text-alert hover:bg-sub disabled:opacity-50"
                              >
                                Rejeter
                              </button>
                            </>
                          ) : invoice.disbursementNumber ? (
                            <span className="text-[12.5px] text-ink-3">
                              Bon n° {invoice.disbursementNumber}
                            </span>
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
      ) : null}

      {tab === "REIMBURSEMENTS" ? (
        <Panel titleAs="h2" title="Remboursements" padded={false}>
          {reimbursements.length === 0 ? (
            <EmptyState
              title="Aucun remboursement"
              description="Un participant qui a payé de sa poche dépose une demande ; elle est tarifée au même taux qu'un bon."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[840px] text-[13px]">
                <thead>
                  <tr className="border-y border-line bg-sub text-left text-[11.5px] text-ink-3">
                    <th className="px-[15px] py-2 font-medium">Demande</th>
                    <th className="px-[15px] py-2 font-medium">Participant</th>
                    <th className="px-[15px] py-2 font-medium">Catégorie</th>
                    <th className="px-[15px] py-2 font-medium">Engagé</th>
                    <th className="px-[15px] py-2 font-medium">Part IPM</th>
                    <th className="px-[15px] py-2 font-medium">Statut</th>
                    {canWrite ? <th className="px-[15px] py-2" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {reimbursements.map((entry) => (
                    <tr key={entry.id} className="border-b border-line">
                      <td className="px-[15px] py-2.5">
                        <TagCode>{entry.number}</TagCode>
                        <div className="mt-px text-[11.5px] text-ink-3">
                          {formatDate(entry.submittedDate)}
                        </div>
                      </td>
                      <td className="px-[15px] py-2.5">
                        <TwoFacts
                          primary={entry.memberName}
                          secondary={entry.memberMatricule}
                        />
                      </td>
                      <td className="px-[15px] py-2.5 text-ink-3">
                        {entry.categoryLabel}
                      </td>
                      <td className="px-[15px] py-2.5 tabular-nums text-ink-3">
                        {formatCurrency(entry.totalAmount)}
                      </td>
                      <td className="px-[15px] py-2.5 font-medium tabular-nums">
                        {formatCurrency(entry.insurerShare)}
                      </td>
                      <td className="px-[15px] py-2.5">
                        <StatusPill tone={TONE[entry.status] ?? "muted"}>
                          {REIMB_STATUS[entry.status] ?? entry.status}
                        </StatusPill>
                      </td>
                      {canWrite ? (
                        <td className="px-[15px] py-2.5 text-right whitespace-nowrap">
                          {["SUBMITTED", "REVIEWING"].includes(entry.status) ? (
                            <>
                              <button
                                type="button"
                                disabled={review.pending}
                                onClick={() =>
                                  void review.run({
                                    firmSlug,
                                    reimbursementId: entry.id,
                                    decision: "APPROVED",
                                  })
                                }
                                className="rounded-[7px] border border-line px-2 py-1 text-[12.5px] hover:bg-sub disabled:opacity-50"
                              >
                                Approuver
                              </button>
                              <button
                                type="button"
                                disabled={review.pending}
                                onClick={() => {
                                  const reason = window.prompt("Motif du rejet ?")
                                  if (!reason) return
                                  void review.run({
                                    firmSlug,
                                    reimbursementId: entry.id,
                                    decision: "REJECTED",
                                    rejectReason: reason,
                                  })
                                }}
                                className="ml-1.5 rounded-[7px] border border-line px-2 py-1 text-[12.5px] text-alert hover:bg-sub disabled:opacity-50"
                              >
                                Rejeter
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
      ) : null}

      {tab === "DISBURSEMENTS" ? (
        <Panel
          titleAs="h2"
          title="Bons de décaissement"
          description="Trois visas distincts. Chacun est apposé par la personne qui l'appose — jamais en son nom."
          padded={false}
        >
          {disbursements.length === 0 ? (
            <EmptyState
              title="Aucun bon de décaissement"
              description="Sélectionnez des factures approuvées pour en établir un."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-[13px]">
                <thead>
                  <tr className="border-y border-line bg-sub text-left text-[11.5px] text-ink-3">
                    <th className="px-[15px] py-2 font-medium">N°</th>
                    <th className="px-[15px] py-2 font-medium">Bénéficiaire</th>
                    <th className="px-[15px] py-2 font-medium">Montant</th>
                    <th className="px-[15px] py-2 font-medium">Journal</th>
                    <th className="px-[15px] py-2 font-medium">Visa direction</th>
                    <th className="px-[15px] py-2 font-medium">Visa comptabilité</th>
                    <th className="px-[15px] py-2 font-medium">Remise</th>
                    {canWrite ? <th className="px-[15px] py-2" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {disbursements.map((entry) => (
                    <tr key={entry.id} className="border-b border-line">
                      <td className="px-[15px] py-2.5">
                        <TagCode>{entry.number}</TagCode>
                        <div className="mt-px text-[11.5px] text-ink-3">
                          {formatDate(entry.date)}
                        </div>
                      </td>
                      <td className="px-[15px] py-2.5">
                        <TwoFacts
                          primary={entry.payeeName}
                          secondary={entry.motif}
                        />
                      </td>
                      <td className="px-[15px] py-2.5">
                        <div className="font-medium tabular-nums">
                          {formatCurrency(entry.amount)}
                        </div>
                        {/* Derived from the figure, never stored, so the two
                            cannot disagree on a payment instrument. */}
                        <div className="mt-px max-w-[240px] text-[11px] text-ink-3">
                          {amountInWords(entry.amount)}
                        </div>
                      </td>
                      <td className="px-[15px] py-2.5 text-ink-3">
                        {entry.journalCode}
                      </td>
                      <td className="px-[15px] py-2.5 text-[12.5px] text-ink-3">
                        {entry.approvedAt ? (
                          <>
                            {entry.approvedByName}
                            <div>{formatDate(entry.approvedAt)}</div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-[15px] py-2.5 text-[12.5px] text-ink-3">
                        {entry.accountingAt ? (
                          <>
                            {entry.accountingByName}
                            <div>{formatDate(entry.accountingAt)}</div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-[15px] py-2.5 text-[12.5px] text-ink-3">
                        {entry.receivedAt ? formatDate(entry.receivedAt) : "—"}
                      </td>
                      {canWrite ? (
                        <td className="px-[15px] py-2.5 text-right whitespace-nowrap">
                          {!entry.approvedAt ? (
                            <button
                              type="button"
                              disabled={visa.pending}
                              onClick={() =>
                                void visa.run({
                                  firmSlug,
                                  disbursementId: entry.id,
                                  visa: "DIRECTION",
                                })
                              }
                              className="rounded-[7px] border border-line px-2 py-1 text-[12.5px] hover:bg-sub disabled:opacity-50"
                            >
                              Viser (direction)
                            </button>
                          ) : !entry.accountingAt ? (
                            <button
                              type="button"
                              disabled={visa.pending}
                              onClick={() =>
                                void visa.run({
                                  firmSlug,
                                  disbursementId: entry.id,
                                  visa: "COMPTABILITE",
                                })
                              }
                              className="rounded-[7px] border border-line px-2 py-1 text-[12.5px] hover:bg-sub disabled:opacity-50"
                            >
                              Viser (comptabilité)
                            </button>
                          ) : !entry.receivedAt ? (
                            <button
                              type="button"
                              disabled={visa.pending}
                              onClick={() =>
                                void visa.run({
                                  firmSlug,
                                  disbursementId: entry.id,
                                  visa: "RECEPTION",
                                })
                              }
                              className="rounded-[7px] border border-line px-2 py-1 text-[12.5px] hover:bg-sub disabled:opacity-50"
                            >
                              Remis au bénéficiaire
                            </button>
                          ) : (
                            <StatusPill tone="ok">
                              {DISB_STATUS[entry.status] ?? entry.status}
                            </StatusPill>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      ) : null}
    </div>
  )
}
