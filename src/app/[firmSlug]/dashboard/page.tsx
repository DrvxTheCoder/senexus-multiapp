import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"
import { format } from "date-fns"
import { fr } from "date-fns/locale"

import {
  AreaChart,
  BandChart,
  HorizontalBars,
  StackedBars,
} from "@/components/charts"
import { Panel, type PanelStat } from "@/components/panel"
import { StatusPill, TagCode } from "@/components/primitives"
import { TopBar } from "@/components/shell/top-bar"
import { clientDotVar } from "@/lib/client-color"
import { formatCurrencyCompact, formatDays, formatNumber } from "@/lib/format"
import { contractsHref } from "@/lib/queries/contract-params"
import { employeesHref } from "@/lib/queries/employee-params"
import { requireFirmPage } from "@/server/auth/firm-page"
import type { FirmContext } from "@/server/auth/require-firm-access"
import {
  INTERIM_CEILING_DAYS,
  INTERIM_WARNING_DAYS,
} from "@/server/domain/interim-ceiling"
import {
  getCeilingBands,
  getContractMix,
  getExpirySchedule,
  getHeadcountTrend,
  getKpis,
  getPlacementsByClient,
} from "@/server/queries/dashboard"
import { listDecisions } from "@/server/queries/decisions"

export const metadata: Metadata = { title: "Tableau de bord" }

/**
 * §5.3 — the dashboard.
 *
 * Every panel is an independent SQL aggregate behind its own Suspense boundary,
 * so a slow one cannot hold up the rest, and **no panel fetches rows**. Every
 * number drills through to the list that produced it, as a pre-filtered URL
 * built by the same serialiser those lists parse — so the count on the tile and
 * the count on the list cannot disagree.
 */
export default async function DashboardPage({
  params,
}: PageProps<"/[firmSlug]/dashboard">) {
  const { firmSlug } = await params
  const ctx = await requireFirmPage(firmSlug)

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/dashboard`}
        crumbs={[{ label: ctx.firm.name }, { label: "Tableau de bord" }]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1420px] p-4.5">
          <div className="mb-3.5 flex items-center gap-3">
            <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
              Tableau de bord
            </h1>
          </div>

          <Suspense fallback={<PanelSkeleton height={150} />}>
            <OverviewPanel ctx={ctx} />
          </Suspense>

          <div className="mt-3.5 grid items-start gap-3.5 xl:grid-cols-[minmax(0,1.62fr)_minmax(0,1fr)]">
            <div className="flex flex-col gap-3.5">
              <Suspense fallback={<PanelSkeleton height={250} />}>
                <HeadcountPanel ctx={ctx} />
              </Suspense>
              <Suspense fallback={<PanelSkeleton height={230} />}>
                <ExpiryPanel ctx={ctx} />
              </Suspense>
              <Suspense fallback={<PanelSkeleton height={230} />}>
                <ClientsPanel ctx={ctx} />
              </Suspense>
            </div>

            <div className="flex flex-col gap-3.5">
              <Suspense fallback={<PanelSkeleton height={290} />}>
                <CeilingPanel ctx={ctx} />
              </Suspense>
              <Suspense fallback={<PanelSkeleton height={290} />}>
                <DecisionsPanel ctx={ctx} />
              </Suspense>
              <Suspense fallback={<PanelSkeleton height={180} />}>
                <MixPanel ctx={ctx} />
              </Suspense>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

/* ========================================================================== */

async function OverviewPanel({ ctx }: { ctx: FirmContext }) {
  const [kpis, trend] = await Promise.all([getKpis(ctx), getHeadcountTrend(ctx)])
  const slug = ctx.firm.slug

  const cards: {
    label: string
    value: string
    unit?: string
    delta?: number
    deltaSuffix?: string
    tone: "ok" | "signal" | "alert"
    href: string
  }[] = [
    {
      label: "Effectif actif",
      value: formatNumber(kpis.headcount),
      delta: kpis.headcountDelta,
      deltaSuffix: "sur 90 j",
      tone: "ok",
      href: employeesHref(slug, { status: ["ACTIVE"] }),
    },
    {
      label: "Contrats à échéance",
      value: formatNumber(kpis.expiringSoon),
      unit: "sous 90 j",
      delta: kpis.expiringDelta,
      deltaSuffix: "sous 30 j",
      tone: "signal",
      href: contractsHref(slug, { status: ["ACTIVE"], expiringWithin: 90 }),
    },
    {
      label: "Masse salariale",
      value: formatCurrencyCompact(kpis.monthlyPayroll),
      unit: "par mois",
      tone: "ok",
      href: employeesHref(slug, { status: ["ACTIVE"] }),
    },
    {
      label: `Dépassements ${INTERIM_CEILING_DAYS} j`,
      value: formatNumber(kpis.overCeiling),
      unit: "employés",
      tone: kpis.overCeiling > 0 ? "alert" : "ok",
      href: employeesHref(slug, {
        contractType: ["INTERIM"],
        interimDaysMin: INTERIM_CEILING_DAYS,
      }),
    },
  ]

  const hired = trend.reduce((sum, point) => sum + point.hired, 0)
  const left = trend.reduce((sum, point) => sum + point.left, 0)

  return (
    <Panel
      title="Vue d'ensemble de l'effectif"
      description="Effectif, charge contractuelle et exposition légale en un coup d'œil."
      padded={false}
      footer={{
        summary: `${formatNumber(hired)} entrées, ${formatNumber(left)} sorties, ${formatNumber(kpis.headcount)} employés aujourd'hui.`,
        action: (
          <Link
            href={employeesHref(slug, { status: ["ACTIVE"] })}
            className="font-medium hover:text-brand"
          >
            Voir l'effectif
          </Link>
        ),
      }}
    >
      <dl className="grid border-t border-line sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="border-l border-line px-4 py-3.5 first:border-l-0 hover:bg-brand-wash sm:nth-[3]:border-l-0 xl:nth-[3]:border-l"
          >
            <dt className="text-xs text-ink-2">{card.label}</dt>
            <dd className="num mt-1 text-[26px] leading-none font-semibold tracking-[-0.028em]">
              {card.value}
              {card.unit ? (
                <span className="ml-1 text-[12.5px] font-normal tracking-normal text-ink-3">
                  {card.unit}
                </span>
              ) : null}
            </dd>
            {card.delta !== undefined ? (
              <span
                className={`num mt-1.5 inline-flex rounded-md px-1.5 py-px text-[11px] font-medium ${
                  card.tone === "alert"
                    ? "bg-alert-tint text-alert"
                    : card.tone === "signal"
                      ? "bg-signal-tint text-signal"
                      : "bg-ok-tint text-ok"
                }`}
              >
                {card.delta >= 0 ? "+" : "−"}
                {formatNumber(Math.abs(card.delta))} {card.deltaSuffix}
              </span>
            ) : null}
          </Link>
        ))}
      </dl>
    </Panel>
  )
}

/* ========================================================================== */

async function HeadcountPanel({ ctx }: { ctx: FirmContext }) {
  const trend = await getHeadcountTrend(ctx)
  const hired = trend.reduce((sum, point) => sum + point.hired, 0)
  const left = trend.reduce((sum, point) => sum + point.left, 0)
  const today = trend.at(-1)?.headcount ?? 0
  const net = trend.length ? today - trend[0].headcount : 0
  const turnover = today > 0 ? (left / today) * 100 : 0

  const stats: PanelStat[] = [
    { label: "Aujourd'hui", value: formatNumber(today) },
    { label: "Net 12 m", value: `${net >= 0 ? "+" : "−"}${formatNumber(Math.abs(net))}` },
    { label: "Rotation", value: `${turnover.toFixed(1).replace(".", ",")} %` },
  ]

  return (
    <Panel
      title="Évolution de l'effectif"
      description="Entrées contre sorties, douze derniers mois."
      stats={stats}
      footer={{
        summary: `${formatNumber(hired)} entrées et ${formatNumber(left)} sorties sur la période.`,
      }}
    >
      <div className="pt-1">
        <AreaChart
          data={trend.map((point) => point.headcount)}
          labels={trend.map((point) => format(point.month, "MMM", { locale: fr }))}
        />
      </div>
    </Panel>
  )
}

/* ========================================================================== */

async function ExpiryPanel({ ctx }: { ctx: FirmContext }) {
  const schedule = await getExpirySchedule(ctx)
  const total = schedule.reduce((sum, entry) => sum + entry.interim + entry.other, 0)
  const peak = schedule.reduce(
    (best, entry) =>
      entry.interim + entry.other > best.interim + best.other ? entry : best,
    schedule[0] ?? { month: new Date(), interim: 0, other: 0 }
  )

  return (
    <Panel
      title="Échéances de contrats"
      description="Six prochains mois, intérim contre autres types."
      tools={
        <div className="flex gap-3 text-[11.5px] text-ink-2">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-[2px] bg-brand" aria-hidden />
            Intérim
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-[2px] bg-brand-tint" aria-hidden />
            Autres
          </span>
        </div>
      }
      footer={{
        summary:
          total === 0
            ? "Aucune échéance sur les six prochains mois."
            : `Pic de ${formatNumber(peak.interim + peak.other)} échéances en ${format(peak.month, "MMMM", { locale: fr })}.`,
        action: (
          <Link
            href={contractsHref(ctx.firm.slug, {
              status: ["ACTIVE"],
              expiringWithin: 180,
            })}
            className="font-medium hover:text-brand"
          >
            Ouvrir les contrats
          </Link>
        ),
      }}
    >
      <div className="pt-2">
        <StackedBars
          data={schedule.map((entry) => ({
            label: format(entry.month, "MMM", { locale: fr }),
            segments: [
              { value: entry.other, tone: "var(--sx-brand-tint)" },
              { value: entry.interim, tone: "var(--sx-brand)" },
            ],
          }))}
        />
      </div>
    </Panel>
  )
}

/* ========================================================================== */

async function ClientsPanel({ ctx }: { ctx: FirmContext }) {
  const placements = await getPlacementsByClient(ctx)
  const total = placements.reduce((sum, entry) => sum + entry.placed, 0)
  const top = placements[0]

  return (
    <Panel
      title="Effectif placé par client"
      description="Concentration du portefeuille."
      stats={[
        { label: "Clients", value: formatNumber(placements.length) },
        { label: "Placés", value: formatNumber(total) },
      ]}
      footer={{
        summary: top
          ? `${top.name} concentre ${Math.round(top.share * 100)} % de l'effectif placé.`
          : "Aucun employé placé.",
        action: ctx.firm.modules.includes("crm") ? (
          <Link
            href={`/${ctx.firm.slug}/crm/clients`}
            className="font-medium hover:text-brand"
          >
            Voir les clients
          </Link>
        ) : null,
      }}
    >
      <HorizontalBars
        rows={placements.map((entry) => ({
          id: entry.id,
          label: entry.name,
          value: entry.placed,
          suffix: `· ${Math.round(entry.share * 100)}%`,
          color: clientDotVar(entry.id),
        }))}
      />
    </Panel>
  )
}

/* ========================================================================== */

async function CeilingPanel({ ctx }: { ctx: FirmContext }) {
  const bands = await getCeilingBands(ctx)
  const over = bands.at(-1)?.count ?? 0
  const near = bands.at(-2)?.count ?? 0

  // The last two bands are the legal warning zone and the breach: ochre and red
  // are load-bearing here, not decorative.
  const colors = [
    "var(--sx-brand-tint)",
    "color-mix(in oklch, var(--sx-brand) 45%, var(--sx-brand-tint))",
    "var(--sx-brand)",
    "color-mix(in oklch, var(--sx-signal) 55%, var(--sx-signal-tint))",
    "var(--sx-signal)",
    "var(--sx-alert)",
  ]

  return (
    <Panel
      title="Exposition au plafond légal"
      description={`Répartition des jours cumulés sur ${INTERIM_CEILING_DAYS}.`}
      footer={{
        summary:
          over === 0
            ? `Aucun dépassement. ${formatNumber(near)} employés dans la zone d'alerte.`
            : `${formatNumber(over)} employé${over > 1 ? "s" : ""} en dépassement.`,
        action: (
          <Link
            href={employeesHref(ctx.firm.slug, {
              contractType: ["INTERIM"],
              interimDaysMin: INTERIM_WARNING_DAYS,
            })}
            className="font-medium hover:text-brand"
          >
            Traiter
          </Link>
        ),
      }}
    >
      <BandChart
        bands={bands.map((band, index) => ({
          label: band.label,
          count: band.count,
          color: colors[index],
          tone: index === 5 ? "alert" : index === 4 ? "signal" : undefined,
        }))}
      />
    </Panel>
  )
}

/* ========================================================================== */

async function DecisionsPanel({ ctx }: { ctx: FirmContext }) {
  const all = await listDecisions(ctx, 500)
  const shown = all.slice(0, 8)
  const urgent = all.filter((decision) => decision.tone === "alert").length

  return (
    <Panel
      title="Décisions en attente"
      description="Triées par urgence, puis par ancienneté."
      tools={
        all.length > 0 ? (
          <StatusPill tone={urgent > 0 ? "alert" : "signal"}>
            {formatNumber(all.length)}
          </StatusPill>
        ) : null
      }
      padded={false}
      footer={{
        summary:
          all.length === 0
            ? "Rien à traiter."
            : `${formatNumber(urgent)} urgentes sur ${formatNumber(all.length)}.`,
        action: (
          <Link
            href={`/${ctx.firm.slug}/decisions`}
            className="font-medium hover:text-brand"
          >
            Tout voir
          </Link>
        ),
      }}
    >
      {shown.length === 0 ? (
        <div className="border-t border-line px-[15px] py-8 text-center">
          <p className="text-[13px] font-semibold">File vide</p>
          <p className="mt-1 text-[12.5px] text-ink-3">
            Les nouvelles alertes apparaissent ici.
          </p>
        </div>
      ) : (
        <ul>
          {shown.map((decision) => (
            <li key={decision.id}>
              <Link
                href={decision.href}
                className="flex items-center gap-2.5 border-t border-line px-[15px] py-2 hover:bg-brand-wash"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">{decision.title}</span>
                  <span className="block truncate text-[11.5px] text-ink-3">
                    {decision.category} · {decision.detail}
                  </span>
                </span>
                <span
                  className={`num shrink-0 text-[11.5px] ${
                    decision.tone === "alert" ? "font-medium text-alert" : "text-ink-3"
                  }`}
                >
                  {formatDays(decision.ageDays)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/* ========================================================================== */

async function MixPanel({ ctx }: { ctx: FirmContext }) {
  const mix = await getContractMix(ctx)
  const total = mix.reduce((sum, entry) => sum + entry.count, 0)
  const interim = mix.find((entry) => entry.type === "INTERIM")?.count ?? 0
  const widest = mix[0]?.count ?? 1

  return (
    <Panel
      title="Répartition par type"
      description={`${formatNumber(total)} contrats actifs.`}
      footer={{
        summary:
          total === 0
            ? "Aucun contrat actif."
            : `${Math.round((interim / total) * 100)} % de l'effectif est en intérim.`,
      }}
    >
      <div className="pt-1">
        {mix.map((entry) => (
          <div
            key={entry.type}
            className="grid items-center gap-2.5 py-1 text-[12.5px]"
            style={{ gridTemplateColumns: "92px 1fr 46px" }}
          >
            <TagCode>{entry.type}</TagCode>
            <Link
              href={contractsHref(ctx.firm.slug, {
                status: ["ACTIVE"],
                type: [entry.type as "CDI"],
              })}
              aria-label={`${entry.count} contrats ${entry.type}`}
              className="block"
            >
              <span
                className="block h-[15px] rounded-[3px] bg-brand transition-[width] duration-500"
                style={{ width: `${(entry.count / Math.max(1, widest)) * 100}%` }}
              />
            </Link>
            <span className="num text-right text-ink-2">{formatNumber(entry.count)}</span>
          </div>
        ))}
      </div>
    </Panel>
  )
}

/* ========================================================================== */

function PanelSkeleton({ height }: { height: number }) {
  return (
    <div
      aria-hidden
      className="animate-pulse rounded-panel border border-line bg-surface"
      style={{ height }}
    >
      <div className="border-b border-line px-[15px] py-3">
        <div className="h-2.5 w-40 rounded-sm bg-sunken" />
        <div className="mt-2 h-2 w-64 rounded-sm bg-sunken/70" />
      </div>
    </div>
  )
}
