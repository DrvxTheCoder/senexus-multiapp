import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { Panel } from "@/components/panel"
import { EmptyState, StatusPill, TwoFacts } from "@/components/primitives"
import { TopBar } from "@/components/shell/top-bar"
import { formatCurrency, formatNumber } from "@/lib/format"
import { requireFirmPage } from "@/server/auth/firm-page"
import { employerStatement } from "@/server/queries/ipm/ledger"

export const metadata: Metadata = { title: "Relevé employeur" }

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

  const statement = await employerStatement(ctx, employerId, {
    fromYear,
    fromMonth,
    toYear,
    toMonth,
  })
  if (!statement) notFound()

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
          <div className="mb-3.5">
            <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
              Relevé — {statement.employerName}
            </h1>
            <p className="mt-px text-[13px] text-ink-3">
              De {MONTHS[statement.from.month - 1]} {statement.from.year} à{" "}
              {MONTHS[statement.to.month - 1]} {statement.to.year}
            </p>
          </div>

          <Panel
            title="Cotisations et consommation"
            description="Le solde est cumulatif depuis l&apos;ouverture du registre ; les cotisations et la consommation portent sur la période."
            padded={false}
            stats={[
              {
                label: "Participants",
                value: formatNumber(statement.totals.members),
              },
              {
                label: "Cotisations",
                value: formatCurrency(statement.totals.contributions),
              },
              {
                label: "Consommation",
                value: formatCurrency(statement.totals.consumption),
              },
              {
                label: "Ratio",
                value:
                  statement.totals.ratio === null
                    ? "—"
                    : String(Math.round(statement.totals.ratio * 100) / 100),
                // Below 1 means the employer's population consumes more than it
                // contributes — the number the direction is asking for.
                tone:
                  statement.totals.ratio !== null && statement.totals.ratio < 1
                    ? "alert"
                    : "ok",
              },
            ]}
            footer={
              statement.unopenedCount > 0
                ? {
                    summary: (
                      <span className="text-alert">
                        {statement.unopenedCount} registre
                        {statement.unopenedCount > 1 ? "s" : ""} sans solde
                        d&apos;ouverture : le solde affiché part de zéro et
                        n&apos;est pas le solde réel.
                      </span>
                    ),
                  }
                : undefined
            }
          >
            {statement.lines.length === 0 ? (
              <EmptyState
                title="Aucun participant"
                description="Cet employeur n&apos;a pas encore de participant affilié."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-[13px]">
                  <thead>
                    <tr className="border-y border-line bg-sub text-left text-[11.5px] text-ink-3">
                      <th className="px-[15px] py-2 font-medium">Matricule</th>
                      <th className="px-[15px] py-2 font-medium">Participant</th>
                      <th className="px-[15px] py-2 font-medium">Ayants droit</th>
                      <th className="px-[15px] py-2 font-medium">Cotisations</th>
                      <th className="px-[15px] py-2 font-medium">Consommation</th>
                      <th className="px-[15px] py-2 font-medium">Solde</th>
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
                        <td className="px-[15px] py-2.5 tabular-nums text-ink-3">
                          {line.dependentCount || "—"}
                        </td>
                        <td className="px-[15px] py-2.5 tabular-nums">
                          {formatCurrency(line.contributions)}
                        </td>
                        <td className="px-[15px] py-2.5 tabular-nums">
                          {formatCurrency(line.consumption)}
                        </td>
                        <td className="px-[15px] py-2.5">
                          <span
                            className={`tabular-nums ${line.balance < 0 ? "text-alert" : ""}`}
                          >
                            {line.balance > 0 ? "+" : ""}
                            {formatCurrency(line.balance)}
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
                        Total
                      </td>
                      <td className="px-[15px] py-2.5 tabular-nums">
                        {formatCurrency(statement.totals.contributions)}
                      </td>
                      <td className="px-[15px] py-2.5 tabular-nums">
                        {formatCurrency(statement.totals.consumption)}
                      </td>
                      <td className="px-[15px] py-2.5 tabular-nums">
                        {statement.totals.balance > 0 ? "+" : ""}
                        {formatCurrency(statement.totals.balance)}
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
