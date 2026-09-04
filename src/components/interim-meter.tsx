import * as React from "react"

import { cn } from "@/lib/utils"
import { formatNumber } from "@/lib/format"

/**
 * §4.6 — the signature element.
 *
 * Cumulative interim days against the 730-day legal ceiling, with a tick at
 * 85%, shifting brand → signal → alert. It appears as a table column, inside
 * drawers, and full width on the employee record, so the three sizes are one
 * component rather than three lookalikes.
 *
 * Ochre here is not decoration. It means a legal limit is in play — the one
 * meaning `signal` carries anywhere in this application.
 *
 * When the ceiling does not govern a contract type the meter renders
 * "non applicable" rather than an empty bar: a bar at zero would read as
 * "plenty of room left", which is a different and misleading claim.
 */

export const CEILING_DAYS = 730
const WARNING_RATIO = 0.85

export type InterimMeterProps = {
  usedDays: number
  applicable: boolean
  size?: "table" | "panel"
  /** Days already contracted beyond today, shown as a ghost segment. */
  projectedDays?: number
  className?: string
}

const TONE_FILL: Record<"brand" | "signal" | "alert", string> = {
  brand: "bg-brand",
  signal: "bg-signal",
  alert: "bg-alert",
}

const TONE_TEXT: Record<"brand" | "signal" | "alert", string> = {
  brand: "text-ink-2",
  signal: "text-signal",
  alert: "text-alert",
}

function toneFor(usedDays: number): "brand" | "signal" | "alert" {
  if (usedDays >= CEILING_DAYS) return "alert"
  if (usedDays >= CEILING_DAYS * WARNING_RATIO) return "signal"
  return "brand"
}

export function InterimMeter({
  usedDays,
  applicable,
  size = "table",
  projectedDays,
  className,
}: InterimMeterProps) {
  if (!applicable) {
    return (
      <span className="text-xs text-ink-3" title="Le plafond de 730 jours ne s'applique pas à ce type de contrat">
        non applicable
      </span>
    )
  }

  const tone = toneFor(usedDays)
  const usedPercent = Math.min(100, (usedDays / CEILING_DAYS) * 100)
  const projectedPercent =
    projectedDays === undefined
      ? 0
      : Math.min(100, (projectedDays / CEILING_DAYS) * 100)
  const panel = size === "panel"

  const label = `${formatNumber(usedDays)} jours cumulés sur ${CEILING_DAYS}`

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        role="meter"
        aria-valuenow={usedDays}
        aria-valuemin={0}
        aria-valuemax={CEILING_DAYS}
        aria-label={label}
        className={cn(
          "relative shrink-0 overflow-hidden rounded-sm bg-sunken",
          panel ? "h-2.5 w-full rounded" : "h-1.5 w-[70px]"
        )}
      >
        {/* Contracted but not yet worked, behind the solid fill. */}
        {projectedPercent > usedPercent ? (
          <div
            className={cn("absolute inset-y-0 left-0 opacity-30", TONE_FILL[tone])}
            style={{ width: `${projectedPercent}%` }}
          />
        ) : null}
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-sm transition-[width] duration-500 ease-out",
            TONE_FILL[tone]
          )}
          style={{ width: `${usedPercent}%` }}
        />
        {/* The 85% tick: where a renewal decision stops being routine. */}
        <div
          aria-hidden
          className="absolute -top-0.5 -bottom-0.5 w-px bg-line-2"
          style={{ left: `${WARNING_RATIO * 100}%` }}
        />
      </div>

      {panel ? null : (
        <span className={cn("mono num text-[11px]", TONE_TEXT[tone])}>
          {formatNumber(usedDays)}
        </span>
      )}
    </div>
  )
}

/**
 * The full-width treatment for the employee record: the remaining margin as
 * the headline, because that is the number a decision is made on.
 */
export function InterimMeterPanel({
  usedDays,
  projectedDays,
  applicable,
}: {
  usedDays: number
  projectedDays?: number
  applicable: boolean
}) {
  if (!applicable) {
    return (
      <p className="py-1.5 text-[13px] text-ink-2">
        Ce type de contrat n'est pas soumis au plafond de 730 jours.
      </p>
    )
  }

  const tone = toneFor(usedDays)
  const remaining = Math.max(0, CEILING_DAYS - usedDays)

  return (
    <div>
      <div className="mb-2.5 flex items-baseline gap-2">
        <span
          className={cn(
            "num text-[30px] leading-none font-semibold tracking-[-0.03em]",
            tone === "alert" ? "text-alert" : tone === "signal" ? "text-signal" : "text-brand"
          )}
        >
          {formatNumber(remaining)}
        </span>
        <span className="text-[12.5px] text-ink-2">
          {remaining === 0 ? "jour de marge" : "jours de marge"}
        </span>
        <span className="num mono ml-auto text-xs text-ink-3">
          {formatNumber(usedDays)} / {CEILING_DAYS}
        </span>
      </div>
      <InterimMeter
        usedDays={usedDays}
        projectedDays={projectedDays}
        applicable
        size="panel"
      />
    </div>
  )
}
