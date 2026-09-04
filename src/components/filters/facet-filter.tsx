"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon, Cancel01Icon, Tick02Icon } from "@hugeicons/core-free-icons"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

export type FacetOption = {
  value: string
  label: string
  count: number
}

/**
 * §4.6 — a facet.
 *
 * Counts come from the server, computed with every other filter applied but
 * this facet's own excluded, so a count reads as "how many rows this value
 * would add", not "how many are already showing". A value at zero is kept and
 * dimmed rather than hidden, because a disappearing option is worse than an
 * empty one: it makes the filter bar feel unstable.
 */
export function FacetFilter({
  label,
  options,
  selected,
  onChange,
  emptyHint,
}: {
  label: string
  options: FacetOption[]
  selected: string[]
  onChange: (values: string[]) => void
  emptyHint?: string
}) {
  const [open, setOpen] = React.useState(false)
  const active = selected.length > 0

  const summary = React.useMemo(() => {
    if (!active) return null
    if (selected.length === 1) {
      return options.find((option) => option.value === selected[0])?.label ?? selected[0]
    }
    return `${selected.length} sélectionnés`
  }, [active, options, selected])

  function toggle(value: string) {
    onChange(
      selected.includes(value)
        ? selected.filter((entry) => entry !== value)
        : [...selected, value]
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            data-active={active ? "1" : "0"}
            className={cn(
              "inline-flex h-[29px] items-center gap-1.5 rounded-[7px] border border-dashed border-line-2 px-2.5 text-[12.5px] text-ink-2",
              "hover:border-ink-3 hover:text-ink",
              active &&
                "border-solid border-brand bg-brand-wash font-medium text-brand"
            )}
          >
            {label}
            {summary ? (
              <>
                <span aria-hidden className="opacity-40">
                  ·
                </span>
                <span className="max-w-[140px] truncate">{summary}</span>
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Retirer le filtre ${label}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    onChange([])
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      event.stopPropagation()
                      onChange([])
                    }
                  }}
                  className="-mr-0.5 rounded p-0.5 hover:bg-brand-tint"
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={12} />
                </span>
              </>
            ) : (
              <HugeiconsIcon icon={ArrowDown01Icon} size={12} />
            )}
          </button>
        }
      />

      <PopoverContent align="start" className="w-64 p-0">
        <div className="max-h-[300px] overflow-y-auto py-1">
          {options.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12.5px] text-ink-3">
              {emptyHint ?? "Aucune valeur"}
            </p>
          ) : (
            options.map((option) => {
              const checked = selected.includes(option.value)
              return (
                <button
                  key={option.value}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => toggle(option.value)}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] hover:bg-brand-wash",
                    option.count === 0 && !checked && "opacity-45"
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "grid size-[15px] shrink-0 place-items-center rounded border-[1.5px] border-line-2 bg-surface transition-colors",
                      checked && "border-brand bg-brand text-brand-contrast"
                    )}
                  >
                    {checked ? <HugeiconsIcon icon={Tick02Icon} size={10} strokeWidth={3.4} /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  <span className="num text-[11.5px] text-ink-3">
                    {formatNumber(option.count)}
                  </span>
                </button>
              )
            })
          )}
        </div>

        {active ? (
          <div className="border-t border-line p-1">
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full rounded-md px-3 py-1.5 text-center text-[12.5px] text-ink-2 hover:bg-sunken hover:text-ink"
            >
              Effacer
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
