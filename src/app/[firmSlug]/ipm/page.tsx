import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"

import {
  CalendarHeatmap,
  ChartLegend,
  ComposedChart,
  DonutChart,
  FunnelChart,
  HorizontalBars,
} from "@/components/charts"
import { formatChartValue } from "@/lib/chart-format"
import { KpiStrip, type KpiTile } from "@/components/kpi-strip"
import { Panel, PanelSkeleton } from "@/components/panel"
import { StatusPill } from "@/components/primitives"
import { TopBar } from "@/components/shell/top-bar"
import { firmHomeHref } from "@/lib/firm-home"
import { formatCurrencyCompact, formatNumber } from "@/lib/format"
import { membersHref } from "@/lib/queries/ipm/member-params"
import { vouchersHref } from "@/lib/queries/ipm/voucher-params"
import {
  VOUCHER_TYPE_LABELS,
  type VOUCHER_TYPES,
} from "@/lib/queries/ipm/voucher-query"
import { requireFirmPage } from "@/server/auth/firm-page"
import type { FirmContext } from "@/server/auth/require-firm-access"
import { listEmployers } from "@/server/queries/ipm/employers"
import {
  beneficiaryMix,
  coverageTrend,
  ledgerMonthly,
  topProviders,
  voucherDaily,
  voucherMonthly,
  voucherPipeline,
} from "@/server/queries/ipm/insights"
import { memberSummary } from "@/server/queries/ipm/members"
import { listCategories, listPlans } from "@/server/queries/ipm/plans"

export const metadata: Metadata = { title: "IPM" }

/** Never ochre: `--sx-signal` means a threshold, not a series. */
const TYPE_COLORS: Record<(typeof VOUCHER_TYPES)[number], string> = {
  PHARMACY: "var(--sx-brand)",
  GUARANTEE: "var(--sx-dot-3)",
  OPTICAL: "var(--sx-dot-4)",
  HOSPITALIZATION: "var(--sx-dot-7)",
}

/**
 * Vue d'ensemble — the operational view of the institution.
 *
 * Where Pilotage answers "are we solvent", this page answers "what is the
 * counter doing": who is covered, how many bons go out and where they are in
 * their life, what the IPM committed to pay, and which prestataires it pays.
 * The gaps that block a calculation stay at the bottom of the right column —
 * they are still a work queue, just no longer the whole page.
 *
 * Every panel is an independent aggregate behind its own Suspense boundary,
 * and every figure drills through to the list that produced it.
 */
export default async function IpmPage({ params }: PageProps<"/[firmSlug]/ipm">) {
  const { firmSlug } = await params
  const ctx = await requireFirmPage(firmSlug, { module: "ipm" })

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/ipm`}
        crumbs={[
          { label: ctx.firm.name, href: firmHomeHref(ctx.firm) },
          { label: "IPM" },
        ]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="p-4.5">
          <div className="mb-3.5 flex items-center gap-3">
            <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
              Prévoyance maladie
            </h1>
            <span className="text-[12.5px] text-ink-3">12 derniers mois</span>
            <Link
              href={`/${firmSlug}/ipm/pilotage`}
              className="ml-auto inline-flex h-[30px] items-center rounded-[7px] border border-line bg-surface px-2.5 text-[12.5px] font-medium hover:bg-sub"
            >
              Pilotage financier
            </Link>
          </div>

          <Suspense fallback={<PanelSkeleton height={196} />}>
            <OverviewPanel ctx={ctx} />
          </Suspense>

          <div className="mt-3.5 grid items-start gap-3.5 xl:grid-cols-[minmax(0,1.62fr)_minmax(0,1fr)]">
            <div className="flex flex-col gap-3.5">
              <Suspense fallback={<PanelSkeleton height={300} />}>
                <ActivityPanel ctx={ctx} />
              </Suspense>
              <Suspense fallback={<PanelSkeleton height={300} />}>
                <CommitmentPanel ctx={ctx} />
              </Suspense>
              <Suspense fallback={<PanelSkeleton height={260} />}>
                <RhythmPanel ctx={ctx} />
              </Suspense>
            </div>

            <div className="flex flex-col gap-3.5">
              <Suspense fallback={<PanelSkeleton height={290} />}>
                <PipelinePanel ctx={ctx} />
              </Suspense>
              <Suspense fallback={<PanelSkeleton height={240} />}>
                <CoveragePanel ctx={ctx} />
              </Suspense>
              <Suspense fallback={<PanelSkeleton height={260} />}>
                <ProvidersPanel ctx={ctx} />
              </Suspense>
              <Suspense fallback={<PanelSkeleton height={200} />}>
                <GapsPanel ctx={ctx} />
              </Suspense>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

/* ========================================================================== */

/** `+3` / `−2` / `0`, with the true minus sign the figures use elsewhere. */
function signed(value: number, format: (value: number) => string = formatNumber): string {
  if (value === 0) return "0"
  return `${value > 0 ? "+" : "−"}${format(Math.abs(value))}`
}

async function OverviewPanel({ ctx }: { ctx: FirmContext }) {
  const [coverage, vouchers, ledger, members, mix] = await Promise.all([
    coverageTrend(ctx),
    voucherMonthly(ctx),
    ledgerMonthly(ctx),
    memberSummary(ctx),
    beneficiaryMix(ctx),
  ])
  const slug = ctx.firm.slug
  const last = vouchers.months.length - 1
  const previousMonth = vouchers.months[last - 1]
  const firstOfMonth = `${vouchers.months[last].year}-${String(vouchers.months[last].month).padStart(2, "0")}-01`

  // The figures are today's statuses, the same counts the donut below draws;
  // the trend and its delta come from affiliation and coverage dates, which is
  // the only way to know who was covered in a past month.
  const heads = coverage.members.map((count, index) => count + coverage.dependents[index])
  const membersNow = mix.members
  const membersDelta = coverage.members[last] - coverage.members[Math.max(0, last - 3)]
  const headsNow = mix.members + mix.spouses + mix.children + mix.ascendants + mix.others
  const headsDelta = heads[last] - heads[Math.max(0, last - 3)]

  // Cotisations are posted once the month is called: an empty current month
  // is "not yet", and drawn as a fall to zero it would read as a collapse.
  const contributionTrend =
    ledger.contributions[last] === 0 ? ledger.contributions.slice(0, -1) : ledger.contributions

  const tiles: KpiTile[] = [
    {
      label: "Participants actifs",
      value: formatNumber(membersNow),
      delta: {
        label: `${signed(membersDelta)} sur 3 mois`,
        tone: membersDelta >= 0 ? "ok" : "alert",
      },
      trend: coverage.members,
      href: membersHref(slug, { status: ["ACTIVE"] }),
    },
    {
      label: "Bénéficiaires",
      value: formatNumber(headsNow),
      unit: "têtes",
      delta: {
        label: `${signed(headsDelta)} sur 3 mois`,
        tone: headsDelta >= 0 ? "ok" : "alert",
      },
      trend: heads,
      href: membersHref(slug, { status: ["ACTIVE"] }),
    },
    {
      label: "Bons émis ce mois",
      value: formatNumber(vouchers.count[last]),
      // The month is not over: a delta against a whole month would always
      // read as a fall. The previous month is given as a reference instead.
      delta: previousMonth
        ? { label: `${previousMonth.short} : ${formatNumber(vouchers.count[last - 1])}`, tone: "muted" }
        : undefined,
      trend: vouchers.count,
      href: vouchersHref(slug, { from: firstOfMonth }),
    },
    {
      label: "Part IPM engagée ce mois",
      value: formatCurrencyCompact(vouchers.insurerShare[last]),
      delta: previousMonth
        ? {
            label: `${previousMonth.short} : ${formatCurrencyCompact(vouchers.insurerShare[last - 1])}`,
            tone: "muted",
          }
        : undefined,
      trend: vouchers.insurerShare,
      href: vouchersHref(slug, { from: firstOfMonth }),
    },
    {
      label: "Cotisations mensuelles",
      value: formatCurrencyCompact(members.monthlyContributions),
      unit: "appel en vigueur",
      delta:
        members.withoutContribution > 0
          ? { label: `${formatNumber(members.withoutContribution)} sans cotisation`, tone: "alert" }
          : { label: "Tous cotisent", tone: "ok" },
      trend: contributionTrend,
      href: `/${slug}/ipm/cotisations`,
    },
  ]

  const portalShare = vouchers.total === 0 ? 0 : Math.round((vouchers.portal / vouchers.total) * 100)

  return (
    <Panel
      title="Vue d'ensemble"
      description="Couverture, activité du guichet et engagement de l'IPM."
      padded={false}
      footer={{
        summary: `${formatNumber(vouchers.total)} bons en 12 mois, dont ${portalShare} % via le portail participant.`,
        action: (
          <Link href={vouchersHref(slug)} className="font-medium hover:text-brand">
            Voir les bons
          </Link>
        ),
      }}
    >
      <KpiStrip tiles={tiles} />
    </Panel>
  )
}

/* ========================================================================== */

async function ActivityPanel({ ctx }: { ctx: FirmContext }) {
  const vouchers = await voucherMonthly(ctx)
  const types = (Object.keys(vouchers.byType) as (keyof typeof vouchers.byType)[]).filter(
    (type) => vouchers.byType[type].some((count) => count > 0)
  )
  const average = vouchers.total / vouchers.months.length
  const peakIndex = vouchers.count.indexOf(Math.max(...vouchers.count))

  return (
    <Panel
      title="Activité des bons"
      description="Bons émis par mois et par nature, hors annulés et refusés."
      stats={[
        { label: "12 mois", value: formatNumber(vouchers.total) },
        { label: "Moyenne", value: `${average.toFixed(1).replace(".", ",")} / mois` },
      ]}
      footer={{
        summary:
          vouchers.total === 0
            ? "Aucun bon émis sur la période."
            : `Pic en ${vouchers.months[peakIndex].label} avec ${formatNumber(vouchers.count[peakIndex])} bons.`,
        action: <ChartLegend items={types.map((type) => ({ label: VOUCHER_TYPE_LABELS[type], color: TYPE_COLORS[type] }))} />,
      }}
    >
      <ComposedChart
        format="number"
        height={190}
        labels={vouchers.months.map((month) => month.label)}
        tickLabels={vouchers.months.map((month) => month.short)}
        series={types.map((type) => ({
          id: type,
          label: VOUCHER_TYPE_LABELS[type],
          kind: "bar",
          color: TYPE_COLORS[type],
          values: vouchers.byType[type],
        }))}
      />
    </Panel>
  )
}

/* ========================================================================== */

async function CommitmentPanel({ ctx }: { ctx: FirmContext }) {
  const vouchers = await voucherMonthly(ctx)
  const committed = vouchers.insurerShare.reduce((sum, value) => sum + value, 0)
  const billed = vouchers.totalAmount.reduce((sum, value) => sum + value, 0)
  const coverage = billed === 0 ? null : Math.round((committed / billed) * 100)

  return (
    <Panel
      title="Prise en charge engagée"
      description="Montant des actes et part IPM, par mois d'émission du bon. L'écart est le ticket modérateur."
      stats={[
        { label: "Part IPM", value: formatCurrencyCompact(committed) },
        { label: "Taux moyen", value: coverage === null ? "—" : `${coverage} %` },
      ]}
      footer={{
        summary:
          billed === 0
            ? "Aucun acte chiffré sur la période."
            : `${formatCurrencyCompact(billed - committed)} restés à la charge des participants.`,
        action: (
          <ChartLegend
            items={[
              { label: "Montant des actes", color: "var(--sx-ink-3)", kind: "dashed" },
              { label: "Part IPM", color: "var(--sx-brand)", kind: "line" },
            ]}
          />
        ),
      }}
    >
      <ComposedChart
        format="currency"
        height={190}
        labels={vouchers.months.map((month) => month.label)}
        tickLabels={vouchers.months.map((month) => month.short)}
        series={[
          {
            id: "total",
            label: "Montant des actes",
            kind: "line",
            dashed: true,
            color: "var(--sx-ink-3)",
            values: vouchers.totalAmount,
          },
          {
            id: "share",
            label: "Part IPM",
            kind: "area",
            color: "var(--sx-brand)",
            values: vouchers.insurerShare,
          },
        ]}
        difference={{ label: "Ticket modérateur", plus: "total", minus: "share" }}
      />
    </Panel>
  )
}

/* ========================================================================== */

const WEEKDAY_NAMES = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]

async function RhythmPanel({ ctx }: { ctx: FirmContext }) {
  const days = await voucherDaily(ctx, 26)
  const total = days.reduce((sum, day) => sum + day.value, 0)
  const active = days.filter((day) => day.value > 0).length

  const byWeekday = [0, 0, 0, 0, 0, 0, 0]
  days.forEach((day, index) => {
    byWeekday[index % 7] += day.value
  })
  const busiest = byWeekday.indexOf(Math.max(...byWeekday))

  return (
    <Panel
      title="Rythme d'émission"
      description="Bons émis par jour, six derniers mois."
      stats={[
        { label: "Jours actifs", value: formatNumber(active) },
        { label: "Bons", value: formatNumber(total) },
      ]}
      footer={{
        summary:
          total === 0
            ? "Aucun bon sur les six derniers mois."
            : `Le ${WEEKDAY_NAMES[busiest]} concentre ${Math.round((byWeekday[busiest] / total) * 100)} % des émissions.`,
      }}
    >
      <CalendarHeatmap days={days} unit="Bons" />
    </Panel>
  )
}

/* ========================================================================== */

async function PipelinePanel({ ctx }: { ctx: FirmContext }) {
  const pipeline = await voucherPipeline(ctx)
  const slug = ctx.firm.slug

  const invoiced = pipeline.INVOICED
  const settled = pipeline.SETTLED + invoiced
  const presented = pipeline.PRESENTED + settled
  const issued = pipeline.ISSUED + pipeline.EXPIRED + presented

  const aside = [
    { label: "À valider", value: pipeline.PENDING_REVIEW, status: ["PENDING_REVIEW"] as const, tone: "signal" as const },
    { label: "Montant attendu", value: pipeline.AWAITING_AMOUNT, status: ["AWAITING_AMOUNT"] as const, tone: "signal" as const },
    { label: "Expirés", value: pipeline.EXPIRED, status: ["EXPIRED"] as const, tone: "alert" as const },
    {
      label: "Annulés, refusés",
      value: pipeline.CANCELLED + pipeline.REJECTED,
      status: ["CANCELLED", "REJECTED"] as const,
      tone: "muted" as const,
    },
  ]

  return (
    <Panel
      title="Cycle des bons"
      description="Où en sont les bons émis sur 12 mois."
      padded={false}
      footer={{
        summary:
          issued === 0
            ? "Aucun bon émis."
            : `${Math.round((settled / issued) * 100)} % des bons émis sont réglés.`,
        action: (
          <Link href={`/${slug}/ipm/validations`} className="font-medium hover:text-brand">
            Validations
          </Link>
        ),
      }}
    >
      <div className="px-[15px] pt-3.5 pb-3">
        <FunnelChart
          height={112}
          stages={[
            { id: "issued", label: "Émis", value: issued, href: vouchersHref(slug) },
            {
              id: "presented",
              label: "Présentés",
              value: presented,
              href: vouchersHref(slug, { status: ["PRESENTED", "SETTLED", "INVOICED"] }),
            },
            {
              id: "settled",
              label: "Réglés",
              value: settled,
              href: vouchersHref(slug, { status: ["SETTLED", "INVOICED"] }),
            },
            {
              id: "invoiced",
              label: "Facturés",
              value: invoiced,
              href: vouchersHref(slug, { status: ["INVOICED"] }),
            },
          ]}
        />
      </div>
      <dl className="grid grid-cols-2 border-t border-line">
        {aside.map((entry, index) => (
          <Link
            key={entry.label}
            href={vouchersHref(slug, { status: [...entry.status] })}
            className={`flex items-center justify-between gap-2 border-line px-[15px] py-2 text-[12.5px] hover:bg-brand-wash ${index % 2 === 1 ? "border-l" : ""} ${index > 1 ? "border-t" : ""}`}
          >
            <dt className="text-ink-2">{entry.label}</dt>
            <dd>
              {entry.value === 0 ? (
                <span className="num text-ink-3">0</span>
              ) : (
                <StatusPill tone={entry.tone}>{formatNumber(entry.value)}</StatusPill>
              )}
            </dd>
          </Link>
        ))}
      </dl>
    </Panel>
  )
}

/* ========================================================================== */

async function CoveragePanel({ ctx }: { ctx: FirmContext }) {
  const mix = await beneficiaryMix(ctx)
  const dependents = mix.spouses + mix.children + mix.ascendants + mix.others
  const segments = [
    { id: "members", label: "Participants", value: mix.members, color: "var(--sx-brand)" },
    { id: "spouses", label: "Conjoints", value: mix.spouses, color: "var(--sx-dot-3)" },
    { id: "children", label: "Enfants", value: mix.children, color: "var(--sx-dot-4)" },
    {
      id: "ascendants",
      label: "Ascendants",
      value: mix.ascendants,
      color: "color-mix(in oklch, var(--sx-dot-3) 45%, var(--sx-brand-tint))",
    },
    { id: "others", label: "Autres", value: mix.others, color: "var(--sx-dot-7)" },
  ].filter((segment) => segment.value > 0 || segment.id === "members")

  return (
    <Panel
      title="Bénéficiaires couverts"
      description="Participants actifs et ayants droit, par lien."
      footer={{
        summary:
          mix.members === 0
            ? "Aucun participant actif."
            : `${formatChartValue(dependents / mix.members, "ratio")} ayant droit par participant.`,
        action: (
          <Link href={membersHref(ctx.firm.slug, { withDependents: true })} className="font-medium hover:text-brand">
            Familles
          </Link>
        ),
      }}
    >
      <DonutChart segments={segments} centerLabel="Bénéficiaires" size={136} />
    </Panel>
  )
}

/* ========================================================================== */

async function ProvidersPanel({ ctx }: { ctx: FirmContext }) {
  const providers = await topProviders(ctx, 6)
  const total = providers.reduce((sum, provider) => sum + provider.insurerShare, 0)

  return (
    <Panel
      title="Prestataires les plus sollicités"
      description="Part IPM engagée sur 12 mois."
      footer={{
        summary:
          providers.length === 0
            ? "Aucun bon émis sur la période."
            : `${providers[0].name} : ${formatNumber(providers[0].count)} bons.`,
        action: (
          <Link href={`/${ctx.firm.slug}/ipm/prestataires`} className="font-medium hover:text-brand">
            Prestataires
          </Link>
        ),
      }}
    >
      {providers.length === 0 ? (
        <p className="py-4 text-center text-[12.5px] text-ink-3">Rien à classer.</p>
      ) : (
        <HorizontalBars
          labelWidth={118}
          valueWidth={84}
          format="compact"
          rows={providers.map((provider, index) => ({
            id: provider.id,
            label: provider.name,
            value: provider.insurerShare,
            color:
              index === 0
                ? "var(--sx-brand)"
                : `color-mix(in oklch, var(--sx-brand) ${Math.max(35, 85 - index * 10)}%, var(--sx-brand-tint))`,
          }))}
        />
      )}
      {total > 0 ? (
        <p className="mt-2 text-[11.5px] text-ink-3">
          Ces {providers.length} prestataires totalisent {formatCurrencyCompact(total)}.
        </p>
      ) : null}
    </Panel>
  )
}

/* ========================================================================== */

/**
 * What is *missing* — participants with no cotisation, employers with no
 * barème, catégories with no taux. Each blocks a calculation, not just a
 * display, so the count is the work queue.
 */
async function GapsPanel({ ctx }: { ctx: FirmContext }) {
  const slug = ctx.firm.slug
  const [members, employers, plans, categories] = await Promise.all([
    memberSummary(ctx),
    listEmployers(ctx),
    listPlans(ctx),
    listCategories(ctx),
  ])

  const gaps = [
    {
      label: "Participants sans cotisation",
      count: members.withoutContribution,
      href: membersHref(slug),
      hint: "Rien ne leur sera facturé tant qu'aucun montant n'est ouvert.",
    },
    {
      label: "Employeurs sans barème",
      count: employers.filter((employer) => employer.planId === null && !employer.hasOwnRates).length,
      href: `/${slug}/ipm/employeurs`,
      hint: "Ni formule ni dérogation : aucune prise en charge calculable.",
    },
    {
      label: "Taux à saisir",
      count: plans.reduce((sum, plan) => sum + plan.missingCategoryIds.length, 0),
      href: `/${slug}/ipm/formules`,
      hint: `Sur ${formatNumber(categories.filter((category) => category.active).length)} catégories actives.`,
    },
  ]
  const outstanding = gaps.reduce((sum, gap) => sum + gap.count, 0)

  return (
    <Panel
      title="À compléter"
      description={
        outstanding === 0 ? "Rien ne manque." : "Chaque ligne empêche un calcul, pas seulement un affichage."
      }
      padded={false}
    >
      <ul>
        {gaps.map((gap) => (
          <li key={gap.label}>
            <Link
              href={gap.href}
              className="flex items-center gap-3 border-t border-line px-[15px] py-2.5 hover:bg-brand-wash"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{gap.label}</span>
                <span className="block truncate text-[11.5px] text-ink-3">{gap.hint}</span>
              </span>
              {gap.count === 0 ? (
                <StatusPill tone="ok">Rien à faire</StatusPill>
              ) : (
                <StatusPill tone="alert">{formatNumber(gap.count)}</StatusPill>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
