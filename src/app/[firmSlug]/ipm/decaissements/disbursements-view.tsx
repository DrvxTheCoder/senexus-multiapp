"use client"

import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"

import {
  RejectInvoiceDialog,
  RejectReimbursementDialog,
} from "@/app/[firmSlug]/ipm/decaissements/decision-dialogs"
import { VisaStepper } from "@/app/[firmSlug]/ipm/decaissements/visa-stepper"
import { DataTable } from "@/components/data-table"
import { useAction } from "@/components/forms/use-action"
import { Panel } from "@/components/panel"
import {
  EmptyState,
  SegmentedControl,
  StatusPill,
  TagCode,
  TwoFacts,
} from "@/components/primitives"
import { ResourceDrawer } from "@/components/resource-drawer"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { formatCurrency, formatDate, formatNumber } from "@/lib/format"
import {
  checkProviderInvoice,
  createDisbursement,
  reviewReimbursement,
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

const REIMBURSEMENT_STATUS: Record<string, string> = {
  SUBMITTED: "Déposé",
  REVIEWING: "En cours",
  APPROVED: "Approuvé",
  REJECTED: "Rejeté",
  PAID: "Réglé",
}

const DISBURSEMENT_STATUS: Record<string, string> = {
  DRAFT: "À viser",
  APPROVED: "Visa direction",
  POSTED: "Visa comptabilité",
  PAID: "Remis",
  CANCELLED: "Annulé",
}

const PAYMENT_METHOD: Record<string, string> = {
  CHEQUE: "Chèque",
  TRANSFER: "Virement",
  CASH: "Espèces",
  ORANGE_MONEY: "Orange Money",
}

const TONE: Record<string, "ok" | "signal" | "alert" | "muted" | "brand"> = {
  RECEIVED: "signal",
  CHECKED: "brand",
  APPROVED: "brand",
  PAID: "ok",
  REJECTED: "alert",
  SUBMITTED: "signal",
  REVIEWING: "brand",
  DRAFT: "signal",
  POSTED: "brand",
  CANCELLED: "muted",
}

const PANEL: Record<Tab, { title: string; description: string }> = {
  INVOICES: {
    title: "Factures prestataires",
    description:
      "Triées par écart décroissant : les factures contestables d'abord.",
  },
  REIMBURSEMENTS: {
    title: "Remboursements",
    description:
      "Un participant qui a avancé les frais, tarifé au même taux qu'un bon.",
  },
  DISBURSEMENTS: {
    title: "Bons de décaissement",
    description:
      "Trois visas, dans l'ordre. Chacun est apposé par la personne qui l'appose.",
  },
}

/**
 * Décaissements — plan §4.8 et §4.9.
 *
 * Three queues on one screen, because they are three stages of one flow: a
 * facture prestataire or a demande de remboursement is contrôlée, then
 * approuvée, and a bon de décaissement settles it. Splitting them across three
 * pages would hide that the third cannot happen without the first two.
 *
 * The **écart** is why the invoice queue exists at all: what a prestataire
 * claims, against the sum of the parts IPM of the bons actually issued to
 * them. That is the figure WebLamps cannot produce, so it leads the screen and
 * sorts the queue — the contestable invoices are the ones in view.
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
  const [tab, setTab] = React.useState<Tab>("INVOICES")
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [rejectInvoice, setRejectInvoice] =
    React.useState<ProviderInvoiceRow | null>(null)
  const [rejectReimbursement, setRejectReimbursement] =
    React.useState<ReimbursementRow | null>(null)
  // The id, not the row: a visa refreshes the server data, and a captured row
  // object would leave the stepper showing the state from before the signature
  // it just recorded.
  const [openId, setOpenId] = React.useState<string | null>(null)
  const openDisbursement =
    disbursements.find((entry) => entry.id === openId) ?? null

  const check = useAction(checkProviderInvoice, {
    success: "Facture mise à jour.",
  })
  const review = useAction(reviewReimbursement, {
    success: "Remboursement approuvé.",
  })
  const create = useAction(createDisbursement, {
    success: (data) =>
      `Bon n° ${data.number} établi — ${formatCurrency(data.amount)}.`,
    onSuccess: () => {
      setSelected(new Set())
      setTab("DISBURSEMENTS")
    },
  })

  const selectedInvoices = invoices.filter((invoice) => selected.has(invoice.id))
  const selectedTotal = selectedInvoices.reduce(
    (sum, invoice) => sum + invoice.totalAmount,
    0
  )
  // One bon settles one bénéficiaire. Locking the selection to the prestataire
  // of the first invoice picked is the honest way to say so; the alternative
  // was a bon addressed to whichever provider happened to sort first, for
  // money owed to several.
  const lockedProviderId = selectedInvoices[0]?.providerId ?? null

  const toggle = (id: string) =>
    setSelected((state) => {
      const next = new Set(state)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /* ---- factures --------------------------------------------------------- */

  const invoiceColumns = React.useMemo<
    ColumnDef<ProviderInvoiceRow, unknown>[]
  >(
    () => [
      ...(canWrite
        ? [
            {
              id: "select",
              header: "",
              size: 34,
              cell: ({ row }) => {
                const payable =
                  row.original.status === "APPROVED" &&
                  !row.original.disbursementNumber
                if (!payable) return null
                const blocked =
                  lockedProviderId !== null &&
                  lockedProviderId !== row.original.providerId
                return (
                  <Checkbox
                    checked={selected.has(row.original.id)}
                    disabled={blocked}
                    onCheckedChange={() => toggle(row.original.id)}
                    aria-label={`Sélectionner la facture ${row.original.number}`}
                  />
                )
              },
            } satisfies ColumnDef<ProviderInvoiceRow, unknown>,
          ]
        : []),
      {
        id: "invoice",
        header: "Facture",
        cell: ({ row }) => (
          <TwoFacts
            primary={row.original.providerName}
            secondary={`n° ${row.original.number}`}
          />
        ),
      },
      {
        id: "period",
        header: "Période",
        cell: ({ row }) => (
          <span className="num text-[12px] text-ink-3">
            {formatDate(row.original.periodFrom)} →{" "}
            {formatDate(row.original.periodTo)}
          </span>
        ),
      },
      {
        id: "claimed",
        header: "Réclamé",
        cell: ({ row }) => (
          <span className="num">{formatCurrency(row.original.totalAmount)}</span>
        ),
      },
      {
        id: "matched",
        header: "Bons rapprochés",
        cell: ({ row }) => (
          <span className="num text-ink-3">
            {formatCurrency(row.original.matchedAmount)}
          </span>
        ),
      },
      {
        id: "variance",
        header: "Écart",
        cell: ({ row }) =>
          row.original.variance === 0 ? (
            <span className="text-ink-3">—</span>
          ) : (
            <span className="num font-medium text-alert">
              {row.original.variance > 0 ? "+" : ""}
              {formatCurrency(row.original.variance)}
            </span>
          ),
      },
      {
        id: "status",
        header: "Statut",
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <StatusPill tone={TONE[row.original.status] ?? "muted"}>
              {INVOICE_STATUS[row.original.status] ?? row.original.status}
            </StatusPill>
            {row.original.disbursementNumber ? (
              <span className="text-[11.5px] text-ink-3">
                bon n° {row.original.disbursementNumber}
              </span>
            ) : null}
          </div>
        ),
      },
      ...(canWrite
        ? [
            {
              id: "actions",
              header: "",
              cell: ({ row }) => {
                if (!["RECEIVED", "CHECKED"].includes(row.original.status)) {
                  return null
                }
                const next =
                  row.original.status === "RECEIVED" ? "CHECKED" : "APPROVED"
                return (
                  <div className="flex items-center justify-end gap-1.5">
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={check.pending}
                      onClick={() =>
                        void check.run({
                          firmSlug,
                          invoiceId: row.original.id,
                          decision: next,
                        })
                      }
                    >
                      {next === "CHECKED" ? "Contrôler" : "Approuver"}
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setRejectInvoice(row.original)}
                    >
                      Rejeter
                    </Button>
                  </div>
                )
              },
            } satisfies ColumnDef<ProviderInvoiceRow, unknown>,
          ]
        : []),
    ],
    [canWrite, selected, lockedProviderId, check, firmSlug]
  )

  /* ---- remboursements --------------------------------------------------- */

  const reimbursementColumns = React.useMemo<
    ColumnDef<ReimbursementRow, unknown>[]
  >(
    () => [
      {
        id: "number",
        header: "Demande",
        cell: ({ row }) => (
          <div>
            <TagCode>{row.original.number}</TagCode>
            <div className="mt-px text-[11.5px] text-ink-3">
              déposée le {formatDate(row.original.submittedDate)}
            </div>
          </div>
        ),
      },
      {
        id: "member",
        header: "Participant",
        cell: ({ row }) => (
          <TwoFacts
            primary={row.original.memberName}
            secondary={row.original.memberMatricule}
          />
        ),
      },
      {
        id: "category",
        header: "Catégorie",
        cell: ({ row }) => (
          <span className="text-ink-3">{row.original.categoryLabel}</span>
        ),
      },
      {
        id: "total",
        header: "Engagé",
        cell: ({ row }) => (
          <span className="num text-ink-3">
            {formatCurrency(row.original.totalAmount)}
          </span>
        ),
      },
      {
        id: "share",
        header: "Part IPM",
        cell: ({ row }) => (
          <span className="num font-medium">
            {formatCurrency(row.original.insurerShare)}
          </span>
        ),
      },
      {
        id: "status",
        header: "Statut",
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <StatusPill tone={TONE[row.original.status] ?? "muted"}>
              {REIMBURSEMENT_STATUS[row.original.status] ?? row.original.status}
            </StatusPill>
            {row.original.disbursementNumber ? (
              <span className="text-[11.5px] text-ink-3">
                bon n° {row.original.disbursementNumber}
              </span>
            ) : null}
          </div>
        ),
      },
      ...(canWrite
        ? [
            {
              id: "actions",
              header: "",
              cell: ({ row }) => {
                if (!["SUBMITTED", "REVIEWING"].includes(row.original.status)) {
                  return null
                }
                return (
                  <div className="flex items-center justify-end gap-1.5">
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={review.pending}
                      onClick={() =>
                        void review.run({
                          firmSlug,
                          reimbursementId: row.original.id,
                          decision: "APPROVED",
                        })
                      }
                    >
                      Approuver
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setRejectReimbursement(row.original)}
                    >
                      Rejeter
                    </Button>
                  </div>
                )
              },
            } satisfies ColumnDef<ReimbursementRow, unknown>,
          ]
        : []),
    ],
    [canWrite, review, firmSlug]
  )

  /* ---- bons de décaissement --------------------------------------------- */

  const disbursementColumns = React.useMemo<
    ColumnDef<DisbursementRow, unknown>[]
  >(
    () => [
      {
        id: "number",
        header: "N°",
        cell: ({ row }) => (
          <div>
            <TagCode>{row.original.number}</TagCode>
            <div className="mt-px text-[11.5px] text-ink-3">
              {formatDate(row.original.date)} · journal{" "}
              {row.original.journalCode}
            </div>
          </div>
        ),
      },
      {
        id: "payee",
        header: "Bénéficiaire",
        cell: ({ row }) => (
          <TwoFacts
            primary={row.original.payeeName}
            secondary={row.original.motif}
          />
        ),
      },
      {
        id: "amount",
        header: "Montant",
        cell: ({ row }) => (
          <span className="num font-medium">
            {formatCurrency(row.original.amount)}
          </span>
        ),
      },
      {
        id: "method",
        header: "Règlement",
        cell: ({ row }) => (
          <span className="text-ink-3">
            {PAYMENT_METHOD[row.original.paymentMethod] ??
              row.original.paymentMethod}
            {row.original.paymentReference ? (
              <span className="num"> · {row.original.paymentReference}</span>
            ) : null}
          </span>
        ),
      },
      {
        id: "visas",
        header: "Visas",
        cell: ({ row }) => {
          const done = [
            row.original.approvedAt,
            row.original.accountingAt,
            row.original.receivedAt,
          ].filter(Boolean).length
          return (
            <div
              className="flex items-center gap-1"
              aria-label={`${done} visa sur 3`}
            >
              {[0, 1, 2].map((index) => (
                <span
                  key={index}
                  aria-hidden
                  className={`h-1.5 w-5 rounded-full ${
                    index < done ? "bg-brand" : "bg-sunken"
                  }`}
                />
              ))}
              <span className="num ml-1 text-[11.5px] text-ink-3">
                {done}/3
              </span>
            </div>
          )
        },
      },
      {
        id: "status",
        header: "Statut",
        cell: ({ row }) => (
          <StatusPill tone={TONE[row.original.status] ?? "muted"}>
            {DISBURSEMENT_STATUS[row.original.status] ?? row.original.status}
          </StatusPill>
        ),
      },
    ],
    []
  )

  /* ---- rendu ------------------------------------------------------------ */

  const sortedInvoices = React.useMemo(
    () => [...invoices].sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance)),
    [invoices]
  )

  return (
    <div className="space-y-3.5">
      <Panel
        title="Écart prestataires"
        description="Le montant réclamé, moins la somme des parts IPM des bons rapprochés sur la période."
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
            label: "Bons à viser",
            value: formatNumber(summary.awaitingApproval),
          },
          {
            label: "Approuvé non remis",
            value: formatCurrency(summary.approvedUnpaid),
          },
        ]}
      >
        <div className="flex flex-wrap items-baseline gap-2.5">
          <span
            className={`num text-[27px] leading-none font-semibold tracking-[-0.02em] ${
              summary.openVariance === 0 ? "text-ok" : "text-alert"
            }`}
          >
            {summary.openVariance > 0 ? "+" : ""}
            {formatCurrency(summary.openVariance)}
          </span>
          <span className="text-[12.5px] text-ink-3">
            {summary.openVariance === 0
              ? "aucune facture en cours ne diverge des bons émis."
              : "en cours d'examen, sur les factures reçues ou contrôlées."}
          </span>
        </div>
      </Panel>

      <Panel
        titleAs="h2"
        title={PANEL[tab].title}
        description={PANEL[tab].description}
        tools={
          <SegmentedControl
            ariaLabel="File à traiter"
            value={tab}
            onChange={setTab}
            options={[
              { value: "INVOICES", label: `Factures ${invoices.length}` },
              {
                value: "REIMBURSEMENTS",
                label: `Remboursements ${reimbursements.length}`,
              },
              { value: "DISBURSEMENTS", label: `Bons ${disbursements.length}` },
            ]}
          />
        }
        padded={false}
        footer={
          tab === "INVOICES" && canWrite && selectedInvoices.length > 0
            ? {
                summary: (
                  <span>
                    <span className="num font-medium text-ink">
                      {selectedInvoices.length}
                    </span>{" "}
                    facture{selectedInvoices.length > 1 ? "s" : ""} de{" "}
                    {selectedInvoices[0]?.providerName} —{" "}
                    <span className="num font-medium text-ink">
                      {formatCurrency(selectedTotal)}
                    </span>
                  </span>
                ),
                action: (
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelected(new Set())}
                    >
                      Vider
                    </Button>
                    <Button
                      size="sm"
                      disabled={create.pending}
                      onClick={() => {
                        const first = selectedInvoices[0]
                        if (!first) return
                        void create.run({
                          firmSlug,
                          journalCode: "B1",
                          date: new Date().toISOString().slice(0, 10),
                          payeeType: "PROVIDER",
                          payeeId: first.providerId,
                          payeeName: first.providerName,
                          motif: `Règlement facture${
                            selectedInvoices.length > 1 ? "s" : ""
                          } ${selectedInvoices
                            .map((invoice) => invoice.number)
                            .join(", ")}`.slice(0, 200),
                          paymentMethod: "TRANSFER",
                          providerInvoiceIds: selectedInvoices.map(
                            (invoice) => invoice.id
                          ),
                          reimbursementIds: [],
                        })
                      }}
                    >
                      Établir le bon
                    </Button>
                  </div>
                ),
              }
            : undefined
        }
      >
        {tab === "INVOICES" ? (
          <DataTable
            data={sortedInvoices}
            columns={invoiceColumns}
            getRowId={(row) => row.id}
            sorting={[]}
            onSortingChange={() => {}}
            label="Factures prestataires"
            empty={
              <EmptyState
                title="Aucune facture prestataire"
                description="Les factures arrivent par courrier et sont enregistrées ici pour être rapprochées des bons émis."
              />
            }
          />
        ) : tab === "REIMBURSEMENTS" ? (
          <DataTable
            data={reimbursements}
            columns={reimbursementColumns}
            getRowId={(row) => row.id}
            sorting={[]}
            onSortingChange={() => {}}
            label="Remboursements"
            empty={
              <EmptyState
                title="Aucun remboursement"
                description="Un participant qui a payé de sa poche dépose une demande ; elle est tarifée au même taux qu'un bon."
              />
            }
          />
        ) : (
          <DataTable
            data={disbursements}
            columns={disbursementColumns}
            getRowId={(row) => row.id}
            sorting={[]}
            onSortingChange={() => {}}
            onRowClick={(row) => setOpenId(row.id)}
            label="Bons de décaissement"
            empty={
              <EmptyState
                title="Aucun bon de décaissement"
                description="Sélectionnez des factures approuvées dans la file « Factures » pour en établir un."
              />
            }
          />
        )}
      </Panel>

      <ResourceDrawer
        open={Boolean(openDisbursement)}
        onClose={() => setOpenId(null)}
        title={openDisbursement ? `Bon n° ${openDisbursement.number}` : ""}
        subtitle={openDisbursement?.payeeName}
      >
        {openDisbursement ? (
          <div className="space-y-4">
            <div className="rounded-[7px] border border-line bg-sub px-3 py-2.5">
              <div className="num text-[19px] leading-none font-semibold">
                {formatCurrency(openDisbursement.amount)}
              </div>
              {/* Derived from the figure, never stored: an amount and its words
                  must not be able to disagree on a payment instrument. */}
              <p className="mt-1.5 text-[12px] text-ink-2">
                Arrêté à la somme de{" "}
                <span className="font-medium">
                  {amountInWords(openDisbursement.amount)}
                </span>
                .
              </p>
            </div>

            <dl className="grid grid-cols-2 gap-x-5 gap-y-2.5 text-[13px]">
              <Fact label="Date">{formatDate(openDisbursement.date)}</Fact>
              <Fact label="Journal">{openDisbursement.journalCode}</Fact>
              <Fact label="Mode de règlement">
                {PAYMENT_METHOD[openDisbursement.paymentMethod] ??
                  openDisbursement.paymentMethod}
              </Fact>
              <Fact label="Référence">
                {openDisbursement.paymentReference ?? "—"}
              </Fact>
              <Fact label="Motif">{openDisbursement.motif}</Fact>
              <Fact label="Pièces réglées">
                {formatNumber(openDisbursement.lineCount)}
              </Fact>
            </dl>

            <div className="border-t border-line pt-3.5">
              <VisaStepper
                firmSlug={firmSlug}
                disbursement={openDisbursement}
                canWrite={canWrite}
              />
            </div>
          </div>
        ) : null}
      </ResourceDrawer>

      {rejectInvoice ? (
        <RejectInvoiceDialog
          firmSlug={firmSlug}
          invoice={rejectInvoice}
          onClose={() => setRejectInvoice(null)}
        />
      ) : null}

      {rejectReimbursement ? (
        <RejectReimbursementDialog
          firmSlug={firmSlug}
          reimbursement={rejectReimbursement}
          onClose={() => setRejectReimbursement(null)}
        />
      ) : null}
    </div>
  )
}

function Fact({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-ink-3">{label}</dt>
      <dd className="mt-px truncate">{children}</dd>
    </div>
  )
}
