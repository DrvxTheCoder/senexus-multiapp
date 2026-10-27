import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"

import {
  ChartLegend,
  ComposedChart,
  DivergingBars,
  DonutChart,
  GaugeChart,
  RingChart,
} from "@/components/charts"
import { KpiStrip, type KpiTile } from "@/components/kpi-strip"
import { Panel, PanelSkeleton } from "@/components/panel"
import { EmptyState, StatusPill } from "@/components/primitives"
import { TopBar } from "@/components/shell/top-bar"
import { formatCurrency, formatCurrencyCompact, formatNumber } from "@/lib/format"
import { vouchersHref } from "@/lib/queries/ipm/voucher-params"
import { requireFirmPage } from "@/server/auth/firm-page"
import type { FirmContext } from "@/server/auth/require-firm-access"
import { ratioTone } from "@/server/domain/ipm/alerts"
import { ipmDashboard } from "@/server/queries/ipm/dashboard"
import {
  categoryShare,
  ledgerMonthly,
  settlement,
} from "@/server/queries/ipm/insights"

export const metadata: Metadata = { title: "Pilotage" }

const SEVERITY_TONE = {
  CRITICAL: "alert",
  WARNING: "signal",
  INFO: "muted",
} as const

/** Consommation is a second series, not a warning: blue, never ochre or red. */
const CONSUMPTION_COLOR = "var(--sx-dot-3)"

/**
 * Pilotage — plan §5 (phase 5).
 *
 * The screen answers the one question the direction has never been able to
 * ask: **which employers consume more than they contribute**. §4.8quater says
 * the relevé is the document that justifies keeping the register; this is the
 * portfolio view of the same number, now with the months behind it, the
 * ratio placed against its thresholds, and the cash side — what was billed
 * and collected, what was received from prestataires and paid out.
 *
 * Two deliberate refusals, kept from the first version:
 *
 *   - an employer with no claims shows **no ratio**, not a zero and not an
 *     infinity. Either number would rank them as the best or the worst in the
 *     portfolio when the truth is that there is nothing to judge yet;
 *   - when any register lacks an opening balance, the page says so at the top
 *     rather than presenting totals that quietly start from zero. §9 is
 *     explicit that those totals are wrong, and a dashboard that hides it is
 *     worse than one that does not exist.
 *
 * Every figure here rests on the **registre** except the category split and
 * the settlement rings, which say what they are drawn from.
 */
export default async function PilotagePage({
  params,
}: PageProps<"/[firmSlug]/ipm/pilotage">) {
  const { firmSlug } = await params
  const ctx = await requireFirmPage(firmSlug, { module: "ipm" })

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
            <span className="text-[12.5px] text-ink-3">12 derniers mois</span>
          </div>

          <Suspense fallback={<PanelSkeleton height={196} />}>
            <HeadlinePanel ctx={ctx} />
          </Suspense>

          <div className="mt-3.5 grid items-start gap-3.5 xl:grid-cols-[minmax(0,1.62fr)_minmax(0,1fr)]">
            <div className="flex flex-col gap-3.5">
              <Suspense fallback={<PanelSkeleton height={320} />}>
                <MonthlyPanel ctx={ctx} />
              </Suspense>
              <Suspense fallback={<PanelSkeleton height={260} />}>
                <BalancePanel ctx={ctx} />
              </Suspense>
              <Suspense fallback={<PanelSkeleton height={300} />}>
                <EmployersPanel ctx={ctx} />
              </Suspense>
            </div>

            <div className="flex flex-col gap-3.5">
              <Suspense fallback={<PanelSkeleton height={260} />}>
                <RatioPanel ctx={ctx} />
              </Suspense>
              <Suspense fallback={<PanelSkeleton height={200} />}>
                <AlertsPanel ctx={ctx} />
              </Suspense>
              <Suspense fallback={<PanelSkeleton height={260} />}>
                <CategoriesPanel ctx={ctx} />
              </Suspense>
              <Suspense fallback={<PanelSkeleton height={240} />}>
                <SettlementPanel ctx={ctx} />
              </Suspense>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

/* ========================================================================== */

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

async function HeadlinePanel({ ctx }: { ctx: FirmContext }) {
  const slug = ctx.firm.slug
  const [dashboard, ledger, cash] = await Promise.all([
    ipmDashboard(ctx, slug),
    ledgerMonthly(ctx),
    settlement(ctx),
  ])

  const contributions = sum(ledger.contributions)
  const consumption = sum(ledger.consumption)
  const net = contributions - consumption
  const balance = dashboard.employers.reduce((total, employer) => total + employer.balance, 0)
  const debtors = dashboard.employers.filter((employer) => employer.balance < 0).length

  const tiles: KpiTile[] = [
    {
      label: "Cotisations portées",
      value: formatCurrencyCompact(contributions),
      unit: "12 mois",
      delta: {
        label: `${formatCurrencyCompact(dashboard.headline.monthlyContributions)} / mois en vigueur`,
        tone: "muted",
      },
      trend: ledger.contributions,
      href: `/${slug}/ipm/cotisations`,
    },
    {
      label: "Consommation portée",
      value: formatCurrencyCompact(consumption),
      unit: "12 mois",
      delta: {
        label: `${net >= 0 ? "+" : "−"}${formatCurrencyCompact(Math.abs(net))} de marge`,
        tone: net >= 0 ? "ok" : "alert",
      },
      trend: ledger.consumption,
      trendTone: net >= 0 ? "brand" : "alert",
      href: vouchersHref(slug),
    },
    {
      label: "Solde des registres",
      value: `${balance < 0 ? "−" : ""}${formatCurrencyCompact(Math.abs(balance))}`,
      delta: {
        label:
          debtors === 0
            ? "aucun employeur débiteur"
            : `${formatNumber(debtors)} employeur${debtors > 1 ? "s" : ""} débiteur${debtors > 1 ? "s" : ""}`,
        tone: debtors > 0 ? "alert" : "ok",
      },
      href: `/${slug}/ipm/employeurs`,
    },
    {
      label: "Engagé non réglé",
      value: formatCurrencyCompact(dashboard.headline.outstandingCommitment),
      delta: { label: "bons émis ou présentés", tone: "muted" },
      href: vouchersHref(slug, { status: ["ISSUED", "PRESENTED"] }),
    },
    {
      label: "Créances employeurs",
      value: formatCurrencyCompact(cash.employerOutstanding),
      delta:
        cash.employerOverdue > 0
          ? { label: `dont ${formatCurrencyCompact(cash.employerOverdue)} échus`, tone: "alert" }
          : { label: "rien d'échu", tone: "ok" },
      href: `/${slug}/ipm/factures`,
    },
  ]

  return (
    <Panel
      title="Institution"
      description={
        dashboard.incompleteData
          ? "Certains registres n'ont pas de solde d'ouverture : les totaux ci-dessous sont partiels."
          : "Cotisations et consommation portées au registre, engagements et créances."
      }
      padded={false}
      footer={
        dashboard.incompleteData
          ? {
              summary: (
                <span className="text-alert">
                  Un registre sans solde d&apos;ouverture part de zéro à la bascule : le ratio et les
                  soldes sous-estiment la réalité tant qu&apos;il n&apos;est pas saisi.
                </span>
              ),
            }
          : {
              summary: `${formatNumber(dashboard.headline.activeMembers)} participants actifs et ${formatNumber(dashboard.headline.dependents)} ayants droit.`,
            }
      }
    >
      <KpiStrip tiles={tiles} />
    </Panel>
  )
}

/* ========================================================================== */

async function MonthlyPanel({ ctx }: { ctx: FirmContext }) {
  const ledger = await ledgerMonthly(ctx)
  const deficits = ledger.months.filter(
    (_, index) => ledger.consumption[index] > ledger.contributions[index]
  )
  const worstIndex = ledger.contributions.reduce(
    (worst, contribution, index) =>
      contribution - ledger.consumption[index] <
      ledger.contributions[worst] - ledger.consumption[worst]
        ? index
        : worst,
    0
  )
  const worstGap = ledger.contributions[worstIndex] - ledger.consumption[worstIndex]

  return (
    <Panel
      title="Cotisations et consommation"
      description="Portées au registre, mois par mois. Une courbe au-dessus de sa barre est un mois déficitaire."
      stats={[
        {
          label: "Mois déficitaires",
          value: formatNumber(deficits.length),
          tone: deficits.length > 0 ? "alert" : "ok",
        },
      ]}
      footer={{
        summary:
          worstGap < 0
            ? `Plus fort déficit en ${ledger.months[worstIndex].label} : −${formatCurrencyCompact(-worstGap)}.`
            : "Aucun mois déficitaire sur la période.",
        action: (
          <ChartLegend
            items={[
              { label: "Cotisations", color: "var(--sx-brand)" },
              { label: "Consommation", color: CONSUMPTION_COLOR, kind: "line" },
            ]}
          />
        ),
      }}
    >
      <ComposedChart
        format="currency"
        height={220}
        labels={ledger.months.map((month) => month.label)}
        tickLabels={ledger.months.map((month) => month.short)}
        series={[
          {
            id: "contributions",
            label: "Cotisations",
            kind: "bar",
            color: "color-mix(in oklch, var(--sx-brand) 78%, var(--sx-brand-tint))",
            values: ledger.contributions,
          },
          {
            id: "consumption",
            label: "Consommation",
            kind: "area",
            color: CONSUMPTION_COLOR,
            values: ledger.consumption,
          },
        ]}
        difference={{ label: "Solde du mois", plus: "contributions", minus: "consumption" }}
      />
    </Panel>
  )
}

/* ========================================================================== */

async function BalancePanel({ ctx }: { ctx: FirmContext }) {
  const slug = ctx.firm.slug
  const dashboard = await ipmDashboard(ctx, slug)
  const rows = [...dashboard.employers].sort((a, b) => a.balance - b.balance)
  const debtors = rows.filter((row) => row.balance < 0)

  return (
    <Panel
      title="Solde par employeur"
      description="Somme des registres de leurs participants. À gauche ce qu'ils doivent, à droite leur réserve."
      stats={[
        {
          label: "Débiteurs",
          value: formatNumber(debtors.length),
          tone: debtors.length > 0 ? "alert" : "ok",
        },
      ]}
      footer={{
        summary:
          debtors.length === 0
            ? "Aucun employeur débiteur."
            : `${debtors[0].employerName} porte le solde le plus négatif.`,
        action: (
          <Link href={`/${slug}/ipm/employeurs`} className="font-medium hover:text-brand">
            Employeurs
          </Link>
        ),
      }}
    >
      {rows.length === 0 ? (
        <EmptyState title="Aucun employeur affilié" />
      ) : (
        <DivergingBars
          format="compact"
          rows={rows.map((row) => ({
            id: row.employerId,
            label: row.employerName,
            value: row.balance,
            href: `/${slug}/ipm/employeurs/${row.employerId}/releve`,
          }))}
        />
      )}
    </Panel>
  )
}

/* ========================================================================== */

async function EmployersPanel({ ctx }: { ctx: FirmContext }) {
  const slug = ctx.firm.slug
  const dashboard = await ipmDashboard(ctx, slug)

  return (
    <Panel
      title="Par employeur"
      description="Le chiffre que la direction n'a jamais eu : qui consomme plus qu'il ne cotise."
      padded={false}
    >
      {dashboard.employers.length === 0 ? (
        <EmptyState title="Aucun employeur affilié" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-y border-line bg-sub text-left text-[11.5px] text-ink-3">
                <th className="px-[15px] py-2 font-medium">Employeur</th>
                <th className="px-[15px] py-2 text-right font-medium">Participants</th>
                <th className="px-[15px] py-2 text-right font-medium">Cotisations</th>
                <th className="px-[15px] py-2 text-right font-medium">Consommation</th>
                <th className="px-[15px] py-2 font-medium">Ratio</th>
                <th className="px-[15px] py-2" />
              </tr>
            </thead>
            <tbody>
              {[...dashboard.employers]
                .sort((a, b) => (a.ratio ?? 99) - (b.ratio ?? 99))
                .map((employer) => (
                  <tr key={employer.employerId} className="border-b border-line last:border-b-0">
                    <td className="px-[15px] py-2.5">
                      <div className="font-medium">{employer.employerName}</div>
                      {employer.unopenedLedgers > 0 ? (
                        <div className="mt-px text-[11.5px] text-alert">
                          {employer.unopenedLedgers} registre
                          {employer.unopenedLedgers > 1 ? "s" : ""} sans ouverture
                        </div>
                      ) : null}
                    </td>
                    <td className="num px-[15px] py-2.5 text-right text-ink-3">
                      {formatNumber(employer.memberCount)}
                    </td>
                    <td className="num px-[15px] py-2.5 text-right">
                      {formatCurrency(employer.contributions)}
                    </td>
                    <td className="num px-[15px] py-2.5 text-right">
                      {formatCurrency(employer.consumption)}
                    </td>
                    <td className="px-[15px] py-2.5">
                      {employer.ratio === null ? (
                        // Not zero, not infinity: there is nothing to judge yet.
                        <span className="text-[12px] text-ink-3">aucune consommation</span>
                      ) : (
                        <RatioMeter ratio={employer.ratio} />
                      )}
                    </td>
                    <td className="px-[15px] py-2.5 text-right">
                      <Link
                        href={`/${slug}/ipm/employeurs/${employer.employerId}/releve`}
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
  )
}

/** The ratio with a small meter on the gauge's own scale (0 to 2). */
function RatioMeter({ ratio }: { ratio: number }) {
  const tone = ratioTone(ratio)
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative h-[5px] w-16 overflow-hidden rounded-full bg-sunken">
        <span
          className={`absolute inset-y-0 left-0 rounded-full ${tone === "alert" ? "bg-alert" : tone === "signal" ? "bg-signal" : "bg-ok"}`}
          style={{ width: `${Math.min(100, (ratio / 2) * 100)}%` }}
        />
        {/* The break-even mark. */}
        <span aria-hidden className="absolute inset-y-0 left-1/2 w-px bg-ink-3" />
      </span>
      <span className={`num ${tone === "alert" ? "text-alert" : ""}`}>
        {ratio.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    </span>
  )
}

/* ========================================================================== */

async function RatioPanel({ ctx }: { ctx: FirmContext }) {
  const dashboard = await ipmDashboard(ctx, ctx.firm.slug)
  const ratio = dashboard.headline.ratio
  const below = dashboard.employers.filter((employer) => employer.ratio !== null && employer.ratio < 1)

  return (
    <Panel
      title="Ratio cotisations / consommation"
      description="Tous registres confondus, depuis leur ouverture. Sous 1, l'IPM paie plus qu'elle ne reçoit."
      footer={{
        summary:
          ratio === null
            ? "Aucune consommation portée : rien à juger encore."
            : below.length === 0
              ? "Aucun employeur sous l'équilibre."
              : `${formatNumber(below.length)} employeur${below.length > 1 ? "s" : ""} sous l'équilibre.`,
      }}
    >
      <GaugeChart
        value={ratio === null ? null : Math.min(ratio, 2)}
        max={2}
        label="Ratio"
        zones={[
          { to: 1, color: "var(--sx-alert)", label: "Déficitaire" },
          { to: 1.2, color: "var(--sx-signal)", label: "Vigilance" },
          { to: 2, color: "var(--sx-ok)", label: "Équilibré" },
        ]}
      />
    </Panel>
  )
}

/* ========================================================================== */

async function AlertsPanel({ ctx }: { ctx: FirmContext }) {
  const dashboard = await ipmDashboard(ctx, ctx.firm.slug)

  return (
    <Panel
      title="Alertes"
      description="Le franchissement d'un seuil alerte ; il ne bloque jamais automatiquement."
      stats={
        dashboard.alerts.length > 0
          ? [
              {
                label: "Actives",
                value: formatNumber(dashboard.alerts.length),
                tone: dashboard.alerts.some((alert) => alert.severity === "CRITICAL") ? "alert" : "default",
              },
            ]
          : undefined
      }
      padded={false}
    >
      {dashboard.alerts.length === 0 ? (
        <EmptyState
          title="Aucune alerte"
          description="Aucun seuil franchi, aucune facture échue, aucun registre incohérent."
        />
      ) : (
        <ul>
          {dashboard.alerts.map((alert) => (
            <li key={alert.kind} className="border-t border-line px-[15px] py-2.5">
              <div className="flex items-center gap-2">
                <StatusPill tone={SEVERITY_TONE[alert.severity]}>
                  {alert.severity === "CRITICAL"
                    ? "Critique"
                    : alert.severity === "WARNING"
                      ? "Vigilance"
                      : "Information"}
                </StatusPill>
                {alert.href ? (
                  <Link href={alert.href} className="min-w-0 truncate text-[13px] font-medium hover:text-brand">
                    {alert.title}
                  </Link>
                ) : (
                  <span className="min-w-0 truncate text-[13px] font-medium">{alert.title}</span>
                )}
              </div>
              <p className="mt-1 text-[12px] text-ink-3">{alert.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/* ========================================================================== */

const CATEGORY_COLORS = [
  "var(--sx-brand)",
  "var(--sx-dot-3)",
  "var(--sx-dot-4)",
  "color-mix(in oklch, var(--sx-brand) 50%, var(--sx-brand-tint))",
  "color-mix(in oklch, var(--sx-dot-3) 45%, var(--sx-brand-tint))",
]

async function CategoriesPanel({ ctx }: { ctx: FirmContext }) {
  const slug = ctx.firm.slug
  const categories = await categoryShare(ctx)
  const head = categories.slice(0, CATEGORY_COLORS.length)
  const tail = categories.slice(CATEGORY_COLORS.length)
  const total = categories.reduce((sum, category) => sum + category.insurerShare, 0)

  const segments = [
    ...head.map((category, index) => ({
      id: category.id,
      label: category.label,
      value: category.insurerShare,
      color: CATEGORY_COLORS[index],
      href: vouchersHref(slug, { categoryId: [category.id] }),
    })),
    ...(tail.length > 0
      ? [
          {
            id: "others",
            label: `${tail.length} autres`,
            value: tail.reduce((sum, category) => sum + category.insurerShare, 0),
            color: "var(--sx-dot-7)",
          },
        ]
      : []),
  ]

  return (
    <Panel
      title="Où part la prise en charge"
      description="Part IPM engagée par catégorie de soins, sur les bons de 12 mois."
      footer={{
        summary:
          categories.length === 0
            ? "Aucun bon émis sur la période."
            : `${head[0].label} : ${Math.round((head[0].insurerShare / total) * 100)} % de la prise en charge, ${formatNumber(head[0].count)} bons.`,
      }}
    >
      {categories.length === 0 ? (
        <EmptyState title="Aucun bon émis" />
      ) : (
        <DonutChart segments={segments} centerLabel="Part IPM" format="compact" size={136} />
      )}
    </Panel>
  )
}

/* ========================================================================== */

async function SettlementPanel({ ctx }: { ctx: FirmContext }) {
  const slug = ctx.firm.slug
  const cash = await settlement(ctx)
  const providerDue = cash.providerReceived - cash.providerPaid

  return (
    <Panel
      title="Recouvrement et règlements"
      description="Ce qui est encaissé sur ce qui est facturé, et payé sur ce qui est dû."
      footer={{
        summary:
          providerDue > 0
            ? `${formatCurrencyCompact(providerDue)} restent à régler aux prestataires.`
            : "Toutes les factures prestataires reçues sont réglées.",
        action: (
          <Link href={`/${slug}/ipm/decaissements`} className="font-medium hover:text-brand">
            Décaissements
          </Link>
        ),
      }}
    >
      <RingChart
        format="compact"
        size={136}
        rings={[
          {
            id: "employers",
            label: "Cotisations encaissées",
            value: cash.employerCollected,
            max: cash.employerBilled,
            color: "var(--sx-brand)",
            href: `/${slug}/ipm/factures`,
          },
          {
            id: "providers",
            label: "Prestataires réglés",
            value: cash.providerPaid,
            max: cash.providerReceived,
            color: "var(--sx-dot-3)",
            href: `/${slug}/ipm/factures`,
          },
          {
            id: "reimbursements",
            label: "Remboursements versés",
            value: cash.reimbursementPaid,
            max: cash.reimbursementGranted,
            color: "var(--sx-dot-4)",
            href: `/${slug}/ipm/decaissements`,
          },
        ]}
      />
    </Panel>
  )
}
