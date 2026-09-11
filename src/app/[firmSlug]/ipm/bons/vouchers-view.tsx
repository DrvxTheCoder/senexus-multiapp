"use client"

import * as React from "react"
import Link from "next/link"
import { useQueryStates } from "nuqs"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Cancel01Icon,
  PlusSignIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons"

import { CancelVoucherDialog } from "@/app/[firmSlug]/ipm/bons/voucher-dialogs"
import { DataTable } from "@/components/data-table"
import { FacetFilter } from "@/components/filters/facet-filter"
import { FilterChips, type FilterChip } from "@/components/filters/filter-chips"
import { useAction } from "@/components/forms/use-action"
import { Pager } from "@/components/list-controls"
import { Panel } from "@/components/panel"
import { EmptyState, StatusPill, TagCode, TwoFacts } from "@/components/primitives"
import { ResourceDrawer } from "@/components/resource-drawer"
import { Button } from "@/components/ui/button"
import { formatCurrency, formatDate, formatNumber } from "@/lib/format"
import {
  VOUCHER_STATUS_LABELS,
  VOUCHER_STATUS_TONES,
  VOUCHER_TYPE_LABELS,
  type VoucherQuery,
} from "@/lib/queries/ipm/voucher-query"
import {
  toVoucherQuery,
  voucherSearchParams,
} from "@/lib/queries/ipm/voucher-params"
import { settleVoucher } from "@/server/actions/ipm-vouchers"
import { formatRate } from "@/server/domain/ipm/rates"
import type { VoucherRow, VoucherSummary } from "@/server/queries/ipm/vouchers"
import type { Paged } from "@/server/queries/types"

export type OpenVoucher = {
  id: string
  number: string
  type: string
  status: string
  issueDate: Date
  expiryDate: Date
  beneficiaryName: string
  memberId: string
  memberMatricule: string
  providerName: string
  categoryLabel: string
  serviceTypeLabel: string
  totalAmount: number
  insurerShare: number
  memberShare: number
  appliedRate: number
  rateSource: string
  settledAt: Date | null
  cancelledAt: Date | null
  cancelReason: string | null
  issuedByName: string | null
  settledByName: string | null
  lines: {
    id: string
    label: string
    quantity: number
    unitPrice: number
    amount: number
  }[]
}

/**
 * Bons.
 *
 * A row opens a **drawer** rather than navigating: a bon is a document you
 * read, act on and dismiss — settle it, cancel it, look at its lines — not a
 * place you work for ten minutes. That is the same distinction the CRM makes
 * for a client, and the opposite of the one participants make.
 *
 * The open bon is a URL parameter, so its contents are server-rendered like
 * everything else and a colleague can be sent a link that opens on one
 * document.
 */
export function VouchersView({
  firmSlug,
  page,
  summary,
  open,
  canWrite,
}: {
  firmSlug: string
  page: Paged<VoucherRow>
  summary: VoucherSummary
  open: OpenVoucher | null
  canWrite: boolean
}) {
  const [params, setParams] = useQueryStates(voucherSearchParams, {
    shallow: false,
  })
  const query: VoucherQuery = toVoucherQuery(params)

  const [cancelling, setCancelling] = React.useState<OpenVoucher | null>(null)

  const settle = useAction(settleVoucher, { success: "Bon réglé." })

  // Same shape as the clients list: the draft is synced during render rather
  // than in an effect, and the URL is written only once typing settles.
  const urlSearch = params.q ?? ""
  const [search, setSearch] = React.useState({ draft: urlSearch, url: urlSearch })
  if (search.url !== urlSearch) setSearch({ draft: urlSearch, url: urlSearch })

  React.useEffect(() => {
    if (search.draft === urlSearch) return
    const timer = setTimeout(() => {
      void setParams({ q: search.draft || null, page: null })
    }, 300)
    return () => clearTimeout(timer)
  }, [search.draft, urlSearch, setParams])

  const sorting: SortingState = query.sort.map((entry) => ({
    id: entry.id,
    desc: entry.desc,
  }))

  const labelFor = (facet: string, value: string) =>
    page.facets[facet]?.find((bucket) => bucket.value === value)?.label ?? value

  /**
   * The chips show what *is* filtered, including filters that arrived from a
   * dashboard drill-through. Without them a pre-filtered list looks like the
   * whole list.
   */
  const chips: FilterChip[] = [
    ...(params.status ?? []).map((value) => ({
      key: `status:${value}`,
      label: "Statut",
      value: VOUCHER_STATUS_LABELS[value] ?? value,
      onRemove: () =>
        void setParams({
          status: (params.status ?? []).filter((entry) => entry !== value).length
            ? (params.status ?? []).filter((entry) => entry !== value)
            : null,
          page: null,
        }),
    })),
    ...(params.type ?? []).map((value) => ({
      key: `type:${value}`,
      label: "Type",
      value: VOUCHER_TYPE_LABELS[value] ?? value,
      onRemove: () =>
        void setParams({
          type: (params.type ?? []).filter((entry) => entry !== value).length
            ? (params.type ?? []).filter((entry) => entry !== value)
            : null,
          page: null,
        }),
    })),
    ...(params.provider ?? []).map((value) => ({
      key: `provider:${value}`,
      label: "Prestataire",
      value: labelFor("provider", value),
      onRemove: () =>
        void setParams({
          provider: (params.provider ?? []).filter((entry) => entry !== value).length
            ? (params.provider ?? []).filter((entry) => entry !== value)
            : null,
          page: null,
        }),
    })),
    ...(params.category ?? []).map((value) => ({
      key: `category:${value}`,
      label: "Catégorie",
      value: labelFor("category", value),
      onRemove: () =>
        void setParams({
          category: (params.category ?? []).filter((entry) => entry !== value).length
            ? (params.category ?? []).filter((entry) => entry !== value)
            : null,
          page: null,
        }),
    })),
    ...(params.member
      ? [
          {
            key: "member",
            label: "Participant",
            value: params.member,
            onRemove: () => void setParams({ member: null, page: null }),
          },
        ]
      : []),
  ]

  const columns = React.useMemo<ColumnDef<VoucherRow, unknown>[]>(
    () => [
      {
        id: "number",
        header: "Numéro",
        enableSorting: true,
        cell: ({ row }) => (
          <div>
            <TagCode>{row.original.number}</TagCode>
            <div className="mt-px text-[11.5px] text-ink-3">
              {VOUCHER_TYPE_LABELS[
                row.original.type as keyof typeof VOUCHER_TYPE_LABELS
              ] ?? row.original.type}{" "}
              · {formatDate(row.original.issueDate)}
            </div>
          </div>
        ),
      },
      {
        id: "beneficiary",
        header: "Bénéficiaire",
        enableSorting: true,
        cell: ({ row }) => (
          <TwoFacts
            primary={row.original.beneficiaryName}
            secondary={row.original.memberMatricule}
          />
        ),
      },
      {
        id: "provider",
        header: "Prestataire",
        enableSorting: true,
        cell: ({ row }) => (
          <TwoFacts
            primary={row.original.providerName}
            secondary={row.original.categoryLabel}
          />
        ),
      },
      {
        id: "totalAmount",
        header: "Total",
        enableSorting: true,
        cell: ({ row }) => (
          <span className="num">{formatCurrency(row.original.totalAmount)}</span>
        ),
      },
      {
        id: "insurerShare",
        header: "Part IPM",
        enableSorting: true,
        cell: ({ row }) => (
          <span className="num font-medium">
            {formatCurrency(row.original.insurerShare)}
          </span>
        ),
      },
      {
        id: "memberShare",
        header: "Ticket",
        cell: ({ row }) => (
          <span className="num text-ink-3">
            {formatCurrency(row.original.memberShare)}
          </span>
        ),
      },
      {
        id: "status",
        header: "Statut",
        enableSorting: true,
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <StatusPill
              tone={
                VOUCHER_STATUS_TONES[
                  row.original.status as keyof typeof VOUCHER_STATUS_TONES
                ] ?? "muted"
              }
            >
              {VOUCHER_STATUS_LABELS[
                row.original.status as keyof typeof VOUCHER_STATUS_LABELS
              ] ?? row.original.status}
            </StatusPill>
            {/* Derived from the expiry date, not stored — a bon lapses by a
                date passing, not by somebody writing to it. */}
            {row.original.lapsed ? (
              <StatusPill tone="alert">Périmé</StatusPill>
            ) : null}
          </div>
        ),
      },
    ],
    []
  )

  const from = page.total === 0 ? 0 : (page.page - 1) * page.perPage + 1
  const to = Math.min(page.page * page.perPage, page.total)

  return (
    <>
      <Panel
        title="Bons émis"
        description="Un bon engage l'institution dès son émission : sa part est comptée dans les plafonds avant d'être facturée."
        padded={false}
        stats={[
          { label: "En circulation", value: formatNumber(summary.issued) },
          {
            label: "Engagé non réglé",
            value: formatCurrency(summary.outstanding),
            tone: summary.outstanding > 0 ? "signal" : undefined,
          },
          {
            label: "Réglés ce mois",
            value: formatCurrency(summary.settledThisMonth),
          },
        ]}
        tools={
          canWrite ? (
            <Button
              size="sm"
              render={
                <Link href={`/${firmSlug}/ipm/bons/nouveau`}>
                  <HugeiconsIcon icon={PlusSignIcon} size={13} />
                  Émettre un bon
                </Link>
              }
            />
          ) : null
        }
        footer={{
          summary: (
            <span className="num">
              {page.total === 0
                ? "Aucun bon"
                : `${formatNumber(from)} – ${formatNumber(to)} sur ${formatNumber(page.total)} bons`}
            </span>
          ),
          action: (
            <Pager
              page={page.page}
              pageCount={page.pageCount}
              onChange={(next) => void setParams({ page: next })}
            />
          ),
        }}
      >
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-[15px] py-2.5">
          <div className="flex h-[29px] w-[240px] items-center gap-2 rounded-[7px] border border-line px-2.5">
            <HugeiconsIcon icon={Search01Icon} size={13} className="text-ink-3" />
            <input
              value={search.draft}
              onChange={(event) =>
                setSearch((current) => ({ ...current, draft: event.target.value }))
              }
              placeholder="Numéro, nom, matricule…"
              aria-label="Rechercher un bon"
              className="w-full border-none bg-transparent text-[12.5px] outline-none"
            />
            {search.draft ? (
              <button
                type="button"
                onClick={() => setSearch((current) => ({ ...current, draft: "" }))}
                aria-label="Effacer la recherche"
                className="text-ink-3 hover:text-ink"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={12} />
              </button>
            ) : null}
          </div>

          <FacetFilter
            label="Statut"
            options={page.facets.status ?? []}
            selected={params.status ?? []}
            onChange={(values) =>
              void setParams({
                status: values.length ? (values as typeof params.status) : null,
                page: null,
              })
            }
          />
          <FacetFilter
            label="Type"
            options={page.facets.type ?? []}
            selected={params.type ?? []}
            onChange={(values) =>
              void setParams({
                type: values.length ? (values as typeof params.type) : null,
                page: null,
              })
            }
          />
          <FacetFilter
            label="Prestataire"
            options={page.facets.provider ?? []}
            selected={params.provider ?? []}
            onChange={(values) =>
              void setParams({ provider: values.length ? values : null, page: null })
            }
          />
          <FacetFilter
            label="Catégorie"
            options={page.facets.category ?? []}
            selected={params.category ?? []}
            onChange={(values) =>
              void setParams({ category: values.length ? values : null, page: null })
            }
          />

          <div className="ml-auto flex items-center gap-1.5">
            <label className="text-[11.5px] text-ink-3" htmlFor="bons-from">
              Émis du
            </label>
            <input
              id="bons-from"
              type="date"
              value={params.from ?? ""}
              onChange={(event) =>
                void setParams({ from: event.target.value || null, page: null })
              }
              className="h-[29px] rounded-[7px] border border-line bg-surface px-2 text-[12.5px] outline-none focus:border-brand"
            />
            <label className="text-[11.5px] text-ink-3" htmlFor="bons-to">
              au
            </label>
            <input
              id="bons-to"
              type="date"
              value={params.to ?? ""}
              onChange={(event) =>
                void setParams({ to: event.target.value || null, page: null })
              }
              className="h-[29px] rounded-[7px] border border-line bg-surface px-2 text-[12.5px] outline-none focus:border-brand"
            />
          </div>
        </div>

        <FilterChips
          chips={chips}
          onClearAll={() =>
            void setParams({
              q: null,
              status: null,
              type: null,
              provider: null,
              category: null,
              member: null,
              from: null,
              to: null,
              page: null,
            })
          }
        />

        <DataTable
          data={page.rows}
          columns={columns}
          getRowId={(row) => row.id}
          sorting={sorting}
          onSortingChange={(next) =>
            void setParams({
              sort: next.length
                ? next.map((entry) => (entry.desc ? `-${entry.id}` : entry.id))
                : null,
              page: null,
            })
          }
          onRowClick={(row) => void setParams({ open: row.id })}
          label="Bons de prise en charge"
          empty={
            <EmptyState
              title={
                chips.length > 0 || params.q
                  ? "Aucun bon ne correspond"
                  : "Aucun bon émis"
              }
              description={
                chips.length > 0 || params.q
                  ? "Retirez un filtre pour élargir la recherche."
                  : "Émettez un bon depuis la fiche d'un participant ou avec le bouton Émettre."
              }
            />
          }
        />
      </Panel>

      <ResourceDrawer
        open={Boolean(open)}
        onClose={() => void setParams({ open: null })}
        title={open?.number ?? ""}
        subtitle={
          open
            ? `${VOUCHER_TYPE_LABELS[open.type as keyof typeof VOUCHER_TYPE_LABELS] ?? open.type} · ${open.beneficiaryName}`
            : undefined
        }
        footer={
          open && canWrite ? (
            <div className="flex items-center gap-2">
              {["ISSUED", "PRESENTED"].includes(open.status) ? (
                <>
                  <Button
                    size="sm"
                    disabled={settle.pending}
                    onClick={() =>
                      void settle.run({
                        firmSlug,
                        voucherId: open.id,
                        settledOn: new Date().toISOString().slice(0, 10),
                      })
                    }
                  >
                    Régler
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setCancelling(open)}
                  >
                    Annuler le bon
                  </Button>
                </>
              ) : (
                <span className="text-[12.5px] text-ink-3">
                  {open.status === "CANCELLED"
                    ? `Annulé — ${open.cancelReason ?? "sans motif"}`
                    : "Aucune action disponible à ce stade."}
                </span>
              )}
            </div>
          ) : null
        }
      >
        {open ? <VoucherDetail firmSlug={firmSlug} voucher={open} /> : null}
      </ResourceDrawer>

      {cancelling ? (
        <CancelVoucherDialog
          firmSlug={firmSlug}
          voucher={{ id: cancelling.id, number: cancelling.number }}
          onClose={() => setCancelling(null)}
        />
      ) : null}
    </>
  )
}

function VoucherDetail({
  firmSlug,
  voucher,
}: {
  firmSlug: string
  voucher: OpenVoucher
}) {
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-5 gap-y-2.5 text-[13px]">
        <Fact label="Participant">
          <Link
            href={`/${firmSlug}/ipm/participants/${voucher.memberId}`}
            className="text-brand hover:underline"
          >
            {voucher.memberMatricule}
          </Link>
        </Fact>
        <Fact label="Prestataire">{voucher.providerName}</Fact>
        <Fact label="Prestation">{voucher.serviceTypeLabel}</Fact>
        <Fact label="Catégorie">{voucher.categoryLabel}</Fact>
        <Fact label="Émis le">{formatDate(voucher.issueDate)}</Fact>
        <Fact label="Valable jusqu'au">{formatDate(voucher.expiryDate)}</Fact>
        <Fact label="Émis par">{voucher.issuedByName ?? "—"}</Fact>
        <Fact label="Réglé par">
          {voucher.settledByName
            ? `${voucher.settledByName} · ${formatDate(voucher.settledAt)}`
            : "—"}
        </Fact>
      </dl>

      <div className="rounded-[7px] border border-line">
        <div className="border-b border-line bg-sub px-3 py-1.5 text-[11.5px] text-ink-3">
          Lignes
        </div>
        <table className="w-full text-[12.5px]">
          <tbody>
            {voucher.lines.map((line) => (
              <tr key={line.id} className="border-b border-line last:border-0">
                <td className="px-3 py-2">{line.label}</td>
                <td className="num px-3 py-2 text-right text-ink-3">
                  {line.quantity} × {formatCurrency(line.unitPrice)}
                </td>
                <td className="num px-3 py-2 text-right font-medium">
                  {formatCurrency(line.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="space-y-1.5 border-t border-line pt-3 text-[13px]">
        <Row label="Total" value={formatCurrency(voucher.totalAmount)} />
        <Row
          label="Part IPM"
          value={formatCurrency(voucher.insurerShare)}
          strong
        />
        <Row
          label="Ticket modérateur"
          value={formatCurrency(voucher.memberShare)}
        />
        <Row
          label="Taux appliqué"
          value={`${formatRate(voucher.appliedRate)} · ${
            voucher.rateSource === "EMPLOYER" ? "dérogation employeur" : "formule"
          }`}
        />
      </dl>
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
    <div>
      <dt className="text-[11.5px] text-ink-3">{label}</dt>
      <dd className="mt-px truncate">{children}</dd>
    </div>
  )
}

function Row({
  label,
  value,
  strong,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-3">{label}</dt>
      <dd className={`num ${strong ? "font-semibold" : ""}`}>{value}</dd>
    </div>
  )
}
