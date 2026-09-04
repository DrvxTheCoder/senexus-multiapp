import * as React from "react"

import { cn } from "@/lib/utils"
import { formatNumber } from "@/lib/format"

/**
 * §4.6 — the chart vocabulary.
 *
 * Inline SVG rather than a charting library: these are four simple shapes, they
 * are server-rendered with the page, and a library would ship ~100kB to the
 * browser to draw a sparkline. Everything reads design tokens, so a firm's
 * brand colour flows through automatically and dark mode needs no second
 * palette.
 *
 * Each chart is decorative in the accessibility sense — the numbers it
 * visualises are always present as text nearby — so the SVGs are aria-hidden
 * and the surrounding markup carries the meaning.
 */

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
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      style={{ width, height }}
      className="shrink-0"
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke={`var(--sx-${tone})`}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/* -------------------------------------------------------------------------- */

export function AreaChart({
  data,
  labels,
  height = 150,
}: {
  data: number[]
  labels: string[]
  height?: number
}) {
  if (data.length < 2) return null

  const W = 600
  const H = height
  const pad = 20
  const min = Math.min(...data) - 12
  const max = Math.max(...data) + 8
  const range = max - min || 1

  const x = (index: number) => (index / (data.length - 1)) * W
  const y = (value: number) => H - pad - ((value - min) / range) * (H - pad * 1.6)

  const line = data
    .map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`)
    .join(" ")
  const area = `${line} L${W},${H} L0,${H} Z`
  const grid = [0, 0.25, 0.5, 0.75, 1].map((fraction) => H - pad - fraction * (H - pad * 1.6))

  return (
    <div>
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
        <path d={area} fill="url(#sx-area)" />
        <path
          d={line}
          fill="none"
          stroke="var(--sx-brand)"
          strokeWidth="1.8"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx={x(data.length - 1)}
          cy={y(data[data.length - 1])}
          r="3.2"
          fill="var(--sx-brand)"
          stroke="var(--sx-surface)"
          strokeWidth="1.6"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-1.5 flex justify-between">
        {labels.map((label, index) => (
          <span
            key={index}
            className="flex-1 text-center text-[10.5px] text-ink-3"
            aria-hidden
          >
            {index % 2 === 0 ? label : ""}
          </span>
        ))}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export function StackedBars({
  data,
  height = 118,
}: {
  data: { label: string; segments: { value: number; tone: string }[] }[]
  height?: number
}) {
  const max = Math.max(1, ...data.map((entry) => entry.segments.reduce((s, x) => s + x.value, 0)))

  return (
    <div className="flex items-end gap-2.5" style={{ height }}>
      {data.map((entry) => {
        const total = entry.segments.reduce((sum, segment) => sum + segment.value, 0)
        return (
          <div key={entry.label} className="flex flex-1 flex-col items-center justify-end gap-1.5">
            <span className="num text-[11.5px] font-medium">{formatNumber(total)}</span>
            <div
              className="flex w-full flex-col justify-end overflow-hidden rounded-t-[3px] transition-[height] duration-500"
              style={{ height: `${(total / max) * (height - 34)}px` }}
            >
              {entry.segments.map((segment, index) =>
                segment.value === 0 ? null : (
                  <div
                    key={index}
                    style={{
                      height: `${(segment.value / total) * 100}%`,
                      background: segment.tone,
                    }}
                  />
                )
              )}
            </div>
            <span className="text-[11px] text-ink-3">{entry.label}</span>
          </div>
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export function HorizontalBars({
  rows,
  labelWidth = 130,
}: {
  rows: { id: string; label: string; value: number; suffix?: string; color?: string }[]
  labelWidth?: number
}) {
  const max = Math.max(1, ...rows.map((row) => row.value))

  return (
    <div className="pt-1">
      {rows.map((row) => (
        <div
          key={row.id}
          className="grid items-center gap-2.5 py-1 text-[12.5px]"
          style={{ gridTemplateColumns: `${labelWidth}px 1fr 60px` }}
        >
          <span className="truncate text-ink-2">{row.label}</span>
          <span className="block">
            <span
              className="block h-[15px] rounded-[3px] transition-[width] duration-500"
              style={{
                width: `${(row.value / max) * 100}%`,
                background: row.color ?? "var(--sx-brand)",
              }}
            />
          </span>
          <span className="num text-right text-ink-2">
            {formatNumber(row.value)}
            {row.suffix ? (
              <span className="text-[11px] text-ink-3"> {row.suffix}</span>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * The banded distribution. Ochre and red are load-bearing here: the last two
 * bands are the legal warning zone and the breach.
 */
export function BandChart({
  bands,
}: {
  bands: { label: string; count: number; color: string; tone?: "signal" | "alert" }[]
}) {
  const total = bands.reduce((sum, band) => sum + band.count, 0)

  return (
    <div>
      <div className="flex h-6 overflow-hidden rounded-md" aria-hidden>
        {bands.map((band) =>
          band.count === 0 ? null : (
            <div
              key={band.label}
              className="transition-[flex-grow] duration-500"
              style={{ flexGrow: band.count, background: band.color }}
              title={`${band.label} · ${band.count}`}
            />
          )
        )}
      </div>

      <dl className="mt-2.5">
        {bands.map((band) => (
          <div
            key={band.label}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-2.5 border-b border-line py-1.5 text-[12.5px] last:border-b-0"
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
        ))}
      </dl>
    </div>
  )
}
