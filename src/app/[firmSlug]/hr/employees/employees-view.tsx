"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useQueryStates } from "nuqs"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDataTransferHorizontalIcon,
  Cancel01Icon,
  Delete02Icon,
  Download01Icon,
  Edit02Icon,
  PlusSignIcon,
  Search01Icon,
  Upload04Icon,
} from "@hugeicons/core-free-icons"

import {
  DeleteEmployeeDialog,
  EmployeeDialog,
  type EmployeeDefaults,
  type EmployeeOption,
} from "@/app/[firmSlug]/hr/employees/employee-dialogs"
import { ImportEmployeesDialog } from "@/app/[firmSlug]/hr/employees/import-dialog"
import { BulkTransferDialog } from "@/app/[firmSlug]/hr/transfers/transfer-dialogs"
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
import { clientDotVar } from "@/lib/client-color"
import { formatDate, formatDays, formatNumber, initials } from "@/lib/format"
import {
  employeeSearchParams,
  toEmployeeQuery,
} from "@/lib/queries/employee-params"
import { saveResourceView, removeResourceView } from "@/server/actions/views"
import type { EmployeeRow, EmployeeSummary } from "@/server/queries/employees"
import type { SavedView } from "@/server/queries/saved-views"
import type { Paged } from "@/server/queries/types"

const STATUS_TONE: Record<string, "ok" | "muted" | "signal" | "alert"> = {
  ACTIVE: "ok",
  ON_LEAVE: "signal",
  INACTIVE: "muted",
  SUSPENDED: "signal",
  TERMINATED: "alert",
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Actif",
  ON_LEAVE: "En congé",
  INACTIVE: "Inactif",
  SUSPENDED: "Suspendu",
  TERMINATED: "Sorti",
}

/**
 * The employees list. Same contract as the contracts list: the URL is the
 * state, the server owns the rows, nothing is filtered or sorted here.
 *
 * Row click navigates to the record (§5.4) rather than opening a drawer — an
 * employee has five tabs of context, which is more than a drawer should hold.
 * The current query travels with the click so the record can offer prev/next
 * through the result set (§5.5).
 */
export function EmployeesView({
  firmSlug,
  page,
  summary,
  savedViews,
  departments,
  clients,
  transferTargets,
  canWrite,
  scoped,
}: {
  firmSlug: string
  page: Paged<EmployeeRow>
  summary: EmployeeSummary
  savedViews: SavedView[]
  departments: { id: string; name: string }[]
  clients: EmployeeOption[]
  /** Sibling firms in the holding, for a transfer. */
  transferTargets: { id: string; name: string }[]
  canWrite: boolean
  scoped: boolean
}) {
  const router = useRouter()
  const [dialog, setDialog] = React.useState<
    | { kind: "create" }
    | { kind: "edit"; employee: EmployeeDefaults }
    | { kind: "delete"; employee: { id: string; matricule: string; name: string } }
    | { kind: "import" }
    | { kind: "transfer"; ids: string[] }
    | null
  >(null)
  const [params, setParams] = useQueryStates(employeeSearchParams, {
    shallow: false,
    history: "push",
  })
  const query = toEmployeeQuery(params)

  const fingerprint = JSON.stringify({ ...params, page: null })
  const [selection, setSelection] = React.useState({
    fingerprint,
    ids: new Set<string>(),
    allMatching: false,
  })
  if (selection.fingerprint !== fingerprint) {
    setSelection({ fingerprint, ids: new Set<string>(), allMatching: false })
  }

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

  const [, startTransition] = React.useTransition()

  const emptyParams = Object.fromEntries(
    Object.keys(employeeSearchParams).map((key) => [key, null])
  )

  type ParamPatch = Partial<typeof params>

  const builtIn: {
    id: string
    label: string
    count?: number
    tone?: ViewTab["tone"]
    patch: ParamPatch
  }[] = [
    { id: "all", label: "Tous", patch: {} },
    { id: "active", label: "Actifs", count: summary.active, patch: { status: ["ACTIVE"] } },
    {
      id: "ceiling",
      label: "Proche de 730 j",
      count: summary.atRisk + summary.overCeiling,
      tone: "alert",
      patch: { contract: ["INTERIM"], dmin: 620 },
    },
    {
      id: "gaps",
      label: "Dossiers incomplets",
      count: summary.incomplete,
      tone: "signal",
      patch: { gaps: ["cni", "contact", "contract"] },
    },
  ]

  function matches(patch: ParamPatch): boolean {
    return Object.keys(employeeSearchParams).every((key) => {
      if (key === "page" || key === "per") return true
      const expected = (patch as Record<string, unknown>)[key] ?? null
      const actual = (params as Record<string, unknown>)[key] ?? null
      return JSON.stringify(expected) === JSON.stringify(actual)
    })
  }

  const tabs: ViewTab[] = [
    ...builtIn.map((view) => ({
      id: view.id,
      label: view.label,
      count: view.count,
      tone: view.tone,
      active: matches(view.patch),
      onSelect: () => void setParams({ ...emptyParams, ...view.patch }),
    })),
    ...savedViews.map((view) => ({
      id: view.id,
      label: view.name,
      active: false,
      onSelect: () =>
        void setParams({ ...emptyParams, ...(view.query as ParamPatch) }),
      onDelete: () =>
        startTransition(async () => {
          await removeResourceView(firmSlug, view.id)
          router.refresh()
        }),
    })),
  ]

  /* ---- chips ------------------------------------------------------------ */
  const chips: FilterChip[] = []
  const pushChip = (key: string, label: string, value: string, remove: () => void) =>
    chips.push({ key, label, value, onRemove: remove })

  if (params.q) pushChip("q", "Recherche", params.q, () => void setParams({ q: null, page: null }))
  for (const value of params.status ?? [])
    pushChip(`s-${value}`, "Statut", STATUS_LABELS[value] ?? value, () =>
      setParams({ status: (params.status ?? []).filter((v) => v !== value), page: null })
    )
  for (const value of params.contract ?? [])
    pushChip(`c-${value}`, "Contrat", value, () =>
      setParams({ contract: (params.contract ?? []).filter((v) => v !== value), page: null })
    )
  for (const value of params.client ?? [])
    pushChip(
      `cl-${value}`,
      "Client",
      page.facets.client?.find((b) => b.value === value)?.label ?? value,
      () => setParams({ client: (params.client ?? []).filter((v) => v !== value), page: null })
    )
  for (const value of params.dept ?? [])
    pushChip(
      `d-${value}`,
      "Département",
      departments.find((d) => d.id === value)?.name ?? value,
      () => setParams({ dept: (params.dept ?? []).filter((v) => v !== value), page: null })
    )
  if (params.dmin !== null)
    pushChip("dmin", "Plafond", `≥ ${params.dmin} j`, () =>
      setParams({ dmin: null, page: null })
    )
  for (const value of params.gaps ?? [])
    pushChip(
      `g-${value}`,
      "Manquant",
      { cni: "CNI", contact: "contact", contract: "contrat" }[value] ?? value,
      () => setParams({ gaps: (params.gaps ?? []).filter((v) => v !== value), page: null })
    )

  /* ---- selection -------------------------------------------------------- */
  const pageIds = page.rows.map((row) => row.id)
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selection.ids.has(id))
  const selectedCount = selection.allMatching
    ? page.total - selection.ids.size
    : selection.ids.size

  const toggleRow = (id: string) =>
    setSelection((current) => {
      const ids = new Set(current.ids)
      if (ids.has(id)) ids.delete(id)
      else ids.add(id)
      return { ...current, ids }
    })

  const togglePage = () =>
    setSelection((current) => {
      const ids = new Set(current.ids)
      if (allOnPage) for (const id of pageIds) ids.delete(id)
      else for (const id of pageIds) ids.add(id)
      return { ...current, ids, allMatching: false }
    })

  /* ---- columns ---------------------------------------------------------- */
  const columns = React.useMemo<ColumnDef<EmployeeRow, unknown>[]>(
    () => [
      {
        id: "select",
        enableSorting: false,
        meta: { width: 34 },
        header: () => (
          <RowCheckbox checked={allOnPage} onChange={togglePage} label="Sélectionner la page" />
        ),
        cell: ({ row }) => (
          <RowCheckbox
            checked={selection.allMatching !== selection.ids.has(row.original.id)}
            onChange={() => toggleRow(row.original.id)}
            label={`Sélectionner ${row.original.lastName}`}
          />
        ),
      },
      {
        id: "name",
        // TanStack only treats a column as sortable when it has an accessor,
        // even in manual mode where the value is never used for sorting.
        // Without one the header renders no sort control at all.
        accessorFn: (row: EmployeeRow) => row.id,
        header: "Employé",
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <Avatar initials={initials(row.original.firstName, row.original.lastName)} />
            <TwoFacts
              primary={
                <span className="font-medium">
                  {row.original.firstName} {row.original.lastName}
                </span>
              }
              secondary={
                <>
                  <span className="mono">{row.original.matricule}</span>
                  {row.original.jobTitle ? ` · ${row.original.jobTitle}` : null}
                </>
              }
            />
          </div>
        ),
      },
      {
        id: "status",
        // TanStack only treats a column as sortable when it has an accessor,
        // even in manual mode where the value is never used for sorting.
        // Without one the header renders no sort control at all.
        accessorFn: (row: EmployeeRow) => row.id,
        header: "Statut",
        cell: ({ row }) => (
          <StatusPill dot tone={STATUS_TONE[row.original.status] ?? "muted"}>
            {STATUS_LABELS[row.original.status] ?? row.original.status}
          </StatusPill>
        ),
      },
      {
        id: "client",
        // TanStack only treats a column as sortable when it has an accessor,
        // even in manual mode where the value is never used for sorting.
        // Without one the header renders no sort control at all.
        accessorFn: (row: EmployeeRow) => row.id,
        header: "Client",
        cell: ({ row }) =>
          row.original.client ? (
            <span className="inline-flex items-center gap-2 text-ink-2">
              <ClientDot colorVar={clientDotVar(row.original.client.id)} />
              <span className="truncate">{row.original.client.name}</span>
            </span>
          ) : (
            <span className="text-ink-3">non affecté</span>
          ),
      },
      {
        id: "contract",
        // TanStack only treats a column as sortable when it has an accessor,
        // even in manual mode where the value is never used for sorting.
        // Without one the header renders no sort control at all.
        accessorFn: (row: EmployeeRow) => row.id,
        header: "Contrat",
        cell: ({ row }) => {
          const contract = row.original.currentContract
          if (!contract) return <span className="text-signal">aucun</span>
          return (
            <TwoFacts
              primary={<TagCode>{contract.type}</TagCode>}
              secondary={
                contract.endDate
                  ? `→ ${formatDate(contract.endDate)}`
                  : "durée indéterminée"
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
        accessorFn: (row: EmployeeRow) => row.id,
        header: "Plafond 730 j",
        cell: ({ row }) => (
          <InterimMeter
            usedDays={row.original.ceiling.usedDays}
            projectedDays={row.original.ceiling.projectedDays}
            applicable={row.original.ceiling.applicable}
          />
        ),
      },
      {
        id: "seniority",
        // TanStack only treats a column as sortable when it has an accessor,
        // even in manual mode where the value is never used for sorting.
        // Without one the header renders no sort control at all.
        accessorFn: (row: EmployeeRow) => row.id,
        header: "Ancienneté",
        meta: { align: "right" },
        cell: ({ row }) => (
          <TwoFacts
            align="right"
            primary={<span className="num">{seniorityLabel(row.original.seniorityDays)}</span>}
            secondary={`depuis ${formatDate(row.original.hireDate)}`}
          />
        ),
      },
      {
        id: "gaps",
        enableSorting: false,
        header: "Dossier",
        cell: ({ row }) =>
          row.original.missing.length === 0 ? (
            <span className="text-[11.5px] text-ink-3">complet</span>
          ) : (
            <StatusPill tone="signal">
              {row.original.missing.join(", ")} manquant
              {row.original.missing.length > 1 ? "s" : ""}
            </StatusPill>
          ),
      },
      ...(canWrite
        ? [
            {
              id: "actions",
              enableSorting: false,
              header: "",
              meta: { align: "right" as const },
              cell: ({ row }: { row: { original: EmployeeRow } }) => (
                <div className="flex items-center justify-end gap-0.5">
                  {/*
                    Editing opens on the record, not here: the wizard writes
                    every personal field, and the list only carries a handful of
                    them. Opening it from a partial row would blank the rest.
                  */}
                  <button
                    type="button"
                    aria-label={`Modifier ${row.original.firstName} ${row.original.lastName}`}
                    title="Modifier"
                    onClick={(event) => {
                      event.stopPropagation()
                      router.push(
                        `/${firmSlug}/hr/employees/${row.original.id}?edit=1`
                      )
                    }}
                    className="grid size-7 place-items-center rounded-[7px] text-ink-3 hover:bg-sunken hover:text-ink"
                  >
                    <HugeiconsIcon icon={Edit02Icon} size={14} strokeWidth={1.8} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Supprimer ${row.original.firstName} ${row.original.lastName}`}
                    title="Supprimer"
                    onClick={(event) => {
                      event.stopPropagation()
                      setDialog({
                        kind: "delete",
                        employee: {
                          id: row.original.id,
                          matricule: row.original.matricule,
                          name: `${row.original.firstName} ${row.original.lastName}`,
                        },
                      })
                    }}
                    className="grid size-7 place-items-center rounded-[7px] text-ink-3 hover:bg-alert-tint hover:text-alert"
                  >
                    <HugeiconsIcon icon={Delete02Icon} size={14} strokeWidth={1.8} />
                  </button>
                </div>
              ),
            },
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allOnPage, selection, canWrite, firmSlug, router]
  )

  const sorting: SortingState = query.sort.map((entry) => ({
    id: entry.id,
    desc: entry.desc,
  }))

  const from = page.total === 0 ? 0 : (page.page - 1) * page.perPage + 1
  const to = Math.min(page.page * page.perPage, page.total)

  return (
    <>
      <Panel
        title="Effectif"
        description="Trié par exposition au plafond légal, puis par échéance de contrat."
        stats={[
          { label: "Actifs", value: formatNumber(summary.active) },
          {
            label: "Dossiers incomplets",
            value: formatNumber(summary.incomplete),
            tone: summary.incomplete > 0 ? "signal" : "default",
          },
          {
            label: "Au-delà de 730 j",
            value: formatNumber(summary.overCeiling),
            tone: summary.overCeiling > 0 ? "alert" : "default",
          },
        ]}
        padded={false}
        tools={
          canWrite ? (
            <>
              <button
                type="button"
                onClick={() => setDialog({ kind: "import" })}
                className="inline-flex h-[30px] items-center gap-1.5 rounded-[7px] border border-line bg-surface px-2.5 text-[12.5px] hover:bg-sub"
              >
                <HugeiconsIcon icon={Upload04Icon} size={13} />
                Importer
              </button>
              <button
                type="button"
                onClick={() => setDialog({ kind: "create" })}
                className="inline-flex h-[30px] items-center gap-1.5 rounded-[7px] bg-ink px-2.5 text-[12.5px] font-medium text-paper hover:opacity-90"
              >
                <HugeiconsIcon icon={PlusSignIcon} size={13} />
                Nouvel employé
              </button>
            </>
          ) : null
        }
        footer={{
          summary: (
            <span className="num">
              {page.total === 0
                ? "Aucun employé"
                : `${formatNumber(from)} – ${formatNumber(to)} sur ${formatNumber(page.total)} employés`}
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
          canSave={!tabs.some((tab) => tab.active) && chips.length > 0}
          onSave={(name) =>
            startTransition(async () => {
              await saveResourceView(firmSlug, "employees", name, params)
              router.refresh()
            })
          }
        />

        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-[15px] py-2.5">
          <div className="flex h-[29px] w-[222px] items-center gap-2 rounded-[7px] border border-line px-2.5">
            <HugeiconsIcon icon={Search01Icon} size={13} className="text-ink-3" />
            <input
              value={search.draft}
              onChange={(event) =>
                setSearch((current) => ({ ...current, draft: event.target.value }))
              }
              placeholder="Nom, matricule, poste…"
              aria-label="Rechercher un employé"
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
            label="Contrat"
            options={page.facets.contractType ?? []}
            selected={params.contract ?? []}
            onChange={(values) =>
              void setParams({
                contract: values.length ? (values as typeof params.contract) : null,
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
            label="Département"
            options={page.facets.department ?? []}
            selected={params.dept ?? []}
            onChange={(values) =>
              void setParams({ dept: values.length ? values : null, page: null })
            }
          />
        </div>

        <FilterChips chips={chips} onClearAll={() => void setParams({ ...emptyParams })} />

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
          selectedIds={selection.ids}
          onRowClick={(row) => {
            // The current query travels with the click, so the record can walk
            // prev/next through this exact result set.
            const search = new URLSearchParams(window.location.search).toString()
            router.push(
              `/${firmSlug}/hr/employees/${row.id}${search ? `?${search}` : ""}`
            )
          }}
          label="Employés"
          empty={
            <EmptyState
              title="Aucun employé ne correspond"
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

      <BulkActionBar
        selectedCount={selectedCount}
        totalMatching={page.total}
        selectAllMatching={selection.allMatching}
        onSelectAllMatching={() =>
          setSelection((current) => ({
            ...current,
            allMatching: true,
            ids: new Set<string>(),
          }))
        }
        onClear={() =>
          setSelection((current) => ({
            ...current,
            ids: new Set<string>(),
            allMatching: false,
          }))
        }
        actions={[
          {
            id: "export",
            label: "Exporter",
            icon: Download01Icon,
            onRun: () => {
              window.location.href = `/${firmSlug}/hr/employees/export${window.location.search}`
            },
          },
          ...(canWrite && transferTargets.length > 0
            ? [
                {
                  id: "transfer",
                  label: "Transférer",
                  icon: ArrowDataTransferHorizontalIcon,
                  // Deliberately ids-only: a transfer writes one row per
                  // employee and reserves one matricule each, so it must know
                  // exactly who. "Everything matching" is not a safe input here.
                  warning: selection.allMatching,
                  onRun: () =>
                    setDialog({ kind: "transfer", ids: [...selection.ids] }),
                },
              ]
            : []),
        ]}
      />

      {dialog?.kind === "create" || dialog?.kind === "edit" ? (
        <EmployeeDialog
          firmSlug={firmSlug}
          employee={dialog.kind === "edit" ? dialog.employee : null}
          clients={clients}
          departments={departments}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === "delete" ? (
        <DeleteEmployeeDialog
          firmSlug={firmSlug}
          employee={dialog.employee}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === "import" ? (
        <ImportEmployeesDialog
          firmSlug={firmSlug}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === "transfer" ? (
        <BulkTransferDialog
          firmSlug={firmSlug}
          employeeIds={dialog.ids}
          firms={transferTargets}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  )
}

/** `2 ans`, `8 mois`, `18 j` — the coarsest unit that is still honest. */
function seniorityLabel(days: number): string {
  if (days >= 365) {
    const years = Math.floor(days / 365)
    return `${years} an${years > 1 ? "s" : ""}`
  }
  if (days >= 60) return `${Math.floor(days / 30)} mois`
  return formatDays(days)
}

export { seniorityLabel }
