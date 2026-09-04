"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useQueryStates } from "nuqs"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Cancel01Icon,
  Download01Icon,
  RefreshIcon,
  Search01Icon,
  ShieldCheckIcon,
} from "@hugeicons/core-free-icons"

import { BulkActionBar } from "@/components/bulk-action-bar"
import { DataTable } from "@/components/data-table"
import { FacetFilter } from "@/components/filters/facet-filter"
import { FilterChips, type FilterChip } from "@/components/filters/filter-chips"
import { SavedViews, type ViewTab } from "@/components/filters/saved-views"
import { InterimMeter } from "@/components/interim-meter"
import { Panel } from "@/components/panel"
import { Pager, RowCheckbox } from "@/components/list-controls"
import {
  Avatar,
  ClientDot,
  EmptyState,
  StatusPill,
  TagCode,
  TwoFacts,
} from "@/components/primitives"
import { RenewalPreflightDialog } from "@/app/[firmSlug]/hr/contracts/renewal-preflight-dialog"
import { contractSearchParams, toContractQuery } from "@/lib/queries/contract-params"
import { formatDate, formatDays, formatNumber, initials } from "@/lib/format"
import { clientDotVar } from "@/lib/client-color"
import { removeResourceView, saveResourceView } from "@/server/actions/views"
import type { ContractRow, ContractSummary } from "@/server/queries/contracts"
import type { Paged } from "@/server/queries/types"
import type { SavedView } from "@/server/queries/saved-views"
import { cn } from "@/lib/utils"

const TYPE_LABELS: Record<string, string> = {
  CDI: "CDI",
  CDD: "CDD",
  INTERIM: "Intérim",
  STAGE: "Stage",
  PRESTATION: "Prestation",
}

const STATUS_TONE: Record<string, "ok" | "muted" | "signal" | "alert"> = {
  ACTIVE: "ok",
  RENEWED: "muted",
  EXPIRED: "signal",
  TERMINATED: "alert",
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Actif",
  RENEWED: "Renouvelé",
  EXPIRED: "Expiré",
  TERMINATED: "Résilié",
}

/**
 * The contracts screen.
 *
 * This component holds no data of its own: rows, totals and facet counts all
 * arrive from the server, and every interaction writes to the URL, which
 * re-runs the server resolver. Nothing is filtered, sorted or paginated here
 * (§3.6), so what is on screen always agrees with what an export would produce.
 */
export function ContractsView({
  firmSlug,
  page,
  summary,
  savedViews,
  clients,
  scoped,
  canRenew,
}: {
  firmSlug: string
  page: Paged<ContractRow>
  summary: ContractSummary
  savedViews: SavedView[]
  clients: { id: string; name: string }[]
  scoped: boolean
  canRenew: boolean
}) {
  const router = useRouter()
  const [params, setParams] = useQueryStates(contractSearchParams, {
    // The server owns the data, so every change is a real navigation.
    shallow: false,
    history: "push",
  })

  const query = toContractQuery(params)

  const [preflightOpen, setPreflightOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()

  /* ---- selection state -------------------------------------------------- */
  // A filter change invalidates a selection made against the old result set —
  // silently keeping it would let a bulk action hit rows the user can no longer
  // see. The fingerprint is stored *with* the selection and compared during
  // render, which is React's documented way to reset state when an input
  // changes. An effect would work too, but it would render once with a stale
  // selection before correcting itself.
  const filterFingerprint = JSON.stringify({ ...params, page: null })
  const [selection, setSelection] = React.useState({
    fingerprint: filterFingerprint,
    ids: new Set<string>(),
    allMatching: false,
  })

  if (selection.fingerprint !== filterFingerprint) {
    setSelection({
      fingerprint: filterFingerprint,
      ids: new Set<string>(),
      allMatching: false,
    })
  }

  const selected = selection.ids
  const allMatching = selection.allMatching

  /* ---- search, debounced ------------------------------------------------ */
  // Same pattern: the input is a draft of a URL value, so when the URL changes
  // underneath it (back button, saved view, drill-through) the draft is
  // adjusted during render rather than in an effect.
  const urlSearch = params.q ?? ""
  const [search, setSearch] = React.useState({ draft: urlSearch, url: urlSearch })

  if (search.url !== urlSearch) {
    setSearch({ draft: urlSearch, url: urlSearch })
  }

  const searchDraft = search.draft

  React.useEffect(() => {
    if (searchDraft === urlSearch) return
    const timer = setTimeout(() => {
      void setParams({ q: searchDraft || null, page: null })
    }, 300)
    return () => clearTimeout(timer)
  }, [searchDraft, urlSearch, setParams])

  /* ---- built-in views --------------------------------------------------- */
  const builtIn: { id: string; label: string; count?: number; tone?: ViewTab["tone"]; patch: Record<string, unknown> }[] = [
    { id: "all", label: "Tous", patch: {} },
    {
      id: "active",
      label: "Actifs",
      count: summary.active,
      patch: { status: ["ACTIVE"] },
    },
    {
      id: "expiring",
      label: "Échéance sous 30 j",
      count: summary.expiringSoon,
      tone: "signal",
      patch: { status: ["ACTIVE"], exp: 30 },
    },
    {
      id: "ceiling",
      label: "Proche de 730 j",
      count: summary.atRisk + summary.overCeiling,
      tone: "alert",
      patch: { type: ["INTERIM"], dmin: 620 },
    },
    {
      id: "unvised",
      label: "Non visés",
      patch: { status: ["ACTIVE"], vise: false },
    },
  ]

  const emptyParams = Object.fromEntries(
    Object.keys(contractSearchParams).map((key) => [key, null])
  )

  function applyPatch(patch: Record<string, unknown>) {
    void setParams({ ...emptyParams, ...patch })
  }

  function matchesPatch(patch: Record<string, unknown>): boolean {
    const keys = Object.keys(contractSearchParams) as (keyof typeof params)[]
    return keys.every((key) => {
      if (key === "page" || key === "per") return true
      const expected = patch[key] ?? null
      const actual = params[key] ?? null
      return JSON.stringify(expected) === JSON.stringify(actual)
    })
  }

  const tabs: ViewTab[] = [
    ...builtIn.map((view) => ({
      id: view.id,
      label: view.label,
      count: view.count,
      tone: view.tone,
      active: matchesPatch(view.patch),
      onSelect: () => applyPatch(view.patch),
    })),
    ...savedViews.map((view) => ({
      id: view.id,
      label: view.name,
      active: false,
      onSelect: () => applyPatch(view.query as Record<string, unknown>),
      onDelete: () => {
        startTransition(async () => {
          await removeResourceView(firmSlug, view.id)
          router.refresh()
        })
      },
    })),
  ]

  const anyBuiltInActive = tabs.some((tab) => tab.active)

  /* ---- chips ------------------------------------------------------------ */
  const chips: FilterChip[] = []
  if (params.q) {
    chips.push({
      key: "q",
      label: "Recherche",
      value: params.q,
      onRemove: () => void setParams({ q: null, page: null }),
    })
  }
  for (const value of params.type ?? []) {
    chips.push({
      key: `type-${value}`,
      label: "Type",
      value: TYPE_LABELS[value] ?? value,
      onRemove: () =>
        void setParams({
          type: (params.type ?? []).filter((entry) => entry !== value),
          page: null,
        }),
    })
  }
  for (const value of params.status ?? []) {
    chips.push({
      key: `status-${value}`,
      label: "Statut",
      value: STATUS_LABELS[value] ?? value,
      onRemove: () =>
        void setParams({
          status: (params.status ?? []).filter((entry) => entry !== value),
          page: null,
        }),
    })
  }
  for (const value of params.client ?? []) {
    chips.push({
      key: `client-${value}`,
      label: "Client",
      value: clients.find((client) => client.id === value)?.name ?? value,
      onRemove: () =>
        void setParams({
          client: (params.client ?? []).filter((entry) => entry !== value),
          page: null,
        }),
    })
  }
  if (params.vise !== null) {
    chips.push({
      key: "vise",
      label: "Visa",
      value: params.vise ? "Visé" : "En attente",
      onRemove: () => void setParams({ vise: null, page: null }),
    })
  }
  if (params.exp !== null) {
    chips.push({
      key: "exp",
      label: "Échéance",
      value: `sous ${params.exp} j`,
      onRemove: () => void setParams({ exp: null, page: null }),
    })
  }
  if (params.dmin !== null) {
    chips.push({
      key: "dmin",
      label: "Plafond",
      value: `≥ ${params.dmin} j cumulés`,
      onRemove: () => void setParams({ dmin: null, page: null }),
    })
  }

  /* ---- selection -------------------------------------------------------- */
  const pageIds = page.rows.map((row) => row.id)
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id))
  const selectedCount = allMatching ? page.total - selected.size : selected.size

  // While `allMatching` is on, `ids` holds the *exclusions* rather than the
  // inclusions, which is what lets "select all 932" cost one boolean.
  function toggleRow(id: string) {
    setSelection((current) => {
      const next = new Set(current.ids)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { ...current, ids: next }
    })
  }

  function togglePage() {
    setSelection((current) => {
      const next = new Set(current.ids)
      if (allOnPage) for (const id of pageIds) next.delete(id)
      else for (const id of pageIds) next.add(id)
      return { ...current, ids: next, allMatching: false }
    })
  }

  function clearSelection() {
    setSelection((current) => ({
      ...current,
      ids: new Set<string>(),
      allMatching: false,
    }))
  }

  /* ---- columns ---------------------------------------------------------- */
  const columns = React.useMemo<ColumnDef<ContractRow, unknown>[]>(
    () => [
      {
        id: "select",
        enableSorting: false,
        meta: { width: 34 },
        header: () => (
          <RowCheckbox
            checked={allOnPage}
            onChange={togglePage}
            label="Sélectionner la page"
          />
        ),
        cell: ({ row }) => (
          <RowCheckbox
            checked={allMatching !== selected.has(row.original.id)}
            onChange={() => toggleRow(row.original.id)}
            label={`Sélectionner ${row.original.employee.lastName}`}
          />
        ),
      },
      {
        id: "employee",
        // TanStack only treats a column as sortable when it has an accessor,
        // even in manual mode where the value is never used for sorting.
        // Without one the header renders no sort control at all.
        accessorFn: (row: ContractRow) => row.id,
        header: "Employé",
        meta: { label: "Employé" },
        cell: ({ row }) => {
          const employee = row.original.employee
          return (
            <div className="flex items-center gap-2.5">
              <Avatar initials={initials(employee.firstName, employee.lastName)} />
              <TwoFacts
                primary={
                  <span className="font-medium">
                    {employee.firstName} {employee.lastName}
                  </span>
                }
                secondary={
                  <>
                    <span className="mono">{employee.matricule}</span>
                    {employee.jobTitle ? ` · ${employee.jobTitle}` : null}
                  </>
                }
              />
            </div>
          )
        },
      },
      {
        id: "type",
        // TanStack only treats a column as sortable when it has an accessor,
        // even in manual mode where the value is never used for sorting.
        // Without one the header renders no sort control at all.
        accessorFn: (row: ContractRow) => row.id,
        header: "Type",
        meta: { label: "Type" },
        cell: ({ row }) => <TagCode>{row.original.type}</TagCode>,
      },
      {
        id: "client",
        // TanStack only treats a column as sortable when it has an accessor,
        // even in manual mode where the value is never used for sorting.
        // Without one the header renders no sort control at all.
        accessorFn: (row: ContractRow) => row.id,
        header: "Client",
        meta: { label: "Client" },
        cell: ({ row }) =>
          row.original.client ? (
            <span className="inline-flex items-center gap-2 text-ink-2">
              <ClientDot colorVar={clientDotVar(row.original.client.id)} />
              <span className="truncate">{row.original.client.name}</span>
            </span>
          ) : (
            <span className="text-ink-3">—</span>
          ),
      },
      {
        id: "period",
        // TanStack only treats a column as sortable when it has an accessor,
        // even in manual mode where the value is never used for sorting.
        // Without one the header renders no sort control at all.
        accessorFn: (row: ContractRow) => row.id,
        header: "Période",
        meta: { label: "Période" },
        cell: ({ row }) => (
          <TwoFacts
            className="mono text-xs whitespace-nowrap text-ink-2"
            primary={formatDate(row.original.startDate)}
            secondary={
              row.original.endDate ? (
                <span className="mono">→ {formatDate(row.original.endDate)}</span>
              ) : (
                "durée indéterminée"
              )
            }
          />
        ),
      },
      {
        id: "remaining",
        // TanStack only treats a column as sortable when it has an accessor,
        // even in manual mode where the value is never used for sorting.
        // Without one the header renders no sort control at all.
        accessorFn: (row: ContractRow) => row.id,
        header: "Reste",
        meta: { align: "right", label: "Jours restants" },
        cell: ({ row }) => {
          const days = row.original.daysRemaining
          if (days === null) return <span className="text-ink-3">—</span>
          const urgent = days >= 0 && days <= 30
          return (
            <TwoFacts
              align="right"
              primary={
                <span
                  className={cn(
                    "num",
                    urgent && "font-semibold text-signal",
                    days < 0 && "text-ink-3"
                  )}
                >
                  {days < 0 ? `échu` : formatDays(days)}
                </span>
              }
              secondary={
                days < 0 ? `depuis ${formatDays(Math.abs(days))}` : undefined
              }
            />
          )
        },
      },
      {
        id: "ceiling",
        // TanStack only treats a column as sortable when it has an accessor,
        // even in manual mode where the value is never used for sorting.
        // Without one the header renders no sort control at all.
        accessorFn: (row: ContractRow) => row.id,
        header: "Plafond 730 j",
        meta: { label: "Plafond 730 j" },
        cell: ({ row }) => (
          <InterimMeter
            usedDays={row.original.ceiling.usedDays}
            projectedDays={row.original.ceiling.projectedDays}
            applicable={row.original.ceiling.applicable}
          />
        ),
      },
      {
        id: "visa",
        // TanStack only treats a column as sortable when it has an accessor,
        // even in manual mode where the value is never used for sorting.
        // Without one the header renders no sort control at all.
        accessorFn: (row: ContractRow) => row.id,
        header: "Visa",
        meta: { label: "Visa" },
        cell: ({ row }) =>
          row.original.isVise ? (
            <StatusPill tone="ok">
              <HugeiconsIcon icon={ShieldCheckIcon} size={11} />
              Visé
            </StatusPill>
          ) : (
            <StatusPill tone="muted">En attente</StatusPill>
          ),
      },
      {
        id: "status",
        // TanStack only treats a column as sortable when it has an accessor,
        // even in manual mode where the value is never used for sorting.
        // Without one the header renders no sort control at all.
        accessorFn: (row: ContractRow) => row.id,
        header: "Statut",
        meta: { label: "Statut" },
        cell: ({ row }) => (
          <StatusPill dot tone={STATUS_TONE[row.original.status] ?? "muted"}>
            {STATUS_LABELS[row.original.status] ?? row.original.status}
          </StatusPill>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allOnPage, allMatching, selected]
  )

  /* ---- sorting ---------------------------------------------------------- */
  const sorting: SortingState = query.sort.map((entry) => ({
    id: entry.id,
    desc: entry.desc,
  }))

  function onSortingChange(next: SortingState) {
    void setParams({
      sort: next.length
        ? next.map((entry) => (entry.desc ? `-${entry.id}` : entry.id))
        : null,
      page: null,
    })
  }

  /* ---- render ----------------------------------------------------------- */
  const from = page.total === 0 ? 0 : (page.page - 1) * page.perPage + 1
  const to = Math.min(page.page * page.perPage, page.total)

  return (
    <>
      <Panel
        title="Contrats"
        description="Triés par échéance. Le plafond légal de 730 jours s'applique par employeur."
        stats={[
          { label: "Actifs", value: formatNumber(summary.active) },
          { label: "À échéance", value: formatNumber(summary.expiringSoon), tone: "signal" },
          {
            label: "Au-delà de 730 j",
            value: formatNumber(summary.overCeiling),
            tone: summary.overCeiling > 0 ? "alert" : "default",
          },
        ]}
        padded={false}
        footer={{
          summary: (
            <span className="num">
              {page.total === 0
                ? "Aucun contrat"
                : `${formatNumber(from)} – ${formatNumber(to)} sur ${formatNumber(page.total)} contrats`}
              {summary.atRisk > 0
                ? ` · ${formatNumber(summary.atRisk)} au-delà de 620 jours cumulés`
                : null}
              {scoped ? " · portefeuille restreint à vos clients" : null}
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
        <SavedViews
          tabs={tabs}
          canSave={!anyBuiltInActive && chips.length > 0}
          onSave={(name) => {
            startTransition(async () => {
              await saveResourceView(firmSlug, "contracts", name, params)
              router.refresh()
            })
          }}
        />

        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-[15px] py-2.5">
          <div className="flex h-[29px] w-[222px] items-center gap-2 rounded-[7px] border border-line px-2.5">
            <HugeiconsIcon icon={Search01Icon} size={13} className="text-ink-3" />
            <input
              value={searchDraft}
              onChange={(event) =>
                setSearch((current) => ({ ...current, draft: event.target.value }))
              }
              placeholder="Nom ou matricule…"
              aria-label="Rechercher un contrat"
              className="w-full border-none bg-transparent text-[12.5px] outline-none"
            />
            {searchDraft ? (
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
            label="Client"
            options={page.facets.client ?? []}
            selected={params.client ?? []}
            onChange={(values) =>
              void setParams({ client: values.length ? values : null, page: null })
            }
          />
          <FacetFilter
            label="Visa"
            options={page.facets.vise ?? []}
            selected={params.vise === null ? [] : [String(params.vise)]}
            onChange={(values) =>
              void setParams({
                vise: values.length === 1 ? values[0] === "true" : null,
                page: null,
              })
            }
          />
        </div>

        <FilterChips
          chips={chips}
          onClearAll={() => void setParams({ ...emptyParams })}
        />

        <DataTable
          data={page.rows}
          columns={columns}
          getRowId={(row) => row.id}
          sorting={sorting}
          onSortingChange={onSortingChange}
          selectedIds={selected}
          onRowClick={(row) =>
            router.push(`/${firmSlug}/hr/employees/${row.employee.id}`)
          }
          label="Contrats"
          empty={
            <EmptyState
              title="Aucun contrat ne correspond"
              description="Retirez un filtre pour élargir la recherche."
              action={
                <button
                  type="button"
                  onClick={() => void setParams({ ...emptyParams })}
                  className="inline-flex h-[30px] items-center rounded-[7px] border border-line bg-surface px-2.5 text-[12.5px] hover:bg-sub"
                >
                  Réinitialiser
                </button>
              }
            />
          }
        />
      </Panel>

      {canRenew ? (
        <BulkActionBar
          selectedCount={selectedCount}
          totalMatching={page.total}
          selectAllMatching={allMatching}
          onSelectAllMatching={() =>
            setSelection((current) => ({
              ...current,
              allMatching: true,
              ids: new Set<string>(),
            }))
          }
          onClear={clearSelection}
          actions={[
            {
              id: "renew",
              label: "Renouveler",
              icon: RefreshIcon,
              onRun: () => setPreflightOpen(true),
            },
            {
              id: "export",
              label: "Exporter",
              icon: Download01Icon,
              onRun: () => {
                window.location.href = `/${firmSlug}/hr/contracts/export${window.location.search}`
              },
            },
          ]}
        />
      ) : null}

      <RenewalPreflightDialog
        open={preflightOpen}
        onOpenChange={setPreflightOpen}
        firmSlug={firmSlug}
        selection={
          allMatching
            ? { query, except: [...selected] }
            : { ids: [...selected] }
        }
        onDone={() => {
          clearSelection()
          router.refresh()
        }}
        busy={pending}
      />
    </>
  )
}
