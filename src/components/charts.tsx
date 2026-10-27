"use client"

import * as React from "react"
import Link from "next/link"

import {
  ChartTooltip,
  DURATION,
  EASE,
  TooltipRow,
  TooltipTitle,
  useReveal,
} from "@/components/chart-primitives"
import { formatChartValue, type ChartFormat } from "@/lib/chart-format"
import { cn } from "@/lib/utils"
import { formatNumber } from "@/lib/format"

/**
 * §4.6 — the chart vocabulary.
 *
 * Inline SVG rather than a charting library: these are a handful of simple
 * shapes and a library would ship ~100kB to the browser to draw a sparkline.
 * Everything reads design tokens, so a firm's brand colour flows through
 * automatically and dark mode needs no second palette.
 *
 * They are client components because they answer the pointer: a crosshair that
 * tracks the cursor, a tooltip that names the value under it, siblings that
 * fade back so the one being read stands forward.
 *
 * Every chart draws its **real values** in the markup and carries a
 * `data-reveal-*` attribute on the marks that animate. The mount reveal is
 * applied over the top by CSS (see globals.css) rather than by rendering a
 * zeroed chart and growing it, so a chart is correct on the server, before
 * hydration, and with scripts off — the animation is the enhancement, never
 * the thing that makes the numbers appear.
 *
 * Accessibility: the drawing is decorative, because the numbers it visualises
 * are always present as text beside it, so the SVG is aria-hidden and the
 * surrounding markup carries the meaning. Hover is never the only way to reach
 * a value.
 */

/** Non-active marks fade to this. Enough to recede, not enough to vanish. */
const FADED = 0.32

/* -------------------------------------------------------------------------- */

export function Sparkline({
  data,
  tone = "brand",
  width = 84,
  height = 28,
  fill = false,
}: {
  data: number[]
  tone?: "brand" | "signal" | "alert" | "ok"
  /** A number, or "100%" to follow the container. */
  width?: number | string
  height?: number
  /** Washes the area under the line, fading to nothing at the baseline. */
  fill?: boolean
}) {
  const ref = useReveal<SVGSVGElement>()
  const gradientId = `sx-spark-${React.useId().replace(/:/g, "")}`

  if (data.length < 2) return null

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  const coordinates = data.map((value, index) => ({
    x: (index / (data.length - 1)) * 100,
    y: 28 - ((value - min) / range) * 24 - 2,
  }))
  const points = coordinates
    .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(" ")

  return (
    <svg
      ref={ref}
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      style={{ width, height }}
      className="shrink-0"
      aria-hidden
    >
      {fill ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={`var(--sx-${tone})`} stopOpacity="0.2" />
              <stop offset="100%" stopColor={`var(--sx-${tone})`} stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon
            data-reveal-fade
            points={`0,28 ${points} 100,28`}
            fill={`url(#${gradientId})`}
            style={{ transition: `opacity ${DURATION}ms ${EASE}` }}
          />
        </>
      ) : null}
      <polyline
        data-reveal-line
        points={points}
        fill="none"
        stroke={`var(--sx-${tone})`}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        // Drawn on, left to right, by paying out the dash.
        style={{
          strokeDasharray: 240,
          strokeDashoffset: 0,
          transition: `stroke-dashoffset ${DURATION}ms ${EASE}`,
        }}
      />
    </svg>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * The area chart. A vertical crosshair follows the cursor, snapping to the
 * nearest month; the dot rides the line at that month and the tooltip names it.
 */
export function AreaChart({
  data,
  labels,
  tickLabels,
  height = 150,
  valueLabel = "Effectif",
}: {
  data: number[]
  /** Full names, for the tooltip. */
  labels: string[]
  /** Short names for the axis; falls back to `labels`. */
  tickLabels?: string[]
  height?: number
  valueLabel?: string
}) {
  const ticks = tickLabels ?? labels
  const ref = useReveal<HTMLDivElement>()
  const [active, setActive] = React.useState<number | null>(null)

  const W = 600
  const H = height
  const pad = 20

  const geometry = React.useMemo(() => {
    if (data.length < 2) return null
    const min = Math.min(...data) - 12
    const max = Math.max(...data) + 8
    const range = max - min || 1
    const x = (index: number) => (index / (data.length - 1)) * W
    const y = (value: number) => H - pad - ((value - min) / range) * (H - pad * 1.6)
    const line = data
      .map(
        (value, index) =>
          `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`
      )
      .join(" ")
    return { x, y, line, area: `${line} L${W},${H} L0,${H} Z` }
  }, [data, H])

  if (!geometry) return null
  const { x, y, line, area } = geometry
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => H - pad - f * (H - pad * 1.6))

  /** Snap the pointer to the nearest month. */
  const track = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - box.left) / box.width
    setActive(
      Math.max(0, Math.min(data.length - 1, Math.round(ratio * (data.length - 1))))
    )
  }

  const shownIndex = active ?? data.length - 1
  const activeX = (x(shownIndex) / W) * 100

  return (
    <div ref={ref}>
      <div
        className="relative"
        onPointerMove={track}
        onPointerLeave={() => setActive(null)}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={{ width: "100%", height, display: "block" }}
          aria-hidden
        >
          <defs>
            <linearGradient id="sx-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--sx-brand)" stopOpacity="0.16" />
              <stop offset="100%" stopColor="var(--sx-brand)" stopOpacity="0" />
            </linearGradient>
            {/* The reveal: a wipe that uncovers the drawing left to right. */}
            <clipPath id="sx-area-clip">
              <rect
                data-reveal-clip
                x="0"
                y="0"
                height={H}
                width={W}
                style={{ transition: `width ${DURATION}ms ${EASE}` }}
              />
            </clipPath>
          </defs>

          {grid.map((gy, index) => (
            <line
              key={index}
              x1="0"
              y1={gy}
              x2={W}
              y2={gy}
              stroke="var(--sx-line)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          <g clipPath="url(#sx-area-clip)">
            <path d={area} fill="url(#sx-area)" />
            <path
              d={line}
              fill="none"
              stroke="var(--sx-brand)"
              strokeWidth="1.8"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>

          {/* Crosshair, only while the pointer is over the plot. */}
          {active !== null ? (
            <line
              x1={x(active)}
              y1={pad * 0.4}
              x2={x(active)}
              y2={H}
              stroke="var(--sx-line-2)"
              strokeWidth="1"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}

          {/* The dot rides the line: the last point at rest, the cursor's on hover. */}
          <circle
            data-reveal-dot
            cx={x(shownIndex)}
            cy={y(data[shownIndex])}
            r={active === null ? 3.2 : 4.2}
            fill="var(--sx-brand)"
            stroke="var(--sx-surface)"
            strokeWidth="1.6"
            vectorEffect="non-scaling-stroke"
            style={{
              opacity: 1,
              transition: `opacity 220ms linear ${DURATION * 0.7}ms, r 120ms ${EASE}`,
            }}
          />
        </svg>

        {/* Placed on the side of the curve with room for it: a tooltip that
            rides the line hides the very data it describes. When the point sits
            high in the plot the panel drops below it, and vice versa. */}
        {active !== null ? (
          <ChartTooltip
            x={activeX}
            y={(y(data[active]) / H) * 100 < 45 ? 78 : 12}
            flip={activeX > 68}
          >
            <TooltipTitle>{labels[active]}</TooltipTitle>
            <TooltipRow
              swatch="var(--sx-brand)"
              label={valueLabel}
              value={formatNumber(data[active])}
            />
          </ChartTooltip>
        ) : null}
      </div>

      <div className="mt-1.5 flex justify-between">
        {ticks.map((label, index) => (
          <span
            key={index}
            aria-hidden
            className={cn(
              "flex-1 text-center text-[10.5px] transition-colors duration-150",
              index === active ? "font-medium text-ink" : "text-ink-3"
            )}
          >
            {index % 2 === 0 || index === active ? label : ""}
          </span>
        ))}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Stacked columns. Hovering a column brings it forward and fades its
 * neighbours; the tooltip breaks the stack into its named segments.
 */
export function StackedBars({
  data,
  height = 118,
  segmentLabels = [],
}: {
  data: { label: string; segments: { value: number; tone: string }[] }[]
  height?: number
  /** Names for the tooltip, in the same order as `segments`. */
  segmentLabels?: string[]
}) {
  const ref = useReveal<HTMLDivElement>()
  const [active, setActive] = React.useState<number | null>(null)

  const max = Math.max(
    1,
    ...data.map((entry) => entry.segments.reduce((sum, item) => sum + item.value, 0))
  )
  const stagger = data.length > 0 ? Math.min(60, 420 / data.length) : 0

  return (
    <div
      ref={ref}
      className="relative flex items-end gap-2.5"
      style={{ height }}
      onPointerLeave={() => setActive(null)}
    >
      {data.map((entry, index) => {
        const total = entry.segments.reduce((sum, segment) => sum + segment.value, 0)
        const dim = active !== null && active !== index

        return (
          <div
            key={entry.label}
            className="flex flex-1 flex-col items-center justify-end gap-1.5"
            onPointerEnter={() => setActive(index)}
            style={{ opacity: dim ? FADED : 1, transition: "opacity 180ms linear" }}
          >
            <span
              className={cn(
                "num text-[11.5px] transition-colors duration-150",
                index === active ? "font-semibold text-brand" : "font-medium"
              )}
            >
              {formatNumber(total)}
            </span>
            <div
              data-reveal-column
              className="flex w-full flex-col justify-end overflow-hidden rounded-t-[3px]"
              style={{
                height: `${(total / max) * (height - 34)}px`,
                transition: `height ${DURATION}ms ${EASE} ${index * stagger}ms`,
              }}
            >
              {entry.segments.map((segment, segmentIndex) =>
                segment.value === 0 ? null : (
                  <div
                    key={segmentIndex}
                    style={{
                      height: `${(segment.value / total) * 100}%`,
                      background: segment.tone,
                    }}
                  />
                )
              )}
            </div>
            <span
              className={cn(
                "text-[11px] transition-colors duration-150",
                index === active ? "text-ink" : "text-ink-3"
              )}
            >
              {entry.label}
            </span>
          </div>
        )
      })}

      {active !== null ? (
        <ChartTooltip
          x={((active + 0.5) / data.length) * 100}
          flip={(active + 0.5) / data.length > 0.68}
        >
          <TooltipTitle>{data[active].label}</TooltipTitle>
          {data[active].segments.map((segment, index) => (
            <TooltipRow
              key={index}
              swatch={segment.tone}
              label={segmentLabels[index] ?? `Série ${index + 1}`}
              value={formatNumber(segment.value)}
            />
          ))}
        </ChartTooltip>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Horizontal bars, one row per item. The whole row is the hit target — hovering
 * anywhere on it brings the bar forward and fades the rest.
 */
export function HorizontalBars({
  rows,
  labelWidth = 130,
  valueWidth = 60,
  format = "number",
}: {
  rows: {
    id: string
    label: string
    value: number
    suffix?: string
    color?: string
  }[]
  labelWidth?: number
  valueWidth?: number
  format?: ChartFormat
}) {
  const ref = useReveal<HTMLDivElement>()
  const [active, setActive] = React.useState<string | null>(null)

  const max = Math.max(1, ...rows.map((row) => row.value))
  const stagger = rows.length > 0 ? Math.min(50, 400 / rows.length) : 0

  return (
    <div ref={ref} className="pt-1" onPointerLeave={() => setActive(null)}>
      {rows.map((row, index) => {
        const isActive = active === row.id
        const dim = active !== null && !isActive

        return (
          <div
            key={row.id}
            className="grid items-center gap-2.5 rounded-[5px] py-1 text-[12.5px]"
            style={{
              gridTemplateColumns: `${labelWidth}px 1fr ${valueWidth}px`,
              opacity: dim ? FADED : 1,
              background: isActive ? "var(--sx-brand-wash)" : "transparent",
              transition: "opacity 180ms linear, background-color 150ms linear",
            }}
            onPointerEnter={() => setActive(row.id)}
          >
            <span
              className={cn(
                "truncate pl-1 transition-colors duration-150",
                isActive ? "text-ink" : "text-ink-2"
              )}
            >
              {row.label}
            </span>
            <span className="block">
              <span
                data-reveal-bar
                className="block h-[15px] rounded-[3px]"
                style={{
                  width: `${(row.value / max) * 100}%`,
                  background: row.color ?? "var(--sx-brand)",
                  transition: `width ${DURATION}ms ${EASE} ${index * stagger}ms`,
                }}
              />
            </span>
            <span
              className={cn(
                "num pr-1 text-right transition-colors duration-150",
                isActive ? "font-medium text-ink" : "text-ink-2"
              )}
            >
              {formatChartValue(row.value, format)}
              {row.suffix ? (
                <span className="text-[11px] text-ink-3"> {row.suffix}</span>
              ) : null}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Bars whose rows are drill-throughs. Same instrument as HorizontalBars, but
 * each row is a link and the caller supplies the leading cell (a tag, a code)
 * rather than a plain label.
 */
export function LinkedBars({
  rows,
  labelWidth = 92,
}: {
  rows: {
    id: string
    lead: React.ReactNode
    label: string
    value: number
    href: string
  }[]
  labelWidth?: number
}) {
  const ref = useReveal<HTMLDivElement>()
  const [active, setActive] = React.useState<string | null>(null)

  const max = Math.max(1, ...rows.map((row) => row.value))
  const stagger = rows.length > 0 ? Math.min(50, 400 / rows.length) : 0

  return (
    <div ref={ref} className="pt-1" onPointerLeave={() => setActive(null)}>
      {rows.map((row, index) => {
        const isActive = active === row.id
        const dim = active !== null && !isActive

        return (
          <a
            key={row.id}
            href={row.href}
            aria-label={`${row.value} contrats ${row.label}`}
            onPointerEnter={() => setActive(row.id)}
            onFocus={() => setActive(row.id)}
            onBlur={() => setActive(null)}
            className="grid items-center gap-2.5 rounded-[5px] py-1 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-brand"
            style={{
              gridTemplateColumns: `${labelWidth}px 1fr 46px`,
              opacity: dim ? FADED : 1,
              background: isActive ? "var(--sx-brand-wash)" : "transparent",
              transition: "opacity 180ms linear, background-color 150ms linear",
            }}
          >
            <span className="pl-1">{row.lead}</span>
            <span className="block">
              <span
                data-reveal-bar
                className="block h-[15px] rounded-[3px] bg-brand"
                style={{
                  width: `${(row.value / max) * 100}%`,
                  transition: `width ${DURATION}ms ${EASE} ${index * stagger}ms`,
                }}
              />
            </span>
            <span
              className={cn(
                "num pr-1 text-right transition-colors duration-150",
                isActive ? "font-medium text-ink" : "text-ink-2"
              )}
            >
              {formatNumber(row.value)}
            </span>
          </a>
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * The banded distribution. Ochre and red are load-bearing here: the last two
 * bands are the legal warning zone and the breach.
 *
 * The ribbon and the legend are one instrument — hovering either half lights
 * the same band in both, so a thin slice of the ribbon stays readable by
 * pointing at its legend row instead.
 */
export function BandChart({
  bands,
}: {
  bands: { label: string; count: number; color: string; tone?: "signal" | "alert" }[]
}) {
  const ref = useReveal<HTMLDivElement>()
  const [active, setActive] = React.useState<string | null>(null)

  const total = bands.reduce((sum, band) => sum + band.count, 0)

  return (
    <div ref={ref} onPointerLeave={() => setActive(null)}>
      <div className="flex h-6 overflow-hidden rounded-md" aria-hidden>
        {bands.map((band) =>
          band.count === 0 ? null : (
            <div
              key={band.label}
              data-reveal-segment
              onPointerEnter={() => setActive(band.label)}
              style={{
                flexGrow: band.count,
                background: band.color,
                opacity: active !== null && active !== band.label ? FADED : 1,
                transition: `flex-grow ${DURATION}ms ${EASE}, opacity 180ms linear`,
              }}
            />
          )
        )}
      </div>

      <dl className="mt-2.5">
        {bands.map((band) => {
          const isActive = active === band.label
          return (
            <div
              key={band.label}
              onPointerEnter={() => setActive(band.label)}
              className={cn(
                "grid grid-cols-[1fr_auto_auto] items-center gap-2.5 border-b border-line",
                "px-1 py-1.5 text-[12.5px] last:border-b-0"
              )}
              style={{
                opacity: active !== null && !isActive ? FADED : 1,
                background: isActive ? "var(--sx-brand-wash)" : "transparent",
                transition: "opacity 180ms linear, background-color 150ms linear",
              }}
            >
              <dt className="inline-flex items-center gap-2 text-ink-2">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-[2px]"
                  style={{ background: band.color }}
                />
                {band.label}
              </dt>
              <dd
                className={cn(
                  "num font-medium",
                  band.tone === "alert" && "text-alert",
                  band.tone === "signal" && "text-signal"
                )}
              >
                {formatNumber(band.count)}
              </dd>
              <dd className="num w-9 text-right text-[11.5px] text-ink-3">
                {total === 0 ? "0" : Math.round((band.count / total) * 100)}%
              </dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}

/* ==========================================================================
 * The insight instruments — composed series, donut, rings, funnel, gauge,
 * calendar heatmap and diverging bars. Same contract as everything above:
 * real values in the markup, the reveal added over the top, tokens only, and
 * the numbers always present as text beside the drawing.
 *
 * Formatting crosses the server/client boundary as a name rather than a
 * function — a server component cannot hand a closure to a client one. The
 * names live in `@/lib/chart-format`, which both sides import.
 * ========================================================================== */

export type { ChartFormat }

/** Axis ticks: `1,2 M`, `850 k`, `40` — the unit is in the panel title. */
function axisValue(value: number, format: ChartFormat): string {
  if (format === "percent") return `${Math.round(value)} %`
  if (format === "ratio") return formatChartValue(value, "ratio")
  const abs = Math.abs(value)
  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M`
  }
  if (abs >= 1_000 && format !== "number") {
    return `${Math.round(value / 1_000).toLocaleString("fr-FR")} k`
  }
  return formatNumber(Math.round(value))
}

/** The next round number above `value`: 1, 2, 2.5 or 5 × 10ⁿ. */
function niceMax(value: number): number {
  if (value <= 0) return 1
  const exponent = 10 ** Math.floor(Math.log10(value))
  const fraction = value / exponent
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10
  return nice * exponent
}

/**
 * Monotone cubic interpolation (Fritsch–Carlson). Smooth like a spline but
 * never overshoots: a month at zero stays on the baseline instead of dipping
 * below it, which a Catmull-Rom curve would draw as a negative month.
 */
function monotonePath(points: [number, number][]): string {
  const n = points.length
  if (n === 0) return ""
  if (n === 1) return `M${points[0][0]},${points[0][1]}`
  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  const dx: number[] = []
  const slope: number[] = []
  for (let i = 0; i < n - 1; i += 1) {
    dx.push(xs[i + 1] - xs[i])
    slope.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i] || 1))
  }
  const tangent: number[] = new Array(n)
  tangent[0] = slope[0]
  tangent[n - 1] = slope[n - 2]
  for (let i = 1; i < n - 1; i += 1) {
    tangent[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2
  }
  for (let i = 0; i < n - 1; i += 1) {
    if (slope[i] === 0) {
      tangent[i] = 0
      tangent[i + 1] = 0
      continue
    }
    const a = tangent[i] / slope[i]
    const b = tangent[i + 1] / slope[i]
    const s = a * a + b * b
    if (s > 9) {
      const k = 3 / Math.sqrt(s)
      tangent[i] = k * a * slope[i]
      tangent[i + 1] = k * b * slope[i]
    }
  }
  let d = `M${xs[0].toFixed(1)},${ys[0].toFixed(1)}`
  for (let i = 0; i < n - 1; i += 1) {
    const third = dx[i] / 3
    d += ` C${(xs[i] + third).toFixed(1)},${(ys[i] + tangent[i] * third).toFixed(1)} ${(xs[i + 1] - third).toFixed(1)},${(ys[i + 1] - tangent[i + 1] * third).toFixed(1)} ${xs[i + 1].toFixed(1)},${ys[i + 1].toFixed(1)}`
  }
  return d
}

/** A circle drawn as a stroke, measured in percent of its circumference. */
function ArcCircle({
  r,
  value,
  offset = 0,
  color,
  width,
  cap = "butt",
  reveal = true,
  delay = 0,
  style,
  ...rest
}: {
  r: number
  /** 0–100. */
  value: number
  /** 0–100, where along the circle the arc starts. */
  offset?: number
  color: string
  width: number
  cap?: "butt" | "round"
  reveal?: boolean
  delay?: number
} & Omit<React.SVGProps<SVGCircleElement>, "r" | "offset">) {
  return (
    <circle
      {...(reveal ? { "data-reveal-arc": true } : {})}
      cx="50"
      cy="50"
      r={r}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap={cap}
      pathLength={100}
      strokeDasharray={`${value} ${100 - value}`}
      strokeDashoffset={-offset}
      transform="rotate(-90 50 50)"
      style={{
        transition: `stroke-dasharray ${DURATION}ms ${EASE} ${delay}ms, stroke-width 160ms ${EASE}, opacity 180ms linear`,
        ...style,
      }}
      {...rest}
    />
  )
}

/* -------------------------------------------------------------------------- */

/** A legend for a chart whose series are named in the panel header. */
export function ChartLegend({
  items,
}: {
  items: { label: string; color: string; kind?: "bar" | "line" | "dashed" }[]
}) {
  return (
    <div className="flex flex-wrap gap-3 text-[11.5px] text-ink-2">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          {item.kind === "line" || item.kind === "dashed" ? (
            <span
              aria-hidden
              className="h-0 w-3"
              style={{
                borderTop: `2px ${item.kind === "dashed" ? "dashed" : "solid"} ${item.color}`,
              }}
            />
          ) : (
            <span
              aria-hidden
              className="size-2 rounded-[2px]"
              style={{ background: item.color }}
            />
          )}
          {item.label}
        </span>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export type ComposedSeries = {
  id: string
  label: string
  kind: "bar" | "area" | "line"
  color: string
  values: number[]
  dashed?: boolean
}

/**
 * Bars and curves on one time axis — bklit's composed chart, drawn in this
 * house's hand.
 *
 * The plot answers the pointer by **band**, not by pixel: the whole month is
 * the hit target, it washes behind the bars, a crosshair with fading ends
 * marks its centre, and the tooltip lists every series for that month. An
 * optional `difference` row turns two series into the figure the reader is
 * actually after — the month's surplus or deficit — signed and coloured.
 */
export function ComposedChart({
  labels,
  tickLabels,
  series,
  height = 210,
  format = "currency",
  difference,
}: {
  /** Full names, for the tooltip. */
  labels: string[]
  tickLabels?: string[]
  series: ComposedSeries[]
  height?: number
  format?: ChartFormat
  difference?: { label: string; plus: string; minus: string }
}) {
  const ref = useReveal<HTMLDivElement>()
  const uid = React.useId().replace(/:/g, "")
  const [active, setActive] = React.useState<number | null>(null)

  const n = labels.length
  const W = 600
  const H = height
  const top = 10
  const ticks = tickLabels ?? labels

  if (n === 0) return null

  const max = niceMax(Math.max(0, ...series.flatMap((entry) => entry.values)))
  const y = (value: number) => top + (1 - Math.max(0, value) / max) * (H - top)
  const band = W / n
  const cx = (index: number) => band * (index + 0.5)

  const bars = series.filter((entry) => entry.kind === "bar")
  const curves = series.filter((entry) => entry.kind !== "bar")
  const groupWidth = band * (bars.length > 1 ? 0.62 : 0.46)
  const barWidth = bars.length ? groupWidth / bars.length : 0
  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((fraction) => fraction * max)
  const stagger = Math.min(50, 420 / n)

  const track = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - box.left) / box.width
    setActive(Math.max(0, Math.min(n - 1, Math.floor(ratio * n))))
  }

  const dotIndex = active ?? n - 1
  const thin = n > 8

  return (
    <div ref={ref} className="flex gap-2">
      <div className="relative w-10 shrink-0" style={{ height: H }} aria-hidden>
        {gridValues.map((value) => (
          <span
            key={value}
            className="num absolute right-0 -translate-y-1/2 text-[10.5px] text-ink-3"
            style={{ top: `${(y(value) / H) * 100}%` }}
          >
            {axisValue(value, format)}
          </span>
        ))}
      </div>

      <div className="min-w-0 flex-1">
        <div
          className="relative"
          style={{ height: H }}
          onPointerMove={track}
          onPointerLeave={() => setActive(null)}
        >
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            style={{ width: "100%", height: H, display: "block", overflow: "visible" }}
            aria-hidden
          >
            <defs>
              {curves.map((entry) => (
                <linearGradient
                  key={entry.id}
                  id={`${uid}-${entry.id}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={entry.color} stopOpacity="0.22" />
                  <stop offset="100%" stopColor={entry.color} stopOpacity="0" />
                </linearGradient>
              ))}
              <linearGradient id={`${uid}-cross`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--sx-ink-3)" stopOpacity="0" />
                <stop offset="30%" stopColor="var(--sx-ink-3)" stopOpacity="0.7" />
                <stop offset="70%" stopColor="var(--sx-ink-3)" stopOpacity="0.7" />
                <stop offset="100%" stopColor="var(--sx-ink-3)" stopOpacity="0" />
              </linearGradient>
              <clipPath id={`${uid}-clip`}>
                <rect
                  data-reveal-clip
                  x="0"
                  y="-10"
                  height={H + 20}
                  width={W}
                  style={{ transition: `width ${DURATION}ms ${EASE}` }}
                />
              </clipPath>
            </defs>

            {gridValues.map((value) => (
              <line
                key={value}
                x1="0"
                x2={W}
                y1={y(value)}
                y2={y(value)}
                stroke="var(--sx-line)"
                strokeWidth="1"
                strokeDasharray={value === 0 ? undefined : "3 4"}
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {active !== null ? (
              <rect
                x={band * active}
                y={0}
                width={band}
                height={H}
                fill="var(--sx-brand-wash)"
              />
            ) : null}

            {bars.map((entry, barIndex) =>
              entry.values.map((value, index) => {
                const barTop = y(value)
                return (
                  <rect
                    key={`${entry.id}-${index}`}
                    data-reveal-rise
                    x={cx(index) - groupWidth / 2 + barIndex * barWidth + 1}
                    y={barTop}
                    width={Math.max(1, barWidth - 2)}
                    height={Math.max(0, H - barTop)}
                    rx="2"
                    fill={entry.color}
                    style={{
                      opacity: active !== null && active !== index ? FADED : 1,
                      transformBox: "fill-box",
                      transformOrigin: "bottom",
                      transition: `transform ${DURATION}ms ${EASE} ${index * stagger}ms, opacity 180ms linear`,
                    }}
                  />
                )
              })
            )}

            <g clipPath={`url(#${uid}-clip)`}>
              {curves.map((entry) => {
                const line = monotonePath(
                  entry.values.map((value, index) => [cx(index), y(value)])
                )
                return (
                  <g key={entry.id}>
                    {entry.kind === "area" ? (
                      <path
                        d={`${line} L${cx(n - 1)},${H} L${cx(0)},${H} Z`}
                        fill={`url(#${uid}-${entry.id})`}
                      />
                    ) : null}
                    <path
                      d={line}
                      fill="none"
                      stroke={entry.color}
                      strokeWidth="2"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      strokeDasharray={entry.dashed ? "5 4" : undefined}
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                )
              })}
            </g>

            {active !== null ? (
              <line
                x1={cx(active)}
                x2={cx(active)}
                y1={0}
                y2={H}
                stroke={`url(#${uid}-cross)`}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </svg>

          {/* Dots are HTML: in a stretched viewBox a circle draws as an oval. */}
          {curves.map((entry) => (
            <span
              key={entry.id}
              data-reveal-dot
              aria-hidden
              className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface"
              style={{
                left: `${(cx(dotIndex) / W) * 100}%`,
                top: `${(y(entry.values[dotIndex] ?? 0) / H) * 100}%`,
                background: entry.color,
                transition: `opacity 220ms linear ${DURATION * 0.7}ms, left 100ms ease-out, top 100ms ease-out`,
              }}
            />
          ))}

          {active !== null ? (
            <ChartTooltip x={(cx(active) / W) * 100} flip={cx(active) / W > 0.62}>
              <TooltipTitle>{labels[active]}</TooltipTitle>
              {series.map((entry) => (
                <TooltipRow
                  key={entry.id}
                  swatch={entry.color}
                  label={entry.label}
                  value={formatChartValue(entry.values[active] ?? 0, format)}
                />
              ))}
              {difference ? (
                <DifferenceRow
                  label={difference.label}
                  value={
                    (series.find((entry) => entry.id === difference.plus)?.values[active] ?? 0) -
                    (series.find((entry) => entry.id === difference.minus)?.values[active] ?? 0)
                  }
                  format={format}
                />
              ) : null}
            </ChartTooltip>
          ) : null}
        </div>

        <div className="mt-1.5 flex">
          {ticks.map((label, index) => (
            <span
              key={index}
              aria-hidden
              className={cn(
                "flex-1 text-center text-[10.5px] transition-colors duration-150",
                index === active ? "font-medium text-ink" : "text-ink-3"
              )}
            >
              {!thin || index % 2 === (n - 1) % 2 || index === active ? label : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function DifferenceRow({
  label,
  value,
  format,
}: {
  label: string
  value: number
  format: ChartFormat
}) {
  return (
    <div className="mt-1 border-t border-line pt-1">
      <TooltipRow
        label={label}
        value={
          <span className={value < 0 ? "text-alert" : "text-ok"}>
            {value > 0 ? "+" : value < 0 ? "−" : ""}
            {formatChartValue(Math.abs(value), format)}
          </span>
        }
      />
    </div>
  )
}

/** The figure in a ring's hole, stepped down when it would spill out of it. */
function CenterFigure({ value }: { value: string }) {
  return (
    <div
      className={cn(
        "num leading-tight font-semibold tracking-[-0.02em]",
        value.length > 9 ? "text-[13.5px]" : value.length > 6 ? "text-[16px]" : "text-[19px]"
      )}
    >
      {value}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export type DonutSegment = {
  id: string
  label: string
  value: number
  color: string
  href?: string
}

/**
 * Parts of a whole. The ring and its legend are one instrument: pointing at a
 * slice or at its row thickens the slice, fades the rest, and puts that slice
 * in the centre — so a sliver too thin to aim at is reached through its row.
 */
export function DonutChart({
  segments,
  centerLabel = "Total",
  format = "number",
  size = 148,
}: {
  segments: DonutSegment[]
  centerLabel?: string
  format?: ChartFormat
  size?: number
}) {
  const ref = useReveal<HTMLDivElement>()
  const [active, setActive] = React.useState<string | null>(null)

  const total = segments.reduce((sum, segment) => sum + segment.value, 0)
  const width = 13
  const r = 50 - width / 2 - 2.5
  const gap = segments.filter((segment) => segment.value > 0).length > 1 ? 0.7 : 0

  const shareOf = (value: number) => (total === 0 ? 0 : (value / total) * 100)
  const arcs = segments.map((segment, index) => ({
    segment,
    index,
    share: shareOf(segment.value),
    // Where this slice starts: the sum of the slices before it.
    offset: segments.slice(0, index).reduce((sum, previous) => sum + shareOf(previous.value), 0),
  }))

  const shown = segments.find((segment) => segment.id === active)
  const max = Math.max(1, ...segments.map((segment) => segment.value))

  return (
    <div
      ref={ref}
      className="flex flex-col items-center gap-4 sm:flex-row sm:items-center"
      onPointerLeave={() => setActive(null)}
    >
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="size-full" aria-hidden>
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--sx-sunken)" strokeWidth={width} />
          {arcs.map(({ segment, share, offset: start, index }) =>
            share === 0 ? null : (
              <ArcCircle
                key={segment.id}
                r={r}
                value={Math.max(0, share - gap)}
                offset={start}
                color={segment.color}
                width={active === segment.id ? width + 3 : width}
                delay={index * 60}
                onPointerEnter={() => setActive(segment.id)}
                style={{ opacity: active !== null && active !== segment.id ? FADED : 1 }}
              />
            )
          )}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div data-reveal-fade style={{ transition: `opacity 400ms linear ${DURATION * 0.6}ms` }}>
            <CenterFigure value={formatChartValue(shown ? shown.value : total, format)} />
            <div className="mx-auto max-w-[96px] truncate text-[11px] text-ink-3">
              {shown
                ? `${shown.label} · ${total === 0 ? 0 : Math.round((shown.value / total) * 100)} %`
                : centerLabel}
            </div>
          </div>
        </div>
      </div>

      <ul className="w-full min-w-0 flex-1">
        {segments.map((segment) => {
          const isActive = active === segment.id
          const share = total === 0 ? 0 : Math.round((segment.value / total) * 100)
          const body = (
            <>
              <span className="flex items-center gap-2 text-[12.5px]">
                <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: segment.color }} />
                <span className={cn("min-w-0 flex-1 truncate", isActive ? "text-ink" : "text-ink-2")}>
                  {segment.label}
                </span>
                <span className="num font-medium">{formatChartValue(segment.value, format)}</span>
                <span className="num w-9 text-right text-[11.5px] text-ink-3">{share} %</span>
              </span>
              <span className="mt-1 ml-4 block h-[3px] overflow-hidden rounded-full bg-sunken">
                <span
                  data-reveal-bar
                  className="block h-full rounded-full"
                  style={{
                    width: `${(segment.value / max) * 100}%`,
                    background: segment.color,
                    transition: `width ${DURATION}ms ${EASE}`,
                  }}
                />
              </span>
            </>
          )
          const rowClass = "block rounded-[5px] px-1.5 py-1.5"
          const rowStyle = {
            opacity: active !== null && !isActive ? FADED : 1,
            background: isActive ? "var(--sx-brand-wash)" : "transparent",
            transition: "opacity 180ms linear, background-color 150ms linear",
          }
          return (
            <li key={segment.id} onPointerEnter={() => setActive(segment.id)}>
              {segment.href ? (
                <Link
                  href={segment.href}
                  className={cn(rowClass, "outline-none focus-visible:ring-2 focus-visible:ring-brand")}
                  style={rowStyle}
                  onFocus={() => setActive(segment.id)}
                  onBlur={() => setActive(null)}
                >
                  {body}
                </Link>
              ) : (
                <div className={rowClass} style={rowStyle}>
                  {body}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export type RingDatum = {
  id: string
  label: string
  value: number
  max: number
  color: string
  /** What the ring measures, under its label in the legend. */
  detail?: string
  href?: string
}

/**
 * Concentric progress rings, one per rate — bklit's ring chart. Each ring is
 * its own whole (`value / max`), so unlike the donut the rings do not add up:
 * three rates that each have their own denominator, side by side.
 */
export function RingChart({
  rings,
  format = "currency",
  size = 148,
}: {
  rings: RingDatum[]
  format?: ChartFormat
  size?: number
}) {
  const ref = useReveal<HTMLDivElement>()
  const [active, setActive] = React.useState<string | null>(null)

  const width = 7
  const ringGap = 3
  const percent = (ring: RingDatum) =>
    ring.max <= 0 ? 0 : Math.min(100, (ring.value / ring.max) * 100)

  const shown = rings.find((ring) => ring.id === active) ?? rings[0]

  return (
    <div
      ref={ref}
      className="flex flex-col items-center gap-4 sm:flex-row sm:items-center"
      onPointerLeave={() => setActive(null)}
    >
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="size-full" aria-hidden>
          {rings.map((ring, index) => {
            const r = 50 - width / 2 - 1.5 - index * (width + ringGap)
            const value = percent(ring)
            const dim = active !== null && active !== ring.id
            return (
              <g key={ring.id} onPointerEnter={() => setActive(ring.id)}>
                <circle cx="50" cy="50" r={r} fill="none" stroke="var(--sx-sunken)" strokeWidth={width} />
                {value > 0 ? (
                  <ArcCircle
                    r={r}
                    value={value}
                    color={ring.color}
                    width={width}
                    cap="round"
                    delay={index * 120}
                    style={{
                      opacity: dim ? FADED : 1,
                      filter:
                        active === ring.id
                          ? `drop-shadow(0 0 3px color-mix(in oklch, ${ring.color} 55%, transparent))`
                          : undefined,
                    }}
                  />
                ) : null}
              </g>
            )
          })}
        </svg>
        {shown ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div data-reveal-fade style={{ transition: `opacity 400ms linear ${DURATION * 0.6}ms` }}>
              {/* The rate alone: the hole is too narrow for a label, and the
                  legend row beside it is lit for the same ring. */}
              <CenterFigure value={`${Math.round(percent(shown))} %`} />
            </div>
          </div>
        ) : null}
      </div>

      <ul className="w-full min-w-0 flex-1">
        {rings.map((ring) => {
          const isActive = active === ring.id
          const body = (
            <>
              <span className="flex items-center gap-2 text-[12.5px]">
                <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: ring.color }} />
                <span className={cn("min-w-0 flex-1 truncate", isActive ? "text-ink" : "text-ink-2")}>
                  {ring.label}
                </span>
                <span className="num font-semibold">{Math.round(percent(ring))} %</span>
              </span>
              <span className="num mt-0.5 block truncate pl-4 text-[11.5px] text-ink-3">
                {formatChartValue(ring.value, format)} sur {formatChartValue(ring.max, format)}
                {ring.detail ? ` · ${ring.detail}` : ""}
              </span>
            </>
          )
          const rowClass = "block rounded-[5px] px-1.5 py-1.5"
          const rowStyle = {
            opacity: active !== null && !isActive ? FADED : 1,
            background: isActive ? "var(--sx-brand-wash)" : "transparent",
            transition: "opacity 180ms linear, background-color 150ms linear",
          }
          return (
            <li key={ring.id} onPointerEnter={() => setActive(ring.id)}>
              {ring.href ? (
                <Link
                  href={ring.href}
                  className={cn(rowClass, "outline-none focus-visible:ring-2 focus-visible:ring-brand")}
                  style={rowStyle}
                  onFocus={() => setActive(ring.id)}
                  onBlur={() => setActive(null)}
                >
                  {body}
                </Link>
              ) : (
                <div className={rowClass} style={rowStyle}>
                  {body}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export type FunnelStage = {
  id: string
  label: string
  value: number
  href?: string
}

/**
 * A lifecycle as a funnel. Each stage is a column centred on the axis, and
 * the band between two columns is what flowed on — its taper is the loss. The
 * caption under each stage gives the conversion from the stage before, which
 * is the number the shape only suggests.
 */
export function FunnelChart({
  stages,
  height = 128,
  format = "number",
}: {
  stages: FunnelStage[]
  height?: number
  format?: ChartFormat
}) {
  const ref = useReveal<HTMLDivElement>()
  const [active, setActive] = React.useState<number | null>(null)

  const n = stages.length
  if (n === 0) return null

  const W = 600
  const H = height
  const max = Math.max(1, ...stages.map((stage) => stage.value))
  const column = W / n
  const barWidth = column * 0.4
  const cx = (index: number) => column * (index + 0.5)
  const h = (value: number) => Math.max(3, (value / max) * (H - 6))
  const top = (value: number) => (H - h(value)) / 2
  const shade = (index: number) =>
    `color-mix(in oklch, var(--sx-brand) ${100 - (index / Math.max(1, n - 1)) * 45}%, var(--sx-brand-tint))`

  return (
    <div ref={ref} onPointerLeave={() => setActive(null)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: H, display: "block" }}
        aria-hidden
      >
        {stages.slice(0, -1).map((stage, index) => {
          const next = stages[index + 1]
          const x1 = cx(index) + barWidth / 2
          const x2 = cx(index + 1) - barWidth / 2
          return (
            <polygon
              key={`flow-${stage.id}`}
              data-reveal-fade
              points={`${x1},${top(stage.value)} ${x2},${top(next.value)} ${x2},${top(next.value) + h(next.value)} ${x1},${top(stage.value) + h(stage.value)}`}
              fill="var(--sx-brand)"
              style={{
                opacity: active !== null && active !== index + 1 ? 0.05 : 0.13,
                transition: `opacity 400ms linear ${DURATION * 0.5}ms`,
              }}
            />
          )
        })}
        {stages.map((stage, index) => (
          <rect
            key={stage.id}
            data-reveal-rise
            x={cx(index) - barWidth / 2}
            y={top(stage.value)}
            width={barWidth}
            height={h(stage.value)}
            rx="3"
            fill={shade(index)}
            onPointerEnter={() => setActive(index)}
            style={{
              opacity: active !== null && active !== index ? FADED : 1,
              transformBox: "fill-box",
              transformOrigin: "center",
              transition: `transform ${DURATION}ms ${EASE} ${index * 80}ms, opacity 180ms linear`,
            }}
          />
        ))}
      </svg>

      <div className="mt-2 grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {stages.map((stage, index) => {
          const previous = index === 0 ? null : stages[index - 1].value
          const conversion = previous === null ? null : previous === 0 ? 0 : Math.round((stage.value / previous) * 100)
          const body = (
            <>
              <span className="block truncate text-[11.5px] text-ink-2">{stage.label}</span>
              <span className="num block text-[16px] leading-tight font-semibold tracking-[-0.02em]">
                {formatChartValue(stage.value, format)}
              </span>
              <span className="num block text-[11px] text-ink-3">
                {conversion === null ? "point de départ" : `${conversion} % de l'étape précédente`}
              </span>
            </>
          )
          const className = cn(
            "block rounded-[5px] px-1.5 py-1 text-center outline-none focus-visible:ring-2 focus-visible:ring-brand",
            active === index && "bg-brand-wash"
          )
          const style = {
            opacity: active !== null && active !== index ? FADED : 1,
            transition: "opacity 180ms linear, background-color 150ms linear",
          }
          return stage.href ? (
            <Link
              key={stage.id}
              href={stage.href}
              className={className}
              style={style}
              onPointerEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
            >
              {body}
            </Link>
          ) : (
            <div key={stage.id} className={className} style={style} onPointerEnter={() => setActive(index)}>
              {body}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * A single figure against its thresholds — bklit's gauge. The track is tinted
 * by zone so the reader sees where the needle *could* be as much as where it
 * is; the value arc takes the colour of the zone it ends in.
 *
 * `null` is a real state, not zero: nothing to judge yet. The arc is not drawn
 * and the figure reads "—".
 */
export function GaugeChart({
  value,
  min = 0,
  max,
  zones,
  label,
  format = "ratio",
}: {
  value: number | null
  min?: number
  max: number
  /** Ascending upper bounds; the last one should be `max`. */
  zones: { to: number; color: string; label: string }[]
  label: string
  format?: ChartFormat
}) {
  const ref = useReveal<HTMLDivElement>()

  const cx = 100
  const cy = 100
  const r = 78
  const width = 13
  const t = (v: number) => Math.max(0, Math.min(1, (v - min) / (max - min || 1)))
  const point = (fraction: number, radius = r) => {
    const angle = Math.PI * (1 - fraction)
    return [cx + radius * Math.cos(angle), cy - radius * Math.sin(angle)] as const
  }
  const arc = (from: number, to: number) => {
    const [x1, y1] = point(from)
    const [x2, y2] = point(to)
    return `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 0 1 ${x2.toFixed(2)},${y2.toFixed(2)}`
  }

  const zone = value === null ? null : (zones.find((entry) => value <= entry.to) ?? zones[zones.length - 1])
  const end = value === null ? 0 : t(value)
  const [markerX, markerY] = point(end)

  const bands = zones.map((entry, index) => ({
    ...entry,
    limit: entry.to,
    from: index === 0 ? 0 : t(zones[index - 1].to),
    to: t(entry.to),
  }))

  return (
    <div ref={ref} className="mx-auto w-full max-w-[300px]">
      <svg viewBox="0 -4 200 120" className="w-full" aria-hidden>
        {bands.map((band) => (
          <path
            key={band.label}
            d={arc(band.from, band.to)}
            fill="none"
            stroke={`color-mix(in oklch, ${band.color} 20%, var(--sx-surface))`}
            strokeWidth={width}
          />
        ))}
        {zone && end > 0 ? (
          <path
            data-reveal-arc
            d={arc(0, end)}
            fill="none"
            stroke={zone.color}
            strokeWidth={width}
            pathLength={100}
            strokeDasharray="100 100"
            style={{ transition: `stroke-dasharray ${DURATION}ms ${EASE}` }}
          />
        ) : null}
        {bands.slice(0, -1).map((band) => {
          const [x1, y1] = point(band.to, r - width / 2 - 2)
          const [x2, y2] = point(band.to, r + width / 2 + 2)
          // Outside the arc: two thresholds close together (1 and 1,2) collide
          // on the inside, where the circumference is shorter.
          const [tx, ty] = point(band.to, r + width / 2 + 8)
          return (
            <g key={`tick-${band.label}`}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--sx-surface)" strokeWidth="2" />
              <text x={tx} y={ty + 3} textAnchor="middle" className="num" fontSize="8.5" fill="var(--sx-ink-3)">
                {band.limit.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}
              </text>
            </g>
          )
        })}
        {zone ? (
          <circle
            data-reveal-dot
            cx={markerX}
            cy={markerY}
            r="6.5"
            fill="var(--sx-surface)"
            stroke={zone.color}
            strokeWidth="3"
            style={{ transition: `opacity 220ms linear ${DURATION * 0.8}ms` }}
          />
        ) : null}
        <text x={cx} y={cy - 12} textAnchor="middle" className="num" fontSize="27" fontWeight="600" fill="var(--sx-ink)" letterSpacing="-0.5">
          {value === null ? "—" : formatChartValue(value, format)}
        </text>
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize="9" fill="var(--sx-ink-3)">
          {zone ? zone.label : label}
        </text>
        <text x={point(0)[0]} y={cy + 14} textAnchor="middle" className="num" fontSize="8.5" fill="var(--sx-ink-3)">
          {formatChartValue(min, format)}
        </text>
        <text x={point(1)[0]} y={cy + 14} textAnchor="middle" className="num" fontSize="8.5" fill="var(--sx-ink-3)">
          {formatChartValue(max, format)}
        </text>
      </svg>
      <div className="mt-1 flex justify-center gap-3 text-[11px] text-ink-3">
        {zones.map((entry) => (
          <span key={entry.label} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-full" style={{ background: entry.color }} />
            {entry.label}
          </span>
        ))}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

const MONTHS_SHORT = [
  "janv.", "févr.", "mars", "avr.", "mai", "juin",
  "juil.", "août", "sept.", "oct.", "nov.", "déc.",
]
const WEEKDAYS = ["Lun", "", "Mer", "", "Ven", "", ""]
const HEAT = [0, 30, 55, 78, 100]

/**
 * A calendar heatmap: one column per week, one row per weekday, darker for
 * busier days. It answers what the monthly bars cannot — which days of the
 * week the counter is busy, and whether a quiet month was quiet throughout or
 * shut for a fortnight.
 *
 * `days` is contiguous and starts on a Monday; the server builds it so the
 * grid never has to guess a calendar.
 */
export function CalendarHeatmap({
  days,
  unit = "bons",
}: {
  days: { date: string; value: number }[]
  unit?: string
}) {
  const ref = useReveal<HTMLDivElement>()
  const [active, setActive] = React.useState<number | null>(null)

  const weeks = Math.ceil(days.length / 7)
  const max = Math.max(1, ...days.map((day) => day.value))
  const level = (value: number) => (value <= 0 ? 0 : Math.min(4, Math.ceil((value / max) * 4)))
  const color = (lvl: number) =>
    lvl === 0 ? "var(--sx-sunken)" : `color-mix(in oklch, var(--sx-brand) ${HEAT[lvl]}%, var(--sx-brand-tint))`

  const monthLabels = Array.from({ length: weeks }, (_, week) => {
    const first = days[week * 7]
    if (!first) return ""
    const month = Number(first.date.slice(5, 7)) - 1
    const previous = week === 0 ? null : Number(days[(week - 1) * 7].date.slice(5, 7)) - 1
    return previous === month ? "" : MONTHS_SHORT[month]
  })

  const activeDay = active === null ? null : days[active]
  const activeWeek = active === null ? 0 : Math.floor(active / 7)

  return (
    <div ref={ref}>
      <div className="flex gap-1.5">
        <div className="grid shrink-0 pt-[18px] text-[10px] leading-none text-ink-3" style={{ gridTemplateRows: "repeat(7, minmax(0, 1fr))", rowGap: 3 }} aria-hidden>
          {WEEKDAYS.map((label, index) => (
            <span key={index} className="flex items-center">{label}</span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 grid h-[14px] text-[10px] text-ink-3" style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))`, columnGap: 3 }} aria-hidden>
            {monthLabels.map((label, index) => (
              <span key={index} className="overflow-visible whitespace-nowrap">{label}</span>
            ))}
          </div>
          <div
            className="relative grid grid-flow-col"
            style={{
              gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))`,
              gridTemplateRows: "repeat(7, minmax(0, 1fr))",
              gap: 3,
            }}
            onPointerLeave={() => setActive(null)}
          >
            {days.map((day, index) => {
              const lvl = level(day.value)
              return (
                <span
                  key={day.date}
                  data-reveal-fade
                  aria-hidden
                  onPointerEnter={() => setActive(index)}
                  className={cn("aspect-square rounded-[3px]", active === index && "ring-2 ring-ink/40")}
                  style={{
                    background: color(lvl),
                    transition: `opacity 360ms linear ${Math.floor(index / 7) * 14}ms`,
                  }}
                />
              )
            })}
            {activeDay ? (
              <ChartTooltip
                x={((activeWeek + 0.5) / weeks) * 100}
                y={(((active ?? 0) % 7) + 0.5) / 7 * 100}
                flip={(activeWeek + 0.5) / weeks > 0.62}
              >
                <TooltipTitle>
                  {new Date(`${activeDay.date}T12:00:00`).toLocaleDateString("fr-FR", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                </TooltipTitle>
                <TooltipRow swatch={color(level(activeDay.value))} label={unit} value={formatNumber(activeDay.value)} />
              </ChartTooltip>
            ) : null}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1 text-[10.5px] text-ink-3" aria-hidden>
        Moins
        {[0, 1, 2, 3, 4].map((lvl) => (
          <span key={lvl} className="size-2.5 rounded-[2px]" style={{ background: color(lvl) }} />
        ))}
        Plus
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Signed values around a centre line — bklit's profit/loss reading. Deficits
 * grow left in red, surpluses right in green, on one shared scale so two rows
 * can be compared by length alone.
 */
export function DivergingBars({
  rows,
  format = "currency",
  labelWidth = 150,
}: {
  rows: { id: string; label: string; value: number; href?: string }[]
  format?: ChartFormat
  labelWidth?: number
}) {
  const ref = useReveal<HTMLDivElement>()
  const [active, setActive] = React.useState<string | null>(null)

  const max = Math.max(1, ...rows.map((row) => Math.abs(row.value)))
  const stagger = rows.length > 0 ? Math.min(50, 400 / rows.length) : 0

  return (
    <div ref={ref} className="pt-1" onPointerLeave={() => setActive(null)}>
      {rows.map((row, index) => {
        const isActive = active === row.id
        const share = (Math.abs(row.value) / max) * 100
        const bar = (side: "neg" | "pos") =>
          (side === "neg" ? row.value < 0 : row.value > 0) ? (
            <span
              data-reveal-bar
              className={cn("block h-[13px]", side === "neg" ? "rounded-l-[3px]" : "rounded-r-[3px]")}
              style={{
                width: `${share}%`,
                background: side === "neg" ? "var(--sx-alert)" : "var(--sx-ok)",
                transition: `width ${DURATION}ms ${EASE} ${index * stagger}ms`,
              }}
            />
          ) : null
        const content = (
          <>
            <span className={cn("truncate pl-1", isActive ? "text-ink" : "text-ink-2")}>{row.label}</span>
            <span className="flex justify-end">{bar("neg")}</span>
            <span className="flex border-l border-line-2">{bar("pos")}</span>
            <span
              className={cn(
                "num pr-1 text-right",
                row.value < 0 ? "text-alert" : row.value > 0 ? "text-ok" : "text-ink-3",
                isActive && "font-medium"
              )}
            >
              {row.value > 0 ? "+" : row.value < 0 ? "−" : ""}
              {formatChartValue(Math.abs(row.value), format)}
            </span>
          </>
        )
        const className =
          "grid items-center gap-x-0 rounded-[5px] py-1 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-brand"
        const style = {
          gridTemplateColumns: `${labelWidth}px 1fr 1fr 112px`,
          opacity: active !== null && !isActive ? FADED : 1,
          background: isActive ? "var(--sx-brand-wash)" : "transparent",
          transition: "opacity 180ms linear, background-color 150ms linear",
        }
        return row.href ? (
          <Link
            key={row.id}
            href={row.href}
            className={className}
            style={style}
            onPointerEnter={() => setActive(row.id)}
            onFocus={() => setActive(row.id)}
            onBlur={() => setActive(null)}
          >
            {content}
          </Link>
        ) : (
          <div key={row.id} className={className} style={style} onPointerEnter={() => setActive(row.id)}>
            {content}
          </div>
        )
      })}
    </div>
  )
}
