import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * §4.6 — the small vocabulary every screen is built from. One implementation
 * each, all reading tokens, none hard-coding a colour.
 */

/* -------------------------------------------------------------------------- */

export type PillTone = "ok" | "signal" | "alert" | "muted" | "brand"

const PILL_TONE: Record<PillTone, string> = {
  ok: "bg-ok-tint text-ok",
  signal: "bg-signal-tint text-signal",
  alert: "bg-alert-tint text-alert",
  muted: "bg-sunken text-ink-2",
  brand: "bg-brand-tint text-brand",
}

export function StatusPill({
  tone = "muted",
  dot = false,
  children,
  className,
}: {
  tone?: PillTone
  dot?: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 rounded-md px-1.5 text-[11.5px] font-medium whitespace-nowrap",
        PILL_TONE[tone],
        className
      )}
    >
      {dot ? (
        <span aria-hidden className="size-[5px] rounded-full bg-current" />
      ) : null}
      {children}
    </span>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * A short machine-ish code — contract type, department code, category.
 * Monospaced because it is an identifier, not prose (§4.3).
 */
export function TagCode({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "mono inline-block rounded bg-sunken px-1.5 py-0.5 text-[10.5px] font-medium text-ink-2",
        className
      )}
    >
      {children}
    </span>
  )
}

/* -------------------------------------------------------------------------- */

/** The client colour dot. Categorical, never semantic (§4.7). */
export function ClientDot({
  colorVar,
  className,
}: {
  colorVar: string
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-1.5 shrink-0 rounded-full", className)}
      style={{ background: colorVar }}
    />
  )
}

/* -------------------------------------------------------------------------- */

/**
 * §4.7 — two facts per cell where the second one is meaningful. The primary
 * fact reads at full weight; the secondary is the quiet line beneath it.
 */
export function TwoFacts({
  primary,
  secondary,
  align = "left",
  className,
}: {
  primary: React.ReactNode
  secondary?: React.ReactNode
  align?: "left" | "right"
  className?: string
}) {
  return (
    <div className={cn(align === "right" && "text-right", className)}>
      <div className="truncate">{primary}</div>
      {secondary ? (
        <div className="mt-px truncate text-[11.5px] text-ink-3">{secondary}</div>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export function Avatar({
  initials,
  size = 26,
  className,
}: {
  initials: string
  size?: number
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-brand-tint font-semibold text-brand",
        className
      )}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </span>
  )
}

/* -------------------------------------------------------------------------- */

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex rounded-[7px] bg-sunken p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-6 rounded-[5px] px-2.5 text-xs text-ink-2 transition-colors",
              active && "bg-surface font-medium text-ink shadow-[0_1px_2px_rgba(19,30,28,0.07)]"
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="px-[15px] py-12 text-center">
      <p className="text-[13px] font-semibold">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-sm text-[13px] text-ink-3">{description}</p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * §3.6 — a skeleton that matches the final layout's dimensions, so nothing
 * shifts when the rows arrive. Row height and column count are the real ones.
 */
export function TableSkeleton({
  rows = 12,
  columns,
}: {
  rows?: number
  columns: number[]
}) {
  return (
    <div aria-hidden className="animate-pulse">
      <div className="flex h-[33px] items-center gap-2.5 border-y border-line bg-sub px-[15px]">
        {columns.map((width, index) => (
          <div
            key={index}
            className="h-2 rounded-sm bg-sunken"
            style={{ width: `${width}%` }}
          />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className="flex h-row items-center gap-2.5 border-b border-line px-[15px]"
        >
          {columns.map((width, index) => (
            <div
              key={index}
              className="h-2.5 rounded-sm bg-sunken/70"
              style={{ width: `${width}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
