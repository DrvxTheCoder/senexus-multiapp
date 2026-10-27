import type { Metadata } from "next"
import type { ReactNode } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"

import {
  StatementPager,
  StatementSearch,
} from "@/app/[firmSlug]/ipm/employeurs/[employerId]/releve/statement-controls"
import { StatementPeriod } from "@/app/[firmSlug]/ipm/employeurs/[employerId]/releve/statement-period"
import { Panel, StatTiles } from "@/components/panel"
import { EmptyState, StatusPill, TwoFacts } from "@/components/primitives"
import { TopBar } from "@/components/shell/top-bar"
import { formatCurrency, formatNumber } from "@/lib/format"
import { requireFirmPage } from "@/server/auth/firm-page"
import { employerStatement } from "@/server/queries/ipm/ledger"

export const metadata: Metadata = { title: "Relevé employeur" }

const PAGE_SIZES = [15, 25, 50] as const
const DEFAULT_PAGE_SIZE = 25

const MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
]

/**
 * Relevé par employeur — plan §4.8quater.
 *
 * The document the plan says is missing today and that justifies keeping the
 * register at all: cotisations against consommation, per participant, with the
 * ratio and the participants past the debt ceiling called out.
 *
 * Laid out as a running statement — solde initial, plus cotisations, minus
 * consommation, equals solde final — so every line can be checked by eye. An
 * earlier version put a cumulative, unbounded balance next to period-only
 * columns, and nobody could tell why a participant who consumed more than they
 * paid still showed a credit.
 *
 * Computed on demand rather than stored. A stored report is a second copy of
 * the truth that starts drifting the moment an adjustment is posted — and the
 * register is designed so adjustments are the normal way to correct anything.
 *
 * Where a register was never opened, the line says so. A balance that starts
 * from zero because nobody supplied an opening figure is not that
 * participant's balance, and presenting it without the caveat is how a
 * statement becomes confidently wrong (§9, §11 Q11).
 */
export default async function StatementPage({
  params,
  searchParams,
}: PageProps<"/[firmSlug]/ipm/employeurs/[employerId]/releve">) {
  const { firmSlug, employerId } = await params
  const ctx = await requireFirmPage(firmSlug, { module: "ipm" })
  const raw = await searchParams

  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value

  const now = new Date()
  const toYear = Number(first(raw.toYear) ?? now.getFullYear())
  const toMonth = Number(first(raw.toMonth) ?? now.getMonth() + 1)
  const fromYear = Number(first(raw.fromYear) ?? toYear)
  const fromMonth = Number(first(raw.fromMonth) ?? 1)
  const search = first(raw.q)?.trim() ?? ""
  const requestedSize = Number(first(raw.per))
  const perPage = PAGE_SIZES.find((size) => size === requestedSize) ?? DEFAULT_PAGE_SIZE

  const statement = await employerStatement(
    ctx,
    employerId,
    { fromYear, fromMonth, toYear, toMonth },
    { page: Number(first(raw.page)) || 1, perPage, search }
  )
  if (!statement) notFound()

  const startLabel = `01/${pad(statement.from.month)}/${statement.from.year}`
  // Day 0 of the next month is the last day of this one.
  const lastDay = new Date(statement.to.year, statement.to.month, 0).getDate()
  const endLabel = `${lastDay}/${pad(statement.to.month)}/${statement.to.year}`
  const { totals } = statement
  // The column exists only when there is something in it; the line still
  // reconciles without it because every figure in it is then zero.
  const showAdjustments =
    totals.adjustments !== 0 ||
    statement.lines.some((line) => line.adjustments !== 0)
  const firstShown = statement.matching === 0
    ? 0
    : (statement.page - 1) * statement.perPage + 1
  const lastShown = Math.min(statement.page * statement.perPage, statement.matching)

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/ipm`}
        crumbs={[
          { label: ctx.firm.name, href: `/${firmSlug}/ipm` },
          { label: "IPM", href: `/${firmSlug}/ipm` },
          { label: "Employeurs", href: `/${firmSlug}/ipm/employeurs` },
          { label: statement.employerName },
        ]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="p-4.5">
          <div className="mb-3.5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
                Relevé — {statement.employerName}
              </h1>
              <p className="mt-px text-[13px] text-ink-3">
                De {MONTHS[statement.from.month - 1]} {statement.from.year} à{" "}
                {MONTHS[statement.to.month - 1]} {statement.to.year} ·{" "}
                {formatNumber(totals.members)} participant
                {totals.members > 1 ? "s" : ""}
              </p>
            </div>
            <StatementPeriod
              from={statement.from}
              to={statement.to}
              basePath={`/${firmSlug}/ipm/employeurs/${employerId}/releve`}
            />
          </div>

          <StatTiles
            className="mb-3.5"
            stats={[
              {
                label: `Solde au ${startLabel}`,
                value: signed(totals.startBalance),
                hint: "reporté des périodes précédentes",
                tone: totals.startBalance < 0 ? "alert" : "default",
              },
              {
                label: "+ Cotisations",
                value: formatCurrency(totals.contributions),
                hint:
                  totals.ratio === null
                    ? "aucune consommation sur la période"
                    : `couvrent ${formatNumber(Math.round(totals.ratio * 100))} % de la consommation`,
              },
              {
                label: "− Consommation",
                value: formatCurrency(totals.consumption),
                hint: "bons et remboursements, corrections déduites",
                // More consumed than paid in is the number the direction is
                // asking for.
                tone:
                  totals.ratio !== null && totals.ratio < 1 ? "alert" : "default",
              },
              {
                label: `= Solde au ${endLabel}`,
                value: signed(totals.endBalance),
                hint:
                  totals.adjustments !== 0
                    ? `ajustements inclus : ${signed(totals.adjustments)}`
                    : "fin de la période",
                tone: totals.endBalance < 0 ? "alert" : "ok",
              },
            ]}
          />

          <Panel
            title="Détail par participant"
            // description={`Chaque ligne se lit de gauche à droite : solde initial + cotisations − consommation${showAdjustments ? " ± ajustements" : ""} = solde final.`}
            padded={false}
            footer={{
              summary: (
                <span className="tabular-nums">
                  {statement.matching === 0
                    ? "Aucun participant"
                    : `${formatNumber(firstShown)} – ${formatNumber(lastShown)} sur ${formatNumber(statement.matching)} participant${statement.matching > 1 ? "s" : ""}`}
                  {search ? ` · recherche « ${search} »` : null}
                </span>
              ),
              action: (
                <StatementPager
                  page={statement.page}
                  pageCount={statement.pageCount}
                  perPage={statement.perPage}
                  sizes={PAGE_SIZES}
                />
              ),
            }}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-3.75 py-2.5 text-[12px]">
              <StatementSearch value={search} />
              {/* Counted over every participant, not the page: on a relevé of
                  thousands, a flag that only shows on page 37 is not a flag. */}
              {statement.overCeilingCount > 0 ? (
                <span className="text-alert">
                  {formatNumber(statement.overCeilingCount)} au-delà du seuil
                  d&apos;endettement
                </span>
              ) : null}
              {statement.unopenedCount > 0 ? (
                <span className="text-alert">
                  {formatNumber(statement.unopenedCount)} registre
                  {statement.unopenedCount > 1 ? "s" : ""} sans solde
                  d&apos;ouverture : le solde part de zéro et n&apos;est pas le
                  solde réel.
                </span>
              ) : null}
            </div>

            {statement.lines.length === 0 ? (
              search ? (
                <EmptyState
                  title="Aucun résultat"
                  description={`Aucun participant ne correspond à « ${search} ».`}
                />
              ) : (
                <EmptyState
                  title="Aucun participant"
                  description="Cet employeur n&apos;a pas encore de participant affilié."
                />
              )
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-[13px]">
                  <thead>
                    <tr className="border-y border-line bg-sub text-left text-[11.5px] text-ink-3">
                      <th className="px-[15px] py-2 font-medium">Matricule</th>
                      <th className="px-[15px] py-2 font-medium">Participant</th>
                      <th className="px-[15px] py-2 text-right font-medium">
                        Ayants droit
                      </th>
                      <MoneyHead label="Solde initial" hint={`au ${startLabel}`} />
                      <MoneyHead label="+ Cotisations" hint="sur la période" />
                      <MoneyHead label="− Consommation" hint="sur la période" />
                      {showAdjustments ? (
                        <MoneyHead label="± Ajustements" hint="sur la période" />
                      ) : null}
                      <MoneyHead
                        label="= Solde final"
                        hint={`au ${endLabel}`}
                        emphasis
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {statement.lines.map((line) => (
                      <tr key={line.memberId} className="border-b border-line">
                        <td className="px-[15px] py-2.5 tabular-nums">
                          {line.matricule}
                        </td>
                        <td className="px-[15px] py-2.5">
                          <Link
                            href={`/${firmSlug}/ipm/participants/${line.memberId}`}
                            className="hover:text-brand"
                          >
                            <TwoFacts
                              primary={line.memberName}
                              secondary={
                                line.unopened ? "registre non ouvert" : undefined
                              }
                            />
                          </Link>
                        </td>
                        <td className="px-[15px] py-2.5 text-right tabular-nums text-ink-3">
                          {line.dependentCount || "—"}
                        </td>
                        <MoneyCell muted>{signed(line.startBalance)}</MoneyCell>
                        <MoneyCell muted={line.contributions === 0}>
                          {formatCurrency(line.contributions)}
                        </MoneyCell>
                        <MoneyCell muted={line.consumption === 0}>
                          {formatCurrency(line.consumption)}
                        </MoneyCell>
                        {showAdjustments ? (
                          <MoneyCell muted>
                            {line.adjustments ? signed(line.adjustments) : "—"}
                          </MoneyCell>
                        ) : null}
                        <td className="border-l border-line px-[15px] py-2.5 text-right">
                          <span
                            className={`font-medium tabular-nums ${line.endBalance < 0 ? "text-alert" : ""}`}
                          >
                            {signed(line.endBalance)}
                          </span>
                          {line.overDebtCeiling ? (
                            <div className="mt-1">
                              {/* An alert, never a block: the plan is explicit
                                  that the decision stays human. */}
                              <StatusPill tone="alert">Seuil dépassé</StatusPill>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-sub font-medium">
                      <td className="px-[15px] py-2.5" colSpan={3}>
                        Total · {formatNumber(totals.members)} participant
                        {totals.members > 1 ? "s" : ""}
                        {statement.pageCount > 1 || search ? (
                          <div className="text-[11px] font-normal text-ink-3">
                            tous les participants, pas seulement cette page
                          </div>
                        ) : null}
                      </td>
                      <MoneyCell>{signed(totals.startBalance)}</MoneyCell>
                      <MoneyCell>{formatCurrency(totals.contributions)}</MoneyCell>
                      <MoneyCell>{formatCurrency(totals.consumption)}</MoneyCell>
                      {showAdjustments ? (
                        <MoneyCell>{signed(totals.adjustments)}</MoneyCell>
                      ) : null}
                      <td
                        className={`border-l border-line px-[15px] py-2.5 text-right tabular-nums ${totals.endBalance < 0 ? "text-alert" : ""}`}
                      >
                        {signed(totals.endBalance)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  )
}

function pad(value: number) {
  return String(value).padStart(2, "0")
}

/** A balance, with its sign spelled out: a credit and a debt look alike otherwise. */
function signed(value: number) {
  return `${value > 0 ? "+" : ""}${formatCurrency(value)}`
}

function MoneyHead({
  label,
  hint,
  emphasis,
}: {
  label: string
  hint: string
  emphasis?: boolean
}) {
  return (
    <th
      className={`px-[15px] py-2 text-right font-medium ${emphasis ? "border-l border-line text-ink" : ""}`}
    >
      <div>{label}</div>
      <div className="text-[10.5px] font-normal">{hint}</div>
    </th>
  )
}

function MoneyCell({
  muted,
  children,
}: {
  muted?: boolean
  children: ReactNode
}) {
  return (
    <td
      className={`px-[15px] py-2.5 text-right tabular-nums ${muted ? "text-ink-3" : ""}`}
    >
      {children}
    </td>
  )
}
