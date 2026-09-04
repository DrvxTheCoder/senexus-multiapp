"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"

import { formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

export type BulkAction = {
  id: string
  label: string
  icon?: IconSvgElement
  /** Ochre treatment: the action is possible but some rows will be blocked. */
  warning?: boolean
  onRun: () => void
}

/**
 * §4.6 — the bulk bar, and §3.5's most important consequence.
 *
 * Selection is expressed as either a set of ids or "everything matching the
 * current query, minus these". That is why `selectAllMatching` exists: picking
 * 396 rows costs one boolean, not 396 ids in the browser and 396 ids on the
 * wire.
 *
 * Rises in ~180ms per §4.8, and yields to `prefers-reduced-motion` through the
 * global rule in globals.css.
 */
export function BulkActionBar({
  selectedCount,
  totalMatching,
  selectAllMatching,
  onSelectAllMatching,
  onClear,
  actions,
}: {
  selectedCount: number
  totalMatching: number
  selectAllMatching: boolean
  onSelectAllMatching: () => void
  onClear: () => void
  actions: BulkAction[]
}) {
  if (selectedCount === 0) return null

  const plural = selectedCount > 1 ? "s" : ""
  const canOfferAll = !selectAllMatching && totalMatching > selectedCount

  return (
    <div
      role="region"
      aria-label="Actions groupées"
      className={cn(
        "absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2.5",
        "rounded-[11px] bg-ink py-1.5 pr-2 pl-3.5 text-paper shadow-[0_9px_30px_rgba(19,30,28,0.25)]",
        "motion-safe:animate-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-200"
      )}
    >
      <span className="text-[13px] whitespace-nowrap">
        <b className="num">{formatNumber(selectedCount)}</b> sélectionné{plural}
      </span>

      {canOfferAll ? (
        <button
          type="button"
          onClick={onSelectAllMatching}
          className="text-[12.5px] whitespace-nowrap text-paper/70 underline-offset-2 hover:text-paper hover:underline"
        >
          Tout sélectionner ({formatNumber(totalMatching)})
        </button>
      ) : null}

      <span aria-hidden className="h-4 w-px bg-paper/20" />

      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          onClick={action.onRun}
          className={cn(
            "inline-flex h-[27px] items-center gap-1.5 rounded-[7px] px-2.5 text-[12.5px] whitespace-nowrap transition-colors",
            action.warning
              ? "bg-[#7A4610] hover:bg-[#8F5312]"
              : "bg-[#293633] hover:bg-[#37453F]"
          )}
        >
          {action.icon ? <HugeiconsIcon icon={action.icon} size={13} /> : null}
          {action.label}
        </button>
      ))}

      <button
        type="button"
        onClick={onClear}
        aria-label="Annuler la sélection"
        className="rounded-md px-1.5 py-1 hover:bg-[#293633]"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={14} />
      </button>
    </div>
  )
}
