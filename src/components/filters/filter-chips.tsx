"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"

export type FilterChip = {
  /** Stable key, so removing one chip cannot remove another. */
  key: string
  label: string
  value: string
  onRemove: () => void
}

/**
 * §4.6 — the active filters, spelled out.
 *
 * The facet buttons show what *can* be filtered; the chips show what *is*
 * filtered, including filters that arrived in the URL from somewhere else — a
 * dashboard drill-through, a saved view, a link from a colleague. Without them
 * a pre-filtered list looks like the whole list.
 */
export function FilterChips({
  chips,
  onClearAll,
}: {
  chips: FilterChip[]
  onClearAll: () => void
}) {
  if (chips.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-[15px] py-2">
      <span className="text-[11.5px] text-ink-3">Filtres actifs</span>
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex h-[22px] items-center gap-1.5 rounded-md bg-sunken pr-1 pl-2 text-[11.5px] text-ink-2"
        >
          <span className="text-ink-3">{chip.label}</span>
          <span className="font-medium text-ink">{chip.value}</span>
          <button
            type="button"
            onClick={chip.onRemove}
            aria-label={`Retirer ${chip.label} ${chip.value}`}
            className="rounded p-0.5 hover:bg-line-2"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={11} />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="ml-1 text-[11.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
      >
        Tout effacer
      </button>
    </div>
  )
}
