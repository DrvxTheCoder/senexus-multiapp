import type { Metadata } from "next"
import Link from "next/link"

import { Panel } from "@/components/panel"
import { StatusPill } from "@/components/primitives"
import { TopBar } from "@/components/shell/top-bar"
import { formatCurrency, formatNumber } from "@/lib/format"
import { membersHref } from "@/lib/queries/ipm/member-params"
import { requireFirmPage } from "@/server/auth/firm-page"
import { listEmployers } from "@/server/queries/ipm/employers"
import { memberSummary } from "@/server/queries/ipm/members"
import { listCategories, listPlans } from "@/server/queries/ipm/plans"

export const metadata: Metadata = { title: "IPM" }

/**
 * Vue d'ensemble.
 *
 * Deliberately not a dashboard of charts. Phase 1 is affiliation, and what the
 * institution needs to see at this stage is what is *missing* — participants
 * with no cotisation, employers with no barème, catégories with no taux. Those
 * gaps are the work queue for the manual re-entry the plan schedules (§8), so
 * they are the page rather than a footnote on it.
 *
 * The consumption and balance panels the direction eventually wants belong to
 * Phase 3, once the participant ledger exists. Showing an empty version of
 * them now would promise a number nobody can compute yet.
 */
export default async function IpmPage({ params }: PageProps<"/[firmSlug]/ipm">) {
  const { firmSlug } = await params
  const ctx = await requireFirmPage(firmSlug, { module: "ipm" })

  const [members, employers, plans, categories] = await Promise.all([
    memberSummary(ctx),
    listEmployers(ctx),
    listPlans(ctx),
    listCategories(ctx),
  ])

  const activeCategories = categories.filter((category) => category.active)
  const employersWithoutRates = employers.filter(
    (employer) => employer.planId === null && !employer.hasOwnRates
  )
  const missingRates = plans.reduce(
    (sum, plan) => sum + plan.missingCategoryIds.length,
    0
  )

  const gaps = [
    {
      label: "Participants sans cotisation",
      count: members.withoutContribution,
      href: membersHref(firmSlug),
      hint: "Rien ne leur sera facturé tant qu'aucun montant n'est ouvert.",
    },
    {
      label: "Employeurs sans barème",
      count: employersWithoutRates.length,
      href: `/${firmSlug}/ipm/employeurs`,
      hint: "Ni formule ni dérogation : aucune prise en charge calculable.",
    },
    {
      label: "Taux à saisir",
      count: missingRates,
      href: `/${firmSlug}/ipm/formules`,
      hint: "Barèmes non exportables de WebLamps, à ressaisir à la main.",
    },
  ]

  const outstanding = gaps.reduce((sum, gap) => sum + gap.count, 0)

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/ipm`}
        crumbs={[
          { label: ctx.firm.name, href: `/${firmSlug}/dashboard` },
          { label: "IPM" },
        ]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="p-4.5">
          <div className="mb-3.5 flex items-center gap-3">
            <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
              Prévoyance maladie
            </h1>
          </div>

          <div className="space-y-3.5">
            <Panel
              titleAs="h2"
              title="Affiliation"
              description="Ce que le module couvre aujourd'hui."
              stats={[
                { label: "Participants", value: formatNumber(members.total) },
                { label: "Actifs", value: formatNumber(members.active) },
                {
                  label: "Ayants droit",
                  value: formatNumber(members.dependents),
                },
                {
                  label: "Cotisations / mois",
                  value: formatCurrency(members.monthlyContributions),
                },
              ]}
            >
              <div className="flex flex-wrap gap-2 text-[13px]">
                <Link
                  href={membersHref(firmSlug)}
                  className="rounded-control border border-line px-2.5 py-1 hover:bg-sub"
                >
                  Participants
                </Link>
                <Link
                  href={`/${firmSlug}/ipm/employeurs`}
                  className="rounded-control border border-line px-2.5 py-1 hover:bg-sub"
                >
                  {formatNumber(employers.length)} employeurs
                </Link>
                <Link
                  href={`/${firmSlug}/ipm/formules`}
                  className="rounded-control border border-line px-2.5 py-1 hover:bg-sub"
                >
                  {formatNumber(plans.length)} formules
                </Link>
                <Link
                  href={`/${firmSlug}/ipm/referentiel`}
                  className="rounded-control border border-line px-2.5 py-1 hover:bg-sub"
                >
                  {formatNumber(activeCategories.length)} catégories
                </Link>
              </div>
            </Panel>

            <Panel
              titleAs="h2"
              title="À compléter"
              description={
                outstanding === 0
                  ? "Rien ne manque."
                  : "Chaque ligne empêche un calcul, pas seulement un affichage."
              }
              padded={false}
            >
              <table className="w-full text-[13px]">
                <tbody>
                  {gaps.map((gap) => (
                    <tr key={gap.label} className="border-b border-line">
                      <td className="px-[15px] py-2.5">
                        <Link
                          href={gap.href}
                          className="font-medium hover:text-brand hover:underline"
                        >
                          {gap.label}
                        </Link>
                        <div className="mt-px text-[11.5px] text-ink-3">
                          {gap.hint}
                        </div>
                      </td>
                      <td className="px-[15px] py-2.5 text-right">
                        {gap.count === 0 ? (
                          <StatusPill tone="ok">Rien à faire</StatusPill>
                        ) : (
                          <span className="tabular-nums text-alert">
                            {formatNumber(gap.count)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>

            <Panel
              titleAs="h2"
              title="Phases suivantes"
              description="Ce que ce module ne fait pas encore, et pourquoi."
            >
              <ol className="max-w-prose space-y-1.5 text-[13px] text-ink-3">
                <li>
                  <span className="font-medium text-ink">Phase 2 — Bons.</span>{" "}
                  Prestataires et conventions, émission avec contrôle des
                  droits, moteur de règlement, vérification QR.
                </li>
                <li>
                  <span className="font-medium text-ink">
                    Phase 3 — Cotisations et comptes.
                  </span>{" "}
                  Registre participant, facturation employeur, relevés. Le solde
                  par participant en dépend, et son solde d&apos;ouverture reste
                  à arrêter.
                </li>
                <li>
                  <span className="font-medium text-ink">
                    Phase 4 — Décaissements.
                  </span>{" "}
                  Factures prestataires, remboursements, bons de décaissement,
                  exports comptables.
                </li>
              </ol>
            </Panel>
          </div>
        </div>
      </div>
    </>
  )
}
