"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Search01Icon } from "@hugeicons/core-free-icons"
import type { ColumnDef } from "@tanstack/react-table"

import { InvoiceStatusDialog } from "@/app/[firmSlug]/ipm/factures/invoice-status-dialog"
import { DataTable } from "@/components/data-table"
import { FacetFilter, type FacetOption } from "@/components/filters/facet-filter"
import { FilterChips, type FilterChip } from "@/components/filters/filter-chips"
import { Pager } from "@/components/list-controls"
import { Panel } from "@/components/panel"
import {
  EmptyState,
  StatusPill,
  TagCode,
  TwoFacts,
} from "@/components/primitives"
import { Button } from "@/components/ui/button"
import { formatCurrency, formatDate, formatNumber } from "@/lib/format"
import type { InvoiceRow } from "@/server/queries/ipm/ledger"

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Brouillon",
  ISSUED: "Émise",
  PARTIALLY_PAID: "Partiellement réglée",
  PAID: "Réglée",
  OVERDUE: "En retard",
  CANCELLED: "Annulée",
}

const STATUS_TONES: Record<
  string,
  "ok" | "signal" | "alert" | "muted" | "brand"
> = {
  DRAFT: "muted",
  ISSUED: "signal",
  PARTIALLY_PAID: "brand",
  PAID: "ok",
  OVERDUE: "alert",
  CANCELLED: "muted",
}

const MONTHS = [
  "janv.",
  "févr.",
  "mars",
  "avr.",
  "mai",
  "juin",
  "juil.",
  "août",
  "sept.",
  "oct.",
  "nov.",
  "déc.",
]

const PAGE_SIZE = 15

function countBy(rows: InvoiceRow[], key: (row: InvoiceRow) => string) {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const value = key(row)
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return counts
}

/**
 * Factures employeur.
 *
 * The status is the user's to set, and every change records who set it and
 * when. §4.8ter is explicit about the reason: a "réglée" with no trace of who
 * entered it has no evidential value — so it is set in a dialog that also asks
 * for the amount, the mode and the référence, not by a `<select>` in the row
 * that marked an invoice paid on a stray keystroke.
 *
 * "En retard" is **derived from the due date**, not stored. A row does not
 * become overdue by somebody writing to it; it becomes overdue by a date
 * passing, and a stored flag would be wrong every morning until a job ran. It
 * filters and it colours the échéance; it is not on offer in the dialog.
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
  const [search, setSearch] = React.useState("")
  const [statuses, setStatuses] = React.useState<string[]>([])
  const [periods, setPeriods] = React.useState<string[]>([])
  const [page, setPage] = React.useState(1)
  const [editing, setEditing] = React.useState<InvoiceRow | null>(null)

  const periodKey = (row: InvoiceRow) =>
    `${row.periodYear}-${String(row.periodMonth).padStart(2, "0")}`
  const periodLabel = (key: string) => {
    const [year, month] = key.split("-")
    return `${MONTHS[Number(month) - 1]} ${year}`
  }
  // "En retard" is a derived flag, not a status column, so it joins the status
  // facet as a synthetic value rather than pretending to be one.
  const statusKey = (row: InvoiceRow) => (row.overdue ? "OVERDUE" : row.status)

  const filtered = React.useMemo(() => {
    const needle = search.trim().toLowerCase()
    return invoices.filter((invoice) => {
      if (statuses.length > 0 && !statuses.includes(statusKey(invoice))) {
        return false
      }
      if (periods.length > 0 && !periods.includes(periodKey(invoice))) {
        return false
      }
      if (needle === "") return true
      return (
        invoice.number.toLowerCase().includes(needle) ||
        invoice.employerName.toLowerCase().includes(needle)
      )
    })
  }, [invoices, search, statuses, periods])

  // Each facet counts against the rows the *other* facets leave standing, so
  // a count never promises results that the current filters already exclude.
  const statusFacets: FacetOption[] = React.useMemo(() => {
    const pool = invoices.filter(
      (invoice) => periods.length === 0 || periods.includes(periodKey(invoice))
    )
    const counts = countBy(pool, statusKey)
    return Object.keys(STATUS_LABELS)
      .filter((value) => counts.has(value))
      .map((value) => ({
        value,
        label: STATUS_LABELS[value]!,
        count: counts.get(value)!,
      }))
  }, [invoices, periods])

  const periodFacets: FacetOption[] = React.useMemo(() => {
    const pool = invoices.filter(
      (invoice) =>
        statuses.length === 0 || statuses.includes(statusKey(invoice))
    )
    const counts = countBy(pool, periodKey)
    return [...counts.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([value, count]) => ({ value, label: periodLabel(value), count }))
  }, [invoices, statuses])

  const chips: FilterChip[] = [
    ...statuses.map((value) => ({
      key: `status:${value}`,
      label: "Statut",
      value: STATUS_LABELS[value] ?? value,
      onRemove: () =>
        setStatuses((state) => state.filter((entry) => entry !== value)),
    })),
    ...periods.map((value) => ({
      key: `period:${value}`,
      label: "Période",
      value: periodLabel(value),
      onRemove: () =>
        setPeriods((state) => state.filter((entry) => entry !== value)),
    })),
  ]

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, pageCount)
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)

  const outstanding = filtered
    .filter((invoice) => !["PAID", "CANCELLED"].includes(invoice.status))
    .reduce((sum, invoice) => sum + invoice.totalAmount - invoice.paidAmount, 0)
  const overdue = filtered.filter((invoice) => invoice.overdue)

  const columns = React.useMemo<ColumnDef<InvoiceRow, unknown>[]>(
    () => [
      {
        id: "number",
        header: "Numéro",
        cell: ({ row }) => (
          <div>
            <TagCode>{row.original.number}</TagCode>
            <div className="mt-px text-[11.5px] text-ink-3">
              émise le {formatDate(row.original.issueDate)}
            </div>
          </div>
        ),
      },
      {
        id: "employer",
        header: "Employeur",
        cell: ({ row }) => (
          <TwoFacts
            primary={row.original.employerName}
            secondary={`${formatNumber(row.original.memberCount)} participant${
              row.original.memberCount > 1 ? "s" : ""
            }`}
          />
        ),
      },
      {
        id: "period",
        header: "Période",
        cell: ({ row }) => (
          <span className="text-ink-3">
            {MONTHS[row.original.periodMonth - 1]} {row.original.periodYear}
          </span>
        ),
      },
      {
        id: "total",
        header: "Total",
        cell: ({ row }) => (
          <span className="num font-medium">
            {formatCurrency(row.original.totalAmount)}
          </span>
        ),
      },
      {
        id: "paid",
        header: "Réglé",
        cell: ({ row }) =>
          row.original.paidAmount ? (
            <span className="num text-ink-2">
              {formatCurrency(row.original.paidAmount)}
            </span>
          ) : (
            <span className="text-ink-3">—</span>
          ),
      },
      {
        id: "due",
        header: "Échéance",
        cell: ({ row }) => (
          <span
            className={`num ${row.original.overdue ? "font-medium text-alert" : "text-ink-3"}`}
          >
            {formatDate(row.original.dueDate)}
          </span>
        ),
      },
      {
        id: "status",
        header: "Statut",
        cell: ({ row }) => {
          const value = statusKey(row.original)
          return (
            <StatusPill tone={STATUS_TONES[value] ?? "muted"}>
              {STATUS_LABELS[value] ?? value}
            </StatusPill>
          )
        },
      },
      ...(canWrite
        ? [
            {
              id: "actions",
              header: "",
              cell: ({ row }) => (
                <div className="flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => setEditing(row.original)}
                  >
                    Statut
                  </Button>
                </div>
              ),
            } satisfies ColumnDef<InvoiceRow, unknown>,
          ]
        : []),
    ],
    [canWrite]
  )

  return (
    <>
      <Panel
        title="Factures employeur"
        description="Une facture par employeur et par mois. La liste des participants est figée à la date d'arrêté."
        padded={false}
        stats={[
          { label: "Factures", value: formatNumber(filtered.length) },
          { label: "Restant dû", value: formatCurrency(outstanding) },
          {
            label: "En retard",
            value: formatNumber(overdue.length),
            tone: overdue.length > 0 ? "alert" : undefined,
          },
        ]}
        footer={{
          summary: (
            <span>
              {formatNumber(filtered.length)} facture
              {filtered.length > 1 ? "s" : ""}
              {filtered.length !== invoices.length
                ? ` sur ${formatNumber(invoices.length)}`
                : ""}
            </span>
          ),
          action:
            pageCount > 1 ? (
              <Pager page={current} pageCount={pageCount} onChange={setPage} />
            ) : null,
        }}
      >
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-[15px] py-2.5">
          <div className="flex h-[29px] w-[222px] items-center gap-2 rounded-[7px] border border-line px-2.5">
            <HugeiconsIcon
              icon={Search01Icon}
              size={13}
              className="text-ink-3"
              aria-hidden
            />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(1)
              }}
              placeholder="Numéro ou employeur"
              aria-label="Rechercher une facture"
              className="w-full border-none bg-transparent text-[12.5px] outline-none placeholder:text-ink-3"
            />
          </div>
          <FacetFilter
            label="Statut"
            options={statusFacets}
            selected={statuses}
            onChange={(values) => {
              setStatuses(values)
              setPage(1)
            }}
          />
          <FacetFilter
            label="Période"
            options={periodFacets}
            selected={periods}
            onChange={(values) => {
              setPeriods(values)
              setPage(1)
            }}
          />
        </div>

        <FilterChips
          chips={chips}
          onClearAll={() => {
            setStatuses([])
            setPeriods([])
            setPage(1)
          }}
        />

        <DataTable
          data={rows}
          columns={columns}
          getRowId={(row) => row.id}
          sorting={[]}
          onSortingChange={() => {}}
          label="Factures employeur"
          empty={
            invoices.length === 0 ? (
              <EmptyState
                title="Aucune facture"
                description="Clôturez un mois depuis l'écran Cotisations pour émettre les factures."
              />
            ) : (
              <EmptyState
                title="Aucune facture ne correspond"
                description="Retirez un filtre ou changez la recherche."
              />
            )
          }
        />
      </Panel>

      {editing ? (
        <InvoiceStatusDialog
          firmSlug={firmSlug}
          invoice={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  )
}
