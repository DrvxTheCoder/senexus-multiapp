"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useQueryStates } from "nuqs"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Archive02Icon,
  Cancel01Icon,
  Edit02Icon,
  PlusSignIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons"

import {
  ArchiveClientDialog,
  ClientDialog,
  type ClientDefaults,
} from "@/app/[firmSlug]/crm/clients/client-dialogs"
import { DataTable } from "@/components/data-table"
import { FacetFilter } from "@/components/filters/facet-filter"
import { Pager } from "@/components/list-controls"
import { Panel } from "@/components/panel"
import { Avatar, ClientDot, EmptyState, StatusPill, TwoFacts } from "@/components/primitives"
import { ResourceDrawer } from "@/components/resource-drawer"
import { clientDotVar } from "@/lib/client-color"
import {
  formatCurrency,
  formatCurrencyCompact,
  formatDateProse,
  formatDays,
  formatNumber,
  initials,
} from "@/lib/format"
import { clientSearchParams, toClientQuery } from "@/lib/queries/client-params"
import { employeesHref } from "@/lib/queries/employee-params"
import type { ClientRow, ClientSummary } from "@/server/queries/clients"
import type { Paged } from "@/server/queries/types"

const STATUS_TONE: Record<string, "ok" | "signal" | "muted"> = {
  ACTIVE: "ok",
  PROSPECT: "signal",
  INACTIVE: "muted",
  ARCHIVED: "muted",
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Actif",
  PROSPECT: "Prospect",
  INACTIVE: "Inactif",
  ARCHIVED: "Archivé",
}

/**
 * Clients. A row opens a **drawer** (§5.4) rather than navigating: a client is
 * a summary you read and dismiss, unlike an employee record which is a place
 * you work.
 *
 * The open drawer is a URL parameter, which means its contents are server
 * rendered like everything else, and a colleague can be sent a link that opens
 * directly on one account.
 */
export function ClientsView({
  firmSlug,
  page,
  summary,
  scoped,
  openClientId,
  placements,
  hrEnabled,
  canWrite,
}: {
  firmSlug: string
  page: Paged<ClientRow>
  summary: ClientSummary
  scoped: boolean
  openClientId: string | null
  placements: {
    id: string
    firstName: string
    lastName: string
    matricule: string
    jobTitle: string | null
  }[]
  hrEnabled: boolean
  canWrite: boolean
}) {
  const router = useRouter()
  const [dialog, setDialog] = React.useState<
    | { kind: "create" }
    | { kind: "edit"; client: ClientDefaults }
    | { kind: "archive"; client: { id: string; name: string } }
    | null
  >(null)
  const [params, setParams] = useQueryStates(clientSearchParams, {
    shallow: false,
    history: "push",
  })
  const query = toClientQuery(params)

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

  const openClient = page.rows.find((row) => row.id === openClientId) ?? null

  const columns = React.useMemo<ColumnDef<ClientRow, unknown>[]>(
    () => [
      {
        id: "name",
        // TanStack only treats a column as sortable when it has an accessor,
        // even in manual mode where the value is never used for sorting.
        // Without one the header renders no sort control at all.
        accessorFn: (row: ClientRow) => row.id,
        header: "Client",
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <ClientDot colorVar={clientDotVar(row.original.id)} className="size-2" />
            <TwoFacts
              primary={<span className="font-medium">{row.original.name}</span>}
              secondary={
                <>
                  {row.original.industry ?? "Secteur non renseigné"}
                  {row.original.since
                    ? ` · client depuis ${formatDateProse(row.original.since)}`
                    : null}
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
        accessorFn: (row: ClientRow) => row.id,
        header: "Statut",
        cell: ({ row }) => (
          <StatusPill dot tone={STATUS_TONE[row.original.status] ?? "muted"}>
            {STATUS_LABELS[row.original.status] ?? row.original.status}
          </StatusPill>
        ),
      },
      {
        id: "placed",
        // TanStack only treats a column as sortable when it has an accessor,
        // even in manual mode where the value is never used for sorting.
        // Without one the header renders no sort control at all.
        accessorFn: (row: ClientRow) => row.id,
        header: "Effectif placé",
        meta: { align: "right" },
        cell: ({ row }) =>
          row.original.placed === 0 ? (
            <span className="text-ink-3">—</span>
          ) : (
            <TwoFacts
              align="right"
              primary={<span className="num">{formatNumber(row.original.placed)}</span>}
              secondary={`de ${formatNumber(row.original.activeContracts)} contrats`}
            />
          ),
      },
      {
        id: "payroll",
        // TanStack only treats a column as sortable when it has an accessor,
        // even in manual mode where the value is never used for sorting.
        // Without one the header renders no sort control at all.
        accessorFn: (row: ClientRow) => row.id,
        header: "Masse salariale",
        meta: { align: "right" },
        cell: ({ row }) =>
          row.original.monthlyPayroll === 0 ? (
            <span className="text-ink-3">—</span>
          ) : (
            <span className="mono num">{formatCurrency(row.original.monthlyPayroll)}</span>
          ),
      },
      {
        id: "nextExpiry",
        // TanStack only treats a column as sortable when it has an accessor,
        // even in manual mode where the value is never used for sorting.
        // Without one the header renders no sort control at all.
        accessorFn: (row: ClientRow) => row.id,
        header: "Prochaine échéance",
        cell: ({ row }) =>
          row.original.nextExpiry ? (
            <TwoFacts
              primary={formatDateProse(row.original.nextExpiry)}
              secondary={
                <span
                  className={
                    (row.original.daysToNextExpiry ?? 999) <= 30 ? "text-signal" : undefined
                  }
                >
                  dans {formatDays(row.original.daysToNextExpiry)}
                </span>
              }
            />
          ) : (
            <span className="text-ink-3">—</span>
          ),
      },
      {
        id: "contact",
        enableSorting: false,
        header: "Contact",
        cell: ({ row }) =>
          row.original.contactName ? (
            <TwoFacts
              primary={<span className="text-ink-2">{row.original.contactName}</span>}
              secondary={row.original.contactPhone ?? row.original.contactEmail ?? undefined}
            />
          ) : (
            <span className="text-ink-3">—</span>
          ),
      },
      ...(canWrite
        ? [
            {
              id: "actions",
              enableSorting: false,
              header: "",
              meta: { align: "right" as const },
              cell: ({ row }: { row: { original: ClientRow } }) => (
                <div className="flex items-center justify-end gap-0.5">
                  <button
                    type="button"
                    title="Modifier"
                    aria-label={`Modifier ${row.original.name}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      setDialog({
                        kind: "edit",
                        client: {
                          id: row.original.id,
                          name: row.original.name,
                          status: row.original.status,
                          contactName: row.original.contactName ?? "",
                          contactEmail: row.original.contactEmail ?? "",
                          contactPhone: row.original.contactPhone ?? "",
                          taxNumber: "",
                          industry: row.original.industry ?? "",
                          address: row.original.address ?? "",
                          contractStartDate: row.original.since
                            ? new Date(row.original.since)
                                .toISOString()
                                .slice(0, 10)
                            : "",
                          contractEndDate: "",
                          notes: "",
                        },
                      })
                    }}
                    className="grid size-7 place-items-center rounded-[7px] text-ink-3 hover:bg-sunken hover:text-ink"
                  >
                    <HugeiconsIcon icon={Edit02Icon} size={14} strokeWidth={1.8} />
                  </button>
                  <button
                    type="button"
                    title="Archiver"
                    aria-label={`Archiver ${row.original.name}`}
                    disabled={row.original.status === "ARCHIVED"}
                    onClick={(event) => {
                      event.stopPropagation()
                      setDialog({
                        kind: "archive",
                        client: { id: row.original.id, name: row.original.name },
                      })
                    }}
                    className="grid size-7 place-items-center rounded-[7px] text-ink-3 hover:bg-alert-tint hover:text-alert disabled:opacity-30"
                  >
                    <HugeiconsIcon icon={Archive02Icon} size={14} strokeWidth={1.8} />
                  </button>
                </div>
              ),
            },
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canWrite]
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
        title="Portefeuille"
        description="Comptes clients, effectif placé et prochaines échéances."
        stats={[
          { label: "Comptes actifs", value: formatNumber(summary.active) },
          { label: "Placés", value: formatNumber(summary.placed) },
          { label: "Masse", value: formatCurrencyCompact(summary.monthlyPayroll) },
        ]}
        padded={false}
        tools={
          canWrite ? (
            <button
              type="button"
              onClick={() => setDialog({ kind: "create" })}
              className="inline-flex h-[30px] items-center gap-1.5 rounded-[7px] bg-ink px-2.5 text-[12.5px] font-medium text-paper hover:opacity-90"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={13} />
              Nouveau client
            </button>
          ) : null
        }
        footer={{
          summary: (
            <span className="num">
              {page.total === 0
                ? "Aucun client"
                : `${formatNumber(from)} – ${formatNumber(to)} sur ${formatNumber(page.total)} comptes · ${formatNumber(summary.placed)} employés placés`}
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
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-[15px] py-2.5">
          <div className="flex h-[29px] w-[222px] items-center gap-2 rounded-[7px] border border-line px-2.5">
            <HugeiconsIcon icon={Search01Icon} size={13} className="text-ink-3" />
            <input
              value={search.draft}
              onChange={(event) =>
                setSearch((current) => ({ ...current, draft: event.target.value }))
              }
              placeholder="Nom du client…"
              aria-label="Rechercher un client"
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
            label="Secteur"
            options={page.facets.industry ?? []}
            selected={params.industry ?? []}
            onChange={(values) =>
              void setParams({ industry: values.length ? values : null, page: null })
            }
          />
        </div>

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
          label="Clients"
          empty={
            <EmptyState
              title="Aucun client ne correspond"
              description="Retirez un filtre pour élargir la recherche."
            />
          }
        />
      </Panel>

      <ResourceDrawer
        open={Boolean(openClient)}
        onClose={() => void setParams({ open: null })}
        title={openClient?.name ?? ""}
        subtitle={
          openClient
            ? [
                openClient.industry,
                openClient.since ? `client depuis ${formatDateProse(openClient.since)}` : null,
                openClient.address,
              ]
                .filter(Boolean)
                .join(" · ")
            : undefined
        }
        accent={openClient ? clientDotVar(openClient.id) : undefined}
        footer={
          openClient && hrEnabled ? (
            <Link
              href={employeesHref(firmSlug, { clientId: [openClient.id] })}
              className="inline-flex h-8 flex-1 items-center justify-center rounded-[7px] border border-line bg-surface text-[12.5px] hover:bg-sub"
            >
              Voir les {formatNumber(openClient.placed)} employés placés
            </Link>
          ) : null
        }
      >
        {openClient ? (
          <>
            <div className="mb-4 grid grid-cols-3 gap-2.5">
              <DrawerStat label="Effectif" value={formatNumber(openClient.placed)} />
              <DrawerStat
                label="Contrats"
                value={formatNumber(openClient.activeContracts)}
              />
              <DrawerStat
                label="Échéance"
                value={
                  openClient.nextExpiry ? formatDateProse(openClient.nextExpiry) : "—"
                }
              />
            </div>

            <dl className="mb-4">
              {[
                ["Contact", openClient.contactName],
                ["Téléphone", openClient.contactPhone],
                ["Email", openClient.contactEmail],
                ["Adresse", openClient.address],
                ["Masse salariale", formatCurrency(openClient.monthlyPayroll)],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="grid grid-cols-[112px_1fr] gap-3 border-b border-line py-1.5 text-[13px] last:border-b-0"
                >
                  <dt className="text-[12.5px] text-ink-3">{label}</dt>
                  <dd className="truncate">{value || "—"}</dd>
                </div>
              ))}
            </dl>

            <p className="text-[13px] font-semibold">Employés placés</p>
            <p className="mt-0.5 mb-2 text-xs text-ink-3">
              {placements.length === 0
                ? "Aucun employé actif sur ce compte."
                : `${formatNumber(placements.length)} affichés sur ${formatNumber(openClient.placed)}.`}
            </p>

            <ul>
              {placements.map((employee) => (
                <li key={employee.id}>
                  <button
                    type="button"
                    onClick={() =>
                      router.push(`/${firmSlug}/hr/employees/${employee.id}`)
                    }
                    className="flex w-full items-center gap-2.5 rounded-[7px] px-1.5 py-2 text-left hover:bg-brand-wash"
                  >
                    <Avatar initials={initials(employee.firstName, employee.lastName)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px]">
                        {employee.firstName} {employee.lastName}
                      </span>
                      <span className="block truncate text-[11.5px] text-ink-3">
                        <span className="mono">{employee.matricule}</span>
                        {employee.jobTitle ? ` · ${employee.jobTitle}` : null}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </ResourceDrawer>

      {dialog?.kind === "create" || dialog?.kind === "edit" ? (
        <ClientDialog
          firmSlug={firmSlug}
          client={dialog.kind === "edit" ? dialog.client : null}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === "archive" ? (
        <ArchiveClientDialog
          firmSlug={firmSlug}
          client={dialog.client}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  )
}

function DrawerStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-sub px-2.5 py-2">
      <div className="text-[11.5px] text-ink-3">{label}</div>
      <div className="num mt-0.5 text-[15px] font-semibold tracking-[-0.02em]">
        {value}
      </div>
    </div>
  )
}
