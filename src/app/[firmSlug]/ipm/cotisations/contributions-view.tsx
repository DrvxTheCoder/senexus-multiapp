"use client"

import * as React from "react"
import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  RefreshIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons"
import type { ColumnDef } from "@tanstack/react-table"

import { CloseMonthDialog } from "@/app/[firmSlug]/ipm/cotisations/close-month-dialog"
import { DataTable } from "@/components/data-table"
import { useAction } from "@/components/forms/use-action"
import { Pager } from "@/components/list-controls"
import { Panel } from "@/components/panel"
import { EmptyState, TwoFacts } from "@/components/primitives"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatCurrency, formatNumber } from "@/lib/format"
import { openLedger, recomputeBalances } from "@/server/actions/ipm-ledger"
import type { ContributionSummary } from "@/server/queries/ipm/ledger"

type UnopenedMember = {
  id: string
  matricule: string
  name: string
  employerName: string
  monthlyContribution: number | null
}

const PAGE_SIZE = 12

/**
 * Cotisations et registre.
 *
 * The screen leads with what is **not** yet true, because that is what decides
 * whether any balance on it can be trusted. §9 is explicit: a register opened
 * without a solde initial makes every balance computed after the switchover
 * wrong. So participants without an OPENING entry are counted at the top and
 * listed below, rather than being shown with a confident figure that happens
 * to start from zero.
 *
 * The opening figure itself is typed in by a person. §11 Q11 — whether it
 * comes from replaying the WebLamps history or from a cut-off validated by the
 * direction — is still unanswered, and nothing here guesses it.
 */
export function ContributionsView({
  firmSlug,
  summary,
  unopened,
  canWrite,
}: {
  firmSlug: string
  summary: ContributionSummary
  unopened: UnopenedMember[]
  canWrite: boolean
}) {
  const [closing, setClosing] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [opening, setOpening] = React.useState<Record<string, string>>({})

  const recompute = useAction(recomputeBalances, {
    loading: "Recalcul des soldes…",
    success: (data: { corrected: number; runningBalances: number }) =>
      data.corrected === 0 && data.runningBalances === 0
        ? "Tous les soldes étaient déjà exacts."
        : `${formatNumber(data.corrected)} solde(s) et ${formatNumber(data.runningBalances)} report(s) corrigés.`,
  })
  const open = useAction(openLedger, {
    success: "Registre ouvert.",
    onSuccess: () => setOpening({}),
  })

  const needle = search.trim().toLowerCase()
  const filtered = React.useMemo(
    () =>
      needle === ""
        ? unopened
        : unopened.filter(
            (member) =>
              member.name.toLowerCase().includes(needle) ||
              member.matricule.toLowerCase().includes(needle) ||
              member.employerName.toLowerCase().includes(needle)
          ),
    [unopened, needle]
  )

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, pageCount)
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)

  const columns = React.useMemo<ColumnDef<UnopenedMember, unknown>[]>(
    () => [
      {
        id: "member",
        header: "Participant",
        cell: ({ row }) => (
          <Link
            href={`/${firmSlug}/ipm/participants/${row.original.id}`}
            className="hover:text-brand"
          >
            <TwoFacts
              primary={row.original.name}
              secondary={row.original.matricule}
            />
          </Link>
        ),
      },
      {
        id: "employer",
        header: "Employeur",
        cell: ({ row }) => (
          <span className="text-ink-3">{row.original.employerName}</span>
        ),
      },
      {
        id: "contribution",
        header: "Cotisation mensuelle",
        cell: ({ row }) =>
          row.original.monthlyContribution === null ? (
            <span className="text-ink-3">—</span>
          ) : (
            <span className="num text-ink-3">
              {formatCurrency(row.original.monthlyContribution)}
            </span>
          ),
      },
      ...(canWrite
        ? [
            {
              id: "opening",
              header: "Solde d'ouverture",
              cell: ({ row }) => {
                const draft = opening[row.original.id] ?? ""
                const amount = Number(draft)
                const valid = draft.trim() !== "" && Number.isFinite(amount)
                return (
                  <div className="flex items-center justify-end gap-1.5">
                    <Input
                      value={draft}
                      inputMode="numeric"
                      onChange={(event) =>
                        setOpening((state) => ({
                          ...state,
                          [row.original.id]: event.target.value,
                        }))
                      }
                      placeholder="0"
                      aria-label={`Solde d'ouverture de ${row.original.name}`}
                      className="h-7 w-28 text-[12.5px] tabular-nums"
                    />
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={open.pending || !valid}
                      onClick={() =>
                        void open.run({
                          firmSlug,
                          memberId: row.original.id,
                          amount,
                          asOf: new Date().toISOString().slice(0, 10),
                        })
                      }
                    >
                      Ouvrir
                    </Button>
                  </div>
                )
              },
            } satisfies ColumnDef<UnopenedMember, unknown>,
          ]
        : []),
    ],
    [canWrite, firmSlug, opening, open]
  )

  return (
    <div className="space-y-3.5">
      <Panel
        title="Registre participant"
        description="Les cotisations créditent, les prises en charge débitent. Un solde positif signifie que le participant a cotisé plus qu'il n'a consommé."
        stats={[
          {
            label: "Registres non ouverts",
            value: formatNumber(summary.membersWithoutOpening),
            tone: summary.membersWithoutOpening > 0 ? "alert" : "ok",
          },
          {
            label: "Cotisations / mois",
            value: formatCurrency(summary.monthlyDue),
          },
          {
            label: "Facturé ce mois",
            value: formatCurrency(summary.invoicedThisMonth),
          },
          {
            label: "Restant dû",
            value: formatCurrency(summary.outstanding),
            tone: summary.outstanding > 0 ? "signal" : undefined,
          },
        ]}
        tools={
          canWrite ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={recompute.pending}
                onClick={() => void recompute.run({ firmSlug })}
              >
                <HugeiconsIcon icon={RefreshIcon} size={13} aria-hidden />
                Recalculer les soldes
              </Button>
              <Button size="sm" onClick={() => setClosing(true)}>
                Clôturer une période
              </Button>
            </>
          ) : null
        }
      >
        {summary.incoherentLedgers > 0 ? (
          <div className="flex items-start gap-2 rounded-[7px] bg-alert-tint px-3 py-2 text-[13px] text-alert">
            <HugeiconsIcon
              icon={Alert02Icon}
              size={15}
              aria-hidden
              className="mt-px shrink-0"
            />
            <span>
              {formatNumber(summary.incoherentLedgers)} registre
              {summary.incoherentLedgers > 1 ? "s" : ""} dont le solde en cache
              ne correspond plus aux écritures. Recalculez les soldes.
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[13px] text-ink-3">
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              size={15}
              aria-hidden
              className="shrink-0 text-ok"
            />
            Tous les soldes en cache correspondent à la somme des écritures.
          </div>
        )}
      </Panel>

      <Panel
        titleAs="h2"
        title="Registres non ouverts"
        description="Sans solde d'ouverture, le solde affiché n'est pas le solde réel du participant — il part de zéro à la bascule."
        padded={false}
        footer={{
          summary: (
            <span>
              Le montant d&apos;ouverture est saisi, jamais calculé : il vient
              de la reprise de l&apos;historique ou d&apos;un arrêté validé par
              la direction.
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
              placeholder="Nom, matricule, employeur"
              aria-label="Rechercher un participant"
              className="w-full border-none bg-transparent text-[12.5px] outline-none placeholder:text-ink-3"
            />
          </div>
          <span className="ml-auto text-[12px] text-ink-3">
            {formatNumber(filtered.length)} participant
            {filtered.length > 1 ? "s" : ""}
            {unopened.length >= 200
              ? " — 200 premiers chargés"
              : ""}
          </span>
        </div>

        <DataTable
          data={rows}
          columns={columns}
          getRowId={(row) => row.id}
          sorting={[]}
          onSortingChange={() => {}}
          label="Registres non ouverts"
          empty={
            unopened.length === 0 ? (
              <EmptyState
                title="Tous les registres sont ouverts"
                description="Chaque participant a un solde d'ouverture daté."
              />
            ) : (
              <EmptyState
                title="Aucun participant ne correspond"
                description="Essayez un autre nom, matricule ou employeur."
              />
            )
          }
        />
      </Panel>

      {closing ? (
        <CloseMonthDialog
          firmSlug={firmSlug}
          activeMembers={summary.totalMembers}
          monthlyDue={summary.monthlyDue}
          onClose={() => setClosing(false)}
        />
      ) : null}
    </div>
  )
}
