import Link from "next/link"

import { Sparkline } from "@/components/charts"
import { cn } from "@/lib/utils"

export type KpiTile = {
  label: string
  value: string
  /** Small text after the figure: `par mois`, `sur 12 mois`. */
  unit?: string
  /** One pill under the figure: a delta, or the part of it that matters. */
  delta?: { label: string; tone: "ok" | "signal" | "alert" | "muted" }
  /** The figure's last months, oldest first — drawn as a filled sparkline. */
  trend?: number[]
  trendTone?: "brand" | "alert" | "ok"
  href?: string
}

const DELTA_TONE: Record<NonNullable<KpiTile["delta"]>["tone"], string> = {
  ok: "bg-ok-tint text-ok",
  signal: "bg-signal-tint text-signal",
  alert: "bg-alert-tint text-alert",
  muted: "bg-sunken text-ink-2",
}

const COLUMNS: Record<number, string> = {
  3: "xl:grid-cols-3",
  4: "xl:grid-cols-4",
  5: "xl:grid-cols-5",
  6: "xl:grid-cols-6",
}

/**
 * The KPI row a dashboard opens on: figure, one pill, and the trend that
 * produced it. Every tile drills through to the list behind its number.
 *
 * The same anatomy as the HR dashboard's tiles, with the sparkline added
 * under each figure — a total without its direction is half a KPI. Divided by
 * hairlines drawn as the grid's gap, so any tile count wraps cleanly.
 */
export function KpiStrip({ tiles }: { tiles: KpiTile[] }) {
  return (
    <dl
      className={cn(
        "grid gap-px border-t border-line bg-line sm:grid-cols-2",
        COLUMNS[tiles.length] ?? "xl:grid-cols-4"
      )}
    >
      {tiles.map((tile) => {
        const body = (
          <>
            <dt className="text-xs text-ink-2">{tile.label}</dt>
            <dd className="num mt-1 text-[24px] leading-none font-semibold tracking-[-0.028em]">
              {tile.value}
              {tile.unit ? (
                <span className="ml-1 text-[12px] font-normal tracking-normal text-ink-3">
                  {tile.unit}
                </span>
              ) : null}
            </dd>
            <dd className="mt-1.5 h-[18px]">
              {tile.delta ? (
                <span
                  className={cn(
                    "num inline-flex rounded-md px-1.5 py-px text-[11px] font-medium",
                    DELTA_TONE[tile.delta.tone]
                  )}
                >
                  {tile.delta.label}
                </span>
              ) : null}
            </dd>
            {tile.trend && tile.trend.length > 1 ? (
              <dd className="mt-2 -mx-0.5">
                <Sparkline
                  data={tile.trend}
                  tone={tile.trendTone ?? "brand"}
                  width="100%"
                  height={30}
                  fill
                />
              </dd>
            ) : null}
          </>
        )
        const className = "block bg-surface px-4 pt-3.5 pb-3"
        return tile.href ? (
          <Link key={tile.label} href={tile.href} className={cn(className, "hover:bg-brand-wash")}>
            {body}
          </Link>
        ) : (
          <div key={tile.label} className={className}>
            {body}
          </div>
        )
      })}
    </dl>
  )
}
