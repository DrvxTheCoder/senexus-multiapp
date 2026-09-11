"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon, RefreshIcon } from "@hugeicons/core-free-icons"

import { useAction } from "@/components/forms/use-action"
import { Panel } from "@/components/panel"
import { EmptyState, TwoFacts } from "@/components/primitives"
import { formatCurrency, formatNumber } from "@/lib/format"
import { closeMonth, openLedger, recomputeBalances } from "@/server/actions/ipm-ledger"
import type { ContributionSummary } from "@/server/queries/ipm/ledger"

type UnopenedMember = {
  id: string
  matricule: string
  name: string
  employerName: string
  monthlyContribution: number | null
}

const MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
]

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
  const router = useRouter()
  const now = new Date()
  const [year, setYear] = React.useState(now.getFullYear())
  const [month, setMonth] = React.useState(now.getMonth() + 1)
  const [opening, setOpening] = React.useState<Record<string, string>>({})

  const close = useAction(closeMonth, {
    success: (data: { posted: number; invoiced: number; skipped: number }) =>
      `${data.posted} cotisations portées, ${data.invoiced} factures émises${data.skipped ? `, ${data.skipped} période(s) déjà close` : ""}.`,
    onSuccess: () => router.refresh(),
  })
  const recompute = useAction(recomputeBalances, {
    success: (data: { corrected: number; runningBalances: number }) =>
      data.corrected === 0 && data.runningBalances === 0
        ? "Tous les soldes étaient déjà exacts."
        : `${data.corrected} solde(s) et ${data.runningBalances} report(s) corrigés.`,
    onSuccess: () => router.refresh(),
  })
  const open = useAction(openLedger, {
    success: "Registre ouvert.",
    onSuccess: () => router.refresh(),
  })

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
          { label: "Cotisations / mois", value: formatCurrency(summary.monthlyDue) },
          { label: "Facturé ce mois", value: formatCurrency(summary.invoicedThisMonth) },
          {
            label: "Restant dû",
            value: formatCurrency(summary.outstanding),
            tone: summary.outstanding > 0 ? "signal" : undefined,
          },
        ]}
        tools={
          canWrite ? (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={month}
                onChange={(event) => setMonth(Number(event.target.value))}
                aria-label="Mois à clôturer"
                className="h-8 rounded-control border border-line bg-surface px-2 text-[13px]"
              >
                {MONTHS.map((label, index) => (
                  <option key={label} value={index + 1}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                value={year}
                onChange={(event) => setYear(Number(event.target.value))}
                aria-label="Exercice à clôturer"
                className="h-8 w-20 rounded-control border border-line bg-surface px-2 text-[13px] tabular-nums"
              />
              <button
                type="button"
                disabled={close.pending}
                onClick={() => void close.run({ firmSlug, year, month })}
                className="h-8 rounded-control bg-brand px-2.5 text-[13px] font-medium text-on-brand hover:opacity-90 disabled:opacity-50"
              >
                Clôturer le mois
              </button>
              <button
                type="button"
                disabled={recompute.pending}
                onClick={() => void recompute.run({ firmSlug })}
                className="flex h-8 items-center gap-1.5 rounded-control border border-line px-2.5 text-[13px] hover:bg-sub disabled:opacity-50"
              >
                <HugeiconsIcon icon={RefreshIcon} size={13} aria-hidden />
                Recalculer les soldes
              </button>
            </div>
          ) : null
        }
        footer={{
          summary:
            "La clôture est idempotente : un participant déjà crédité pour la période est ignoré, et une facture existante n'est pas réémise.",
        }}
      >
        {summary.incoherentLedgers > 0 ? (
          <div className="flex items-start gap-2 rounded-control bg-alert/10 px-3 py-2 text-[13px] text-alert">
            <HugeiconsIcon icon={Alert02Icon} size={15} aria-hidden />
            <span>
              {formatNumber(summary.incoherentLedgers)} registre
              {summary.incoherentLedgers > 1 ? "s" : ""} dont le solde en cache
              ne correspond plus aux écritures. Recalculez les soldes.
            </span>
          </div>
        ) : (
          <p className="text-[13px] text-ink-3">
            Tous les soldes en cache correspondent à la somme des écritures.
          </p>
        )}
      </Panel>

      <Panel
        titleAs="h2"
        title="Registres non ouverts"
        description="Sans solde d'ouverture, le solde affiché n'est pas le solde réel du participant — il part de zéro à la bascule."
        padded={false}
        footer={{
          summary:
            "Le montant d'ouverture est saisi, jamais calculé : il vient de la reprise de l'historique ou d'un arrêté validé par la direction.",
        }}
      >
        {unopened.length === 0 ? (
          <EmptyState
            title="Tous les registres sont ouverts"
            description="Chaque participant a un solde d'ouverture daté."
          />
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-y border-line bg-sub text-left text-[11.5px] text-ink-3">
                <th className="px-[15px] py-2 font-medium">Participant</th>
                <th className="px-[15px] py-2 font-medium">Employeur</th>
                <th className="px-[15px] py-2 font-medium">Cotisation</th>
                {canWrite ? (
                  <th className="px-[15px] py-2 font-medium">Solde d&apos;ouverture</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {unopened.slice(0, 50).map((member) => (
                <tr key={member.id} className="border-b border-line">
                  <td className="px-[15px] py-2.5">
                    <Link
                      href={`/${firmSlug}/ipm/participants/${member.id}`}
                      className="hover:text-brand"
                    >
                      <TwoFacts
                        primary={member.name}
                        secondary={member.matricule}
                      />
                    </Link>
                  </td>
                  <td className="px-[15px] py-2.5 text-ink-3">
                    {member.employerName}
                  </td>
                  <td className="px-[15px] py-2.5 tabular-nums text-ink-3">
                    {member.monthlyContribution === null
                      ? "—"
                      : formatCurrency(member.monthlyContribution)}
                  </td>
                  {canWrite ? (
                    <td className="px-[15px] py-2.5">
                      <div className="flex items-center gap-1.5">
                        <input
                          value={opening[member.id] ?? ""}
                          onChange={(event) =>
                            setOpening((state) => ({
                              ...state,
                              [member.id]: event.target.value,
                            }))
                          }
                          placeholder="0"
                          aria-label={`Solde d'ouverture de ${member.name}`}
                          className="h-7 w-28 rounded-control border border-line bg-surface px-2 text-[12.5px] tabular-nums"
                        />
                        <button
                          type="button"
                          disabled={open.pending || !opening[member.id]?.trim()}
                          onClick={() =>
                            void open.run({
                              firmSlug,
                              memberId: member.id,
                              amount: Number(opening[member.id]),
                              asOf: new Date().toISOString().slice(0, 10),
                            })
                          }
                          className="rounded-control border border-line px-2 py-1 text-[12.5px] hover:bg-sub disabled:opacity-40"
                        >
                          Ouvrir
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {unopened.length > 50 ? (
        <p className="text-[12.5px] text-ink-3">
          50 premiers affichés sur {formatNumber(unopened.length)}.
        </p>
      ) : null}
    </div>
  )
}
