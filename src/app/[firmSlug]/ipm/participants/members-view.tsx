"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useQueryStates } from "nuqs"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Cancel01Icon,
  Login01Icon,
  PlusSignIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons"

import { MemberDialog } from "@/app/[firmSlug]/ipm/participants/member-dialogs"
import {
  AccessRequestsPanel,
  BulkPortalAccessDialog,
  type PortalSelection,
} from "@/app/[firmSlug]/ipm/participants/portal-access"
import { BulkActionBar } from "@/components/bulk-action-bar"
import { DataTable } from "@/components/data-table"
import { FacetFilter } from "@/components/filters/facet-filter"
import { Pager, RowCheckbox } from "@/components/list-controls"
import { Panel } from "@/components/panel"
import { Avatar, EmptyState, StatusPill, TwoFacts } from "@/components/primitives"
import { formatCurrency, formatDate, formatNumber, initials } from "@/lib/format"
import {
  MEMBER_PORTAL_LABELS,
  MEMBER_PORTAL_TONES,
  MEMBER_STATUS_LABELS,
  MEMBER_STATUS_TONES,
  type MemberPortalState,
  type MemberQuery,
} from "@/lib/queries/ipm/member-query"
import { memberSearchParams, toMemberQuery } from "@/lib/queries/ipm/member-params"
import type {
  AccessRequestRow,
  MemberRow,
  MemberSummary,
} from "@/server/queries/ipm/members"
import type { Paged } from "@/server/queries/types"

type EmployerOption = {
  id: string
  name: string
  ageMajority: number
  planCode: string | null
}

/**
 * Participants.
 *
 * A row **navigates** rather than opening a drawer: a participant is a file
 * Rokhaya works in — identity, family, cotisations, card — not a summary she
 * glances at and dismisses. That is the same distinction the CRM makes in the
 * other direction, where a client opens a drawer.
 *
 * Search covers both matricules. The card carries `01716` and the old cards in
 * circulation carry `001-00185-21`, so a number read at the counter finds its
 * participant whichever card it came from (§11 Q1).
 */
export function MembersView({
  firmSlug,
  page,
  summary,
  employers,
  accessRequests,
  canWrite,
}: {
  firmSlug: string
  page: Paged<MemberRow>
  summary: MemberSummary
  employers: EmployerOption[]
  accessRequests: AccessRequestRow[]
  canWrite: boolean
}) {
  const router = useRouter()
  const [params, setParams] = useQueryStates(memberSearchParams, {
    shallow: false,
  })
  const query: MemberQuery = toMemberQuery(params)

  const [creating, setCreating] = React.useState(false)
  const [granting, setGranting] = React.useState<{
    selection: PortalSelection
    count: number
  } | null>(null)

  // As on the employees list: a selection belongs to the filters it was made
  // under, and is dropped when they change — only the page may move.
  const fingerprint = JSON.stringify({ ...params, page: null })
  const [selection, setSelection] = React.useState({
    fingerprint,
    ids: new Set<string>(),
    allMatching: false,
  })
  if (selection.fingerprint !== fingerprint) {
    setSelection({ fingerprint, ids: new Set<string>(), allMatching: false })
  }
  const clearSelection = () =>
    setSelection((current) => ({ ...current, ids: new Set<string>(), allMatching: false }))

  // Same shape as the clients list: the draft is synced during render rather
  // than in an effect, and the URL is only written after the typing settles.
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

  const onSortingChange = (next: SortingState) => {
    void setParams({
      sort: next.map((entry) => (entry.desc ? `-${entry.id}` : entry.id)),
      page: 1,
    })
  }

  const statusOptions = React.useMemo(
    () =>
      (page.facets.status ?? []).map((bucket) => ({
        value: bucket.value,
        label:
          MEMBER_STATUS_LABELS[
            bucket.value as keyof typeof MEMBER_STATUS_LABELS
          ] ?? bucket.value,
        count: bucket.count,
      })),
    [page.facets.status]
  )

  const employerOptions = React.useMemo(
    () => page.facets.employer ?? [],
    [page.facets.employer]
  )

  const portalOptions = React.useMemo(
    () =>
      (page.facets.portal ?? []).map((bucket) => ({
        value: bucket.value,
        label: MEMBER_PORTAL_LABELS[bucket.value as MemberPortalState] ?? bucket.value,
        count: bucket.count,
      })),
    [page.facets.portal]
  )

  /* ---- selection -------------------------------------------------------- */
  const pageIds = page.rows.map((row) => row.id)
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selection.ids.has(id))
  // With "everything matching", `ids` holds the rows unticked since.
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

  const columns = React.useMemo<ColumnDef<MemberRow, unknown>[]>(
    () => [
      ...(canWrite
        ? [
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
                  checked={selection.allMatching !== selection.ids.has(row.original.id)}
                  onChange={() => toggleRow(row.original.id)}
                  label={`Sélectionner ${row.original.lastName}`}
                />
              ),
            } satisfies ColumnDef<MemberRow, unknown>,
          ]
        : []),
      {
        id: "name",
        header: "Participant",
        enableSorting: true,
        cell: ({ row }) => {
          const member = row.original
          return (
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar initials={initials(member.firstName, member.lastName)} />
              <TwoFacts
                primary={`${member.lastName.toUpperCase()} ${member.firstName}`}
                secondary={
                  member.legacyCode
                    ? `${member.matricule} · ${member.legacyCode}`
                    : member.matricule
                }
              />
            </div>
          )
        },
      },
      {
        id: "employer",
        header: "Employeur",
        enableSorting: true,
        cell: ({ row }) => (
          <TwoFacts
            primary={row.original.employerName}
            secondary={row.original.planCode ?? "Taux propre"}
          />
        ),
      },
      {
        id: "dependents",
        header: "Ayants droit",
        enableSorting: true,
        cell: ({ row }) =>
          row.original.dependentCount === 0 ? (
            <span className="text-ink-3">—</span>
          ) : (
            formatNumber(row.original.dependentCount)
          ),
      },
      {
        id: "contribution",
        header: "Cotisation",
        cell: ({ row }) =>
          row.original.monthlyContribution === null ? (
            // Not a zero. No cotisation open is a gap to fill, and a zero
            // would read as "pays nothing", which is a different claim.
            <span className="text-alert">Aucune</span>
          ) : (
            <span className="tabular-nums">
              {formatCurrency(row.original.monthlyContribution)}
            </span>
          ),
      },
      {
        id: "affiliationDate",
        header: "Affiliation",
        enableSorting: true,
        cell: ({ row }) => (
          <span className="tabular-nums text-ink-2">
            {formatDate(row.original.affiliationDate)}
          </span>
        ),
      },
      {
        id: "status",
        header: "Statut",
        enableSorting: true,
        cell: ({ row }) => (
          <StatusPill
            tone={
              MEMBER_STATUS_TONES[
                row.original.status as keyof typeof MEMBER_STATUS_TONES
              ] ?? "muted"
            }
          >
            {MEMBER_STATUS_LABELS[
              row.original.status as keyof typeof MEMBER_STATUS_LABELS
            ] ?? row.original.status}
          </StatusPill>
        ),
      },
      {
        id: "portal",
        header: "Portail",
        cell: ({ row }) =>
          row.original.portal === "NONE" ? (
            <span className="text-ink-3">—</span>
          ) : (
            <StatusPill tone={MEMBER_PORTAL_TONES[row.original.portal]}>
              {MEMBER_PORTAL_LABELS[row.original.portal]}
            </StatusPill>
          ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canWrite, allOnPage, selection]
  )

  const filtersActive =
    Boolean(params.q) ||
    Boolean(params.status?.length) ||
    Boolean(params.employer?.length) ||
    Boolean(params.portal?.length) ||
    params.deps !== null

  return (
    <>
      <AccessRequestsPanel
        firmSlug={firmSlug}
        requests={accessRequests}
        canWrite={canWrite}
      />

      <Panel
        title="Participants"
        description={`${formatNumber(summary.total)} affiliés · ${formatNumber(summary.active)} actifs · ${formatNumber(summary.dependents)} ayants droit`}
        padded={false}
        stats={[
          {
            label: "Cotisations mensuelles",
            value: formatCurrency(summary.monthlyContributions),
          },
          {
            label: "Sans cotisation",
            value: formatNumber(summary.withoutContribution),
            tone: summary.withoutContribution > 0 ? "alert" : undefined,
          },
        ]}
        tools={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <HugeiconsIcon
                icon={Search01Icon}
                size={14}
                className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-ink-3"
                aria-hidden
              />
              <input
                value={search.draft}
                onChange={(event) =>
                  setSearch((state) => ({ ...state, draft: event.target.value }))
                }
                placeholder="Nom, matricule, CNI…"
                aria-label="Rechercher un participant"
                className="h-8 w-56 rounded-[7px] border border-line bg-surface pr-2 pl-7 text-[13px] outline-none focus:border-brand"
              />
            </div>

            <FacetFilter
              label="Statut"
              options={statusOptions}
              selected={params.status ?? []}
              onChange={(values) =>
                void setParams({
                  status: values.length
                    ? (values as typeof params.status)
                    : null,
                  page: 1,
                })
              }
            />

            <FacetFilter
              label="Employeur"
              options={employerOptions}
              selected={params.employer ?? []}
              onChange={(values) =>
                void setParams({ employer: values.length ? values : null, page: 1 })
              }
            />

            <FacetFilter
              label="Portail"
              options={portalOptions}
              selected={params.portal ?? []}
              onChange={(values) =>
                void setParams({
                  portal: values.length ? (values as typeof params.portal) : null,
                  page: 1,
                })
              }
            />

            {filtersActive ? (
              <button
                type="button"
                onClick={() =>
                  void setParams({
                    q: null,
                    status: null,
                    employer: null,
                    portal: null,
                    deps: null,
                    page: 1,
                  })
                }
                className="flex h-8 items-center gap-1.5 rounded-[7px] px-2 text-[13px] text-ink-3 hover:text-ink"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={13} aria-hidden />
                Effacer
              </button>
            ) : null}

            {canWrite ? (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex h-8 items-center gap-1.5 rounded-[7px] bg-brand px-2.5 text-[13px] font-medium text-brand-contrast hover:opacity-90"
              >
                <HugeiconsIcon icon={PlusSignIcon} size={13} aria-hidden />
                Affilier
              </button>
            ) : null}
          </div>
        }
        footer={{
          summary: `${formatNumber(page.total)} participant${page.total > 1 ? "s" : ""}`,
          action: (
            <Pager
              page={page.page}
              pageCount={page.pageCount}
              onChange={(next) => void setParams({ page: next })}
            />
          ),
        }}
      >
        <DataTable
          label="Participants"
          data={page.rows}
          columns={columns}
          getRowId={(row) => row.id}
          selectedIds={selection.ids}
          sorting={sorting}
          onSortingChange={onSortingChange}
          onRowClick={(row) =>
            router.push(`/${firmSlug}/ipm/participants/${row.id}`)
          }
          empty={
            <EmptyState
              title={
                filtersActive
                  ? "Aucun participant ne correspond"
                  : "Aucun participant affilié"
              }
              description={
                filtersActive
                  ? "Modifiez les filtres ou effacez-les pour voir la liste complète."
                  : "Affiliez un premier participant, ou reprenez le fichier WebLamps."
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
        onClear={clearSelection}
        actions={
          canWrite
            ? [
                {
                  id: "portal",
                  label: "Ouvrir le portail",
                  icon: Login01Icon,
                  onRun: () =>
                    setGranting({
                      count: selectedCount,
                      selection: selection.allMatching
                        ? {
                            matching: {
                              search: query.search,
                              status: query.status,
                              employerId: query.employerId,
                              withDependents: query.withDependents,
                              portal: query.portal,
                            },
                            excludeIds: [...selection.ids],
                          }
                        : { memberIds: [...selection.ids] },
                    }),
                },
              ]
            : []
        }
      />

      {granting ? (
        <BulkPortalAccessDialog
          firmSlug={firmSlug}
          count={granting.count}
          selection={granting.selection}
          onClose={() => setGranting(null)}
          onDone={clearSelection}
        />
      ) : null}

      {creating ? (
        <MemberDialog
          firmSlug={firmSlug}
          employers={employers}
          member={null}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {employers.length === 0 && canWrite ? (
        <p className="mt-3 text-[13px] text-ink-3">
          Aucun employeur actif :{" "}
          <Link
            href={`/${firmSlug}/ipm/employeurs`}
            className="text-brand hover:underline"
          >
            affiliez d&apos;abord une société
          </Link>
          .
        </p>
      ) : null}
    </>
  )
}
