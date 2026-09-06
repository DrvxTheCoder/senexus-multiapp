"use client"

import * as React from "react"

import {
  ChartTooltip,
  DURATION,
  EASE,
  TooltipRow,
  TooltipTitle,
  useReveal,
} from "@/components/chart-primitives"
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
}: {
  data: number[]
  tone?: "brand" | "signal" | "alert" | "ok"
  width?: number
  height?: number
}) {
  const ref = useReveal<SVGSVGElement>()

  if (data.length < 2) return null

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  const points = data
    .map((value, index) => {
      const x = (index / (data.length - 1)) * 100
      const y = 28 - ((value - min) / range) * 24 - 2
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
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
}: {
  rows: {
    id: string
    label: string
    value: number
    suffix?: string
    color?: string
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
          <div
            key={row.id}
            className="grid items-center gap-2.5 rounded-[5px] py-1 text-[12.5px]"
            style={{
              gridTemplateColumns: `${labelWidth}px 1fr 60px`,
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
              {formatNumber(row.value)}
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
