import type { Metadata } from "next"
import Link from "next/link"

import { Panel } from "@/components/panel"
import { EmptyState, StatusPill } from "@/components/primitives"
import { TopBar } from "@/components/shell/top-bar"
import { formatCurrency, formatNumber } from "@/lib/format"
import { requireFirmPage } from "@/server/auth/firm-page"
import { ratioTone } from "@/server/domain/ipm/alerts"
import { ipmDashboard } from "@/server/queries/ipm/dashboard"

export const metadata: Metadata = { title: "Pilotage" }

const MONTHS = [
  "janv.", "févr.", "mars", "avr.", "mai", "juin",
  "juil.", "août", "sept.", "oct.", "nov.", "déc.",
]

const SEVERITY_TONE = {
  CRITICAL: "alert",
  WARNING: "signal",
  INFO: "muted",
} as const

/**
 * Pilotage — plan §5 (phase 5).
 *
 * The screen answers the one question the direction has never been able to
 * ask: **which employers consume more than they contribute**. §4.8quater says
 * the relevé is the document that justifies keeping the register; this is the
 * portfolio view of the same number.
 *
 * Two deliberate refusals:
 *
 *   - an employer with no claims shows **no ratio**, not a zero and not an
 *     infinity. Either number would rank them as the best or the worst in the
 *     portfolio when the truth is that there is nothing to judge yet;
 *   - when any register lacks an opening balance, the page says so at the top
 *     rather than presenting totals that quietly start from zero. §9 is
 *     explicit that those totals are wrong, and a dashboard that hides it is
 *     worse than one that does not exist.
 */
export default async function PilotagePage({
  params,
}: PageProps<"/[firmSlug]/ipm/pilotage">) {
  const { firmSlug } = await params
  const ctx = await requireFirmPage(firmSlug, { module: "ipm" })

  const dashboard = await ipmDashboard(ctx, firmSlug)
  const peak = Math.max(
    1,
    ...dashboard.monthly.map((point) =>
      Math.max(point.contributions, point.consumption)
    )
  )

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/ipm`}
        crumbs={[
          { label: ctx.firm.name, href: `/${firmSlug}/ipm` },
          { label: "IPM", href: `/${firmSlug}/ipm` },
          { label: "Pilotage" },
        ]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="p-4.5">
          <div className="mb-3.5 flex items-center gap-3">
            <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
              Pilotage
            </h1>
          </div>

          <div className="space-y-3.5">
            <Panel
              titleAs="h2"
              title="Institution"
              description={
                dashboard.incompleteData
                  ? "Certains registres n'ont pas de solde d'ouverture : les totaux ci-dessous sont partiels."
                  : "Cotisations engagées, consommation portée au registre."
              }
              stats={[
                {
                  label: "Participants actifs",
                  value: formatNumber(dashboard.headline.activeMembers),
                },
                {
                  label: "Ayants droit",
                  value: formatNumber(dashboard.headline.dependents),
                },
                {
                  label: "Cotisations / mois",
                  value: formatCurrency(dashboard.headline.monthlyContributions),
                },
                {
                  label: "Engagé non réglé",
                  value: formatCurrency(
                    dashboard.headline.outstandingCommitment
                  ),
                },
                {
                  label: "Ratio cotisations / consommation",
                  value:
                    dashboard.headline.ratio === null
                      ? "—"
                      : String(Math.round(dashboard.headline.ratio * 100) / 100),
                  tone: ratioTone(dashboard.headline.ratio),
                },
              ]}
            >
              {dashboard.incompleteData ? (
                <p className="max-w-prose text-[13px] text-alert">
                  Un registre sans solde d&apos;ouverture part de zéro à la
                  bascule. Tant que ces soldes ne sont pas saisis, le ratio et
                  les soldes par employeur sous-estiment la réalité.
                </p>
              ) : null}
            </Panel>

            {/* ---- alertes ------------------------------------------------ */}
            <Panel
              titleAs="h2"
              title="Alertes"
              description="Le franchissement d'un seuil alerte ; il ne bloque jamais automatiquement."
              padded={false}
            >
              {dashboard.alerts.length === 0 ? (
                <EmptyState
                  title="Aucune alerte"
                  description="Aucun seuil franchi, aucune facture échue, aucun registre incohérent."
                />
              ) : (
                <table className="w-full text-[13px]">
                  <tbody>
                    {dashboard.alerts.map((alert) => (
                      <tr key={alert.kind} className="border-b border-line">
                        <td className="px-[15px] py-2.5">
                          <div className="flex items-center gap-2">
                            <StatusPill tone={SEVERITY_TONE[alert.severity]}>
                              {alert.severity === "CRITICAL"
                                ? "Critique"
                                : alert.severity === "WARNING"
                                  ? "Vigilance"
                                  : "Information"}
                            </StatusPill>
                            {alert.href ? (
                              <Link
                                href={alert.href}
                                className="font-medium hover:text-brand hover:underline"
                              >
                                {alert.title}
                              </Link>
                            ) : (
                              <span className="font-medium">{alert.title}</span>
                            )}
                          </div>
                          <p className="mt-1 max-w-prose text-[12.5px] text-ink-3">
                            {alert.detail}
                          </p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            {/* ---- par employeur ------------------------------------------ */}
            <Panel
              titleAs="h2"
              title="Par employeur"
              description="Le chiffre que la direction n'a jamais eu : qui consomme plus qu'il ne cotise."
              padded={false}
            >
              {dashboard.employers.length === 0 ? (
                <EmptyState title="Aucun employeur affilié" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-[13px]">
                    <thead>
                      <tr className="border-y border-line bg-sub text-left text-[11.5px] text-ink-3">
                        <th className="px-[15px] py-2 font-medium">Employeur</th>
                        <th className="px-[15px] py-2 font-medium">Participants</th>
                        <th className="px-[15px] py-2 font-medium">Cotisations</th>
                        <th className="px-[15px] py-2 font-medium">Consommation</th>
                        <th className="px-[15px] py-2 font-medium">Ratio</th>
                        <th className="px-[15px] py-2 font-medium">Solde</th>
                        <th className="px-[15px] py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {[...dashboard.employers]
                        .sort((a, b) => (a.ratio ?? 99) - (b.ratio ?? 99))
                        .map((employer) => (
                          <tr
                            key={employer.employerId}
                            className="border-b border-line"
                          >
                            <td className="px-[15px] py-2.5">
                              <div className="font-medium">
                                {employer.employerName}
                              </div>
                              {employer.unopenedLedgers > 0 ? (
                                <div className="mt-px text-[11.5px] text-alert">
                                  {employer.unopenedLedgers} registre
                                  {employer.unopenedLedgers > 1 ? "s" : ""} sans
                                  ouverture
                                </div>
                              ) : null}
                            </td>
                            <td className="px-[15px] py-2.5 tabular-nums text-ink-3">
                              {formatNumber(employer.memberCount)}
                            </td>
                            <td className="px-[15px] py-2.5 tabular-nums">
                              {formatCurrency(employer.contributions)}
                            </td>
                            <td className="px-[15px] py-2.5 tabular-nums">
                              {formatCurrency(employer.consumption)}
                            </td>
                            <td className="px-[15px] py-2.5">
                              {employer.ratio === null ? (
                                // Not zero, not infinity: there is nothing to
                                // judge yet.
                                <span className="text-ink-3">
                                  aucune consommation
                                </span>
                              ) : (
                                <span
                                  className={`tabular-nums ${employer.ratio < 1 ? "text-alert" : ""}`}
                                >
                                  {Math.round(employer.ratio * 100) / 100}
                                </span>
                              )}
                            </td>
                            <td className="px-[15px] py-2.5">
                              <span
                                className={`tabular-nums ${employer.balance < 0 ? "text-alert" : ""}`}
                              >
                                {employer.balance > 0 ? "+" : ""}
                                {formatCurrency(employer.balance)}
                              </span>
                            </td>
                            <td className="px-[15px] py-2.5 text-right">
                              <Link
                                href={`/${firmSlug}/ipm/employeurs/${employer.employerId}/releve`}
                                className="text-[12.5px] text-brand hover:underline"
                              >
                                Relevé
                              </Link>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            {/* ---- série mensuelle ---------------------------------------- */}
            <Panel
              titleAs="h2"
              title="Cotisations et consommation par mois"
              description="Portées au registre. Une barre de consommation plus haute que sa cotisation est un mois déficitaire."
            >
              {dashboard.monthly.length === 0 ? (
                <EmptyState title="Aucune écriture au registre" />
              ) : (
                <div className="overflow-x-auto">
                  <div className="flex min-w-[600px] items-end gap-3">
                    {dashboard.monthly.slice(-12).map((point) => (
                      <div
                        key={`${point.year}-${point.month}`}
                        className="flex flex-1 flex-col items-center gap-1"
                      >
                        <div className="flex h-28 w-full items-end justify-center gap-1">
                          <div
                            className="w-1/2 rounded-t-sm bg-brand"
                            style={{
                              height: `${Math.max(2, (point.contributions / peak) * 100)}%`,
                            }}
                            title={`Cotisations ${formatCurrency(point.contributions)}`}
                          />
                          <div
                            className={`w-1/2 rounded-t-sm ${point.consumption > point.contributions ? "bg-alert" : "bg-sunken"}`}
                            style={{
                              height: `${Math.max(2, (point.consumption / peak) * 100)}%`,
                            }}
                            title={`Consommation ${formatCurrency(point.consumption)}`}
                          />
                        </div>
                        <span className="text-[11px] text-ink-3">
                          {MONTHS[point.month - 1]}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Panel>

            {/* ---- par catégorie ------------------------------------------ */}
            <Panel
              titleAs="h2"
              title="Où part la prise en charge"
              description="Part IPM engagée par catégorie de soins, tous bons non annulés."
              padded={false}
            >
              {dashboard.topCategories.length === 0 ? (
                <EmptyState title="Aucun bon émis" />
              ) : (
                <table className="w-full text-[13px]">
                  <tbody>
                    {dashboard.topCategories.map((category) => (
                      <tr key={category.label} className="border-b border-line">
                        <td className="px-[15px] py-2.5">{category.label}</td>
                        <td className="px-[15px] py-2.5 tabular-nums text-ink-3">
                          {formatNumber(category.count)} bons
                        </td>
                        <td className="px-[15px] py-2.5 text-right font-medium tabular-nums">
                          {formatCurrency(category.insurerShare)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </>
  )
}
