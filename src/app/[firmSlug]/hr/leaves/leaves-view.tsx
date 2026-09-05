"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useQueryStates } from "nuqs"
import type { ColumnDef } from "@tanstack/react-table"
import { format, parse } from "date-fns"
import { fr } from "date-fns/locale"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowRight01Icon,
  Calendar03Icon,
  PlusSignIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons"

import {
  ApproveLeaveButton,
  RejectLeaveDialog,
  RequestLeaveDialog,
  RolloverDialog,
} from "@/app/[firmSlug]/hr/leaves/leave-dialogs"
import { DataTable } from "@/components/data-table"
import { FacetFilter } from "@/components/filters/facet-filter"
import { Pager } from "@/components/list-controls"
import { Panel } from "@/components/panel"
import {
  Avatar,
  EmptyState,
  SegmentedControl,
  StatusPill,
  TwoFacts,
} from "@/components/primitives"
import { formatDate, formatDays, formatNumber, initials } from "@/lib/format"
import { leaveSearchParams, shiftMonth } from "@/lib/queries/leave-params"
import type { LeaveRow, LeaveSummary } from "@/server/queries/leaves"
import type { Paged } from "@/server/queries/types"
import { cn } from "@/lib/utils"

const TYPE_LABELS: Record<string, string> = {
  ANNUAL: "Congé annuel",
  SICK: "Congé maladie",
  MATERNITY: "Congé maternité",
  PATERNITY: "Congé paternité",
  UNPAID: "Congé sans solde",
  SPECIAL: "Congé spécial",
  COMPENSATORY: "Récupération",
}

const STATUS: Record<string, { label: string; tone: "ok" | "signal" | "alert" | "muted" }> = {
  APPROVED: { label: "Approuvé", tone: "ok" },
  PENDING: { label: "En attente", tone: "signal" },
  REJECTED: { label: "Refusé", tone: "alert" },
  CANCELLED: { label: "Annulé", tone: "muted" },
}

/**
 * §5.6 — leaves, as a list and as a month calendar.
 *
 * Both views run the same resolver over the same URL query, so they cannot show
 * different sets. The view itself is a URL parameter, so a colleague opening a
 * shared link lands on the same view with the same filters.
 */
export function LeavesView({
  firmSlug,
  page,
  summary,
  calendar,
  month,
  employees,
  canWrite,
  canApprove,
  scoped,
}: {
  firmSlug: string
  page: Paged<LeaveRow>
  summary: LeaveSummary
  calendar: LeaveRow[]
  month: string
  employees: { id: string; name: string; matricule: string }[]
  /** STAFF and above may raise a request. */
  canWrite: boolean
  /** MANAGER and above may decide one. */
  canApprove: boolean
  scoped: boolean
}) {
  const router = useRouter()
  const [dialog, setDialog] = React.useState<
    | { kind: "request" }
    | { kind: "rollover" }
    | { kind: "reject"; request: { id: string; employeeName: string } }
    | null
  >(null)
  const [params, setParams] = useQueryStates(leaveSearchParams, {
    shallow: false,
    history: "push",
  })

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

  const columns = React.useMemo<ColumnDef<LeaveRow, unknown>[]>(
    () => [
      {
        id: "employee",
        header: "Employé",
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <Avatar
              initials={initials(row.original.employee.firstName, row.original.employee.lastName)}
            />
            <TwoFacts
              primary={
                <span className="font-medium">
                  {row.original.employee.firstName} {row.original.employee.lastName}
                </span>
              }
              secondary={
                <>
                  <span className="mono">{row.original.employee.matricule}</span>
                  {row.original.employee.clientName
                    ? ` · ${row.original.employee.clientName}`
                    : null}
                </>
              }
            />
          </div>
        ),
      },
      {
        id: "type",
        header: "Type",
        cell: ({ row }) => (
          <TwoFacts
            primary={TYPE_LABELS[row.original.leaveType] ?? row.original.leaveType}
            secondary={row.original.isPaid ? "payé" : "sans solde"}
          />
        ),
      },
      {
        id: "period",
        header: "Période",
        cell: ({ row }) => (
          <span className="mono text-xs whitespace-nowrap text-ink-2">
            {formatDate(row.original.startDate)} → {formatDate(row.original.endDate)}
          </span>
        ),
      },
      {
        id: "days",
        header: "Durée",
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="num">{formatDays(row.original.totalDays)}</span>
        ),
      },
      {
        id: "waiting",
        header: "Attente",
        meta: { align: "right" },
        cell: ({ row }) =>
          row.original.waitingDays === null ? (
            <span className="text-ink-3">—</span>
          ) : (
            <span
              className={cn(
                "num",
                row.original.waitingDays > 7 && "font-medium text-signal"
              )}
            >
              {formatDays(row.original.waitingDays)}
            </span>
          ),
      },
      {
        id: "status",
        header: "Statut",
        cell: ({ row }) => (
          <StatusPill dot tone={STATUS[row.original.status]?.tone ?? "muted"}>
            {STATUS[row.original.status]?.label ?? row.original.status}
          </StatusPill>
        ),
      },
      ...(canApprove
        ? [
            {
              id: "decide",
              header: "",
              meta: { align: "right" as const },
              cell: ({ row }: { row: { original: LeaveRow } }) => {
                if (row.original.status !== "PENDING") return null
                const name = `${row.original.employee.firstName} ${row.original.employee.lastName}`
                return (
                  <div className="flex items-center justify-end gap-1.5">
                    <ApproveLeaveButton
                      firmSlug={firmSlug}
                      id={row.original.id}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setDialog({
                          kind: "reject",
                          request: { id: row.original.id, employeeName: name },
                        })
                      }
                      className="h-7 rounded-[7px] border border-line bg-surface px-2.5 text-[12px] hover:bg-sub"
                    >
                      Refuser
                    </button>
                  </div>
                )
              },
            },
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canApprove, firmSlug]
  )

  const from = page.total === 0 ? 0 : (page.page - 1) * page.perPage + 1
  const to = Math.min(page.page * page.perPage, page.total)
  const isCalendar = params.view === "calendrier"

  return (
    <Panel
      title="Demandes de congé"
      description={
        isCalendar
          ? "Chevauchements et charge de l'équipe sur le mois."
          : "Les demandes en attente remontent en premier, les plus anciennes d'abord."
      }
      stats={[
        { label: "Demandes", value: formatNumber(summary.matching) },
        {
          label: "En attente",
          value: formatNumber(summary.pending),
          tone: summary.pending > 0 ? "signal" : "default",
        },
        { label: "Jours ce mois", value: formatNumber(summary.daysThisMonth) },
      ]}
      tools={
        <>
          <SegmentedControl
            ariaLabel="Affichage"
            value={params.view}
            onChange={(value) => void setParams({ view: value, page: null })}
            options={[
              { value: "liste", label: "Liste" },
              { value: "calendrier", label: "Calendrier" },
            ]}
          />
          {canApprove ? (
            <button
              type="button"
              onClick={() => setDialog({ kind: "rollover" })}
              title="Ouvrir les soldes de l'année suivante"
              className="inline-flex h-[30px] items-center gap-1.5 rounded-[7px] border border-line bg-surface px-2.5 text-[12.5px] hover:bg-sub"
            >
              <HugeiconsIcon icon={Calendar03Icon} size={13} />
              Reporter les soldes
            </button>
          ) : null}
          {canWrite ? (
            <button
              type="button"
              onClick={() => setDialog({ kind: "request" })}
              className="inline-flex h-[30px] items-center gap-1.5 rounded-[7px] bg-ink px-2.5 text-[12.5px] font-medium text-paper hover:opacity-90"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={13} />
              Nouvelle demande
            </button>
          ) : null}
        </>
      }
      padded={false}
      footer={{
        summary: isCalendar ? (
          <span className="num">
            {formatNumber(calendar.length)} congés en {monthLabel(month)}
            {scoped ? " · restreint à vos clients" : null}
          </span>
        ) : (
          <span className="num">
            {page.total === 0
              ? "Aucune demande"
              : `${formatNumber(from)} – ${formatNumber(to)} sur ${formatNumber(page.total)} demandes`}
            {summary.oldestWaitingDays > 0
              ? ` · la plus ancienne attend depuis ${formatDays(summary.oldestWaitingDays)}`
              : null}
            {scoped ? " · restreint à vos clients" : null}
          </span>
        ),
        action: isCalendar ? null : (
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
            placeholder="Nom ou matricule…"
            aria-label="Rechercher une demande"
            className="w-full border-none bg-transparent text-[12.5px] outline-none"
          />
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

        {isCalendar ? (
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              aria-label="Mois précédent"
              onClick={() => void setParams({ month: shiftMonth(month, -1) })}
              className="inline-flex h-[25px] items-center rounded-md border border-line bg-surface px-2 text-ink-2 hover:bg-sub"
            >
              <HugeiconsIcon icon={ArrowRight01Icon} size={13} className="rotate-180" />
            </button>
            <span className="min-w-[120px] text-center text-[12.5px] font-medium">
              {monthLabel(month)}
            </span>
            <button
              type="button"
              aria-label="Mois suivant"
              onClick={() => void setParams({ month: shiftMonth(month, 1) })}
              className="inline-flex h-[25px] items-center rounded-md border border-line bg-surface px-2 text-ink-2 hover:bg-sub"
            >
              <HugeiconsIcon icon={ArrowRight01Icon} size={13} />
            </button>
          </span>
        ) : null}
      </div>

      {isCalendar ? (
        <MonthCalendar
          month={month}
          leaves={calendar}
          onOpen={(employeeId) =>
            router.push(`/${firmSlug}/hr/employees/${employeeId}?tab=conges`)
          }
        />
      ) : (
        <DataTable
          data={page.rows}
          columns={columns}
          getRowId={(row) => row.id}
          sorting={[]}
          onSortingChange={() => {}}
          onRowClick={(row) =>
            router.push(`/${firmSlug}/hr/employees/${row.employee.id}?tab=conges`)
          }
          label="Demandes de congé"
          empty={
            <EmptyState
              title="Aucune demande"
              description="Aucune demande de congé ne correspond aux filtres."
            />
          }
        />
      )}

      {dialog?.kind === "request" ? (
        <RequestLeaveDialog
          firmSlug={firmSlug}
          employees={employees}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === "reject" ? (
        <RejectLeaveDialog
          firmSlug={firmSlug}
          request={dialog.request}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === "rollover" ? (
        <RolloverDialog firmSlug={firmSlug} onClose={() => setDialog(null)} />
      ) : null}
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * A month grid where each leave is a bar spanning the days it covers.
 *
 * The value of a calendar here is seeing *overlap* — who is away at the same
 * time — which a table cannot show. Weeks run Monday to Sunday, as they do in
 * France and Senegal.
 */
function MonthCalendar({
  month,
  leaves,
  onOpen,
}: {
  month: string
  leaves: LeaveRow[]
  onOpen: (employeeId: string) => void
}) {
  const first = parse(`${month}-01`, "yyyy-MM-dd", new Date())
  const daysInMonth = new Date(
    first.getFullYear(),
    first.getMonth() + 1,
    0
  ).getDate()

  // getDay() is Sunday-first; shift so Monday is column 0.
  const leadingBlanks = (first.getDay() + 6) % 7

  const cells: (Date | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from(
      { length: daysInMonth },
      (_, index) => new Date(first.getFullYear(), first.getMonth(), index + 1)
    ),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const today = new Date()
  const isToday = (date: Date) =>
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()

  function leavesOn(date: Date): LeaveRow[] {
    return leaves.filter(
      (leave) =>
        date >= startOfDay(leave.startDate) && date <= startOfDay(leave.endDate)
    )
  }

  if (leaves.length === 0) {
    return (
      <EmptyState
        title={`Aucun congé en ${monthLabel(month)}`}
        description="Changez de mois ou retirez un filtre."
      />
    )
  }

  return (
    <div className="p-[15px]">
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-line bg-line">
        {["lun", "mar", "mer", "jeu", "ven", "sam", "dim"].map((day) => (
          <div
            key={day}
            className="bg-sub px-2 py-1.5 text-center text-[11px] font-medium text-ink-3"
          >
            {day}
          </div>
        ))}

        {cells.map((date, index) => {
          if (!date) {
            return <div key={`blank-${index}`} className="min-h-[86px] bg-sub/40" />
          }

          const dayLeaves = leavesOn(date)
          const weekend = [0, 6].includes(date.getDay())

          return (
            <div
              key={date.toISOString()}
              className={cn(
                "min-h-[86px] bg-surface p-1.5",
                weekend && "bg-sub/60"
              )}
            >
              <div
                className={cn(
                  "num mb-1 text-[11px]",
                  isToday(date)
                    ? "inline-grid size-[18px] place-items-center rounded-full bg-brand font-semibold text-brand-contrast"
                    : "text-ink-3"
                )}
              >
                {date.getDate()}
              </div>

              <div className="flex flex-col gap-0.5">
                {dayLeaves.slice(0, 3).map((leave) => (
                  <button
                    key={leave.id}
                    type="button"
                    onClick={() => onOpen(leave.employee.id)}
                    title={`${leave.employee.firstName} ${leave.employee.lastName} · ${TYPE_LABELS[leave.leaveType] ?? leave.leaveType}`}
                    className={cn(
                      "truncate rounded-[3px] px-1 py-px text-left text-[10.5px]",
                      leave.status === "PENDING"
                        ? "bg-signal-tint text-signal"
                        : "bg-brand-tint text-brand"
                    )}
                  >
                    {leave.employee.firstName} {leave.employee.lastName[0]}.
                  </button>
                ))}
                {dayLeaves.length > 3 ? (
                  <span className="num px-1 text-[10.5px] text-ink-3">
                    +{dayLeaves.length - 3}
                  </span>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      <p className="mt-2.5 flex items-center gap-3 text-[11.5px] text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-brand-tint" aria-hidden /> approuvé
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-signal-tint" aria-hidden /> en attente
        </span>
      </p>
    </div>
  )
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function monthLabel(month: string): string {
  return format(parse(`${month}-01`, "yyyy-MM-dd", new Date()), "MMMM yyyy", {
    locale: fr,
  })
}
