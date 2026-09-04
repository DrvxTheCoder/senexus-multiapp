"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon } from "@hugeicons/core-free-icons"

import { formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * The two controls every resource list needs. Extracted so the contracts,
 * employees and clients lists share one implementation rather than three
 * lookalikes that drift.
 */

export function RowCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: () => void
  label: string
}) {
  return (
    <span
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation()
        onChange()
      }}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault()
          event.stopPropagation()
          onChange()
        }
      }}
      className={cn(
        "grid size-[15px] cursor-pointer place-items-center rounded border-[1.5px] border-line-2 bg-surface transition-colors",
        checked && "border-brand bg-brand text-brand-contrast"
      )}
    >
      {checked ? (
        <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
          <path
            d="M1.5 5.2 4 7.5 8.5 2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </span>
  )
}

export function Pager({
  page,
  pageCount,
  onChange,
}: {
  page: number
  pageCount: number
  onChange: (page: number) => void
}) {
  return (
    <span className="flex items-center gap-2">
      <span className="text-ink-3">
        Page {formatNumber(page)} sur {formatNumber(Math.max(1, pageCount))}
      </span>
      <PagerButton
        disabled={page <= 1}
        label="Page précédente"
        direction="prev"
        onClick={() => onChange(page - 1)}
      />
      <PagerButton
        disabled={page >= pageCount}
        label="Page suivante"
        direction="next"
        onClick={() => onChange(page + 1)}
      />
    </span>
  )
}

function PagerButton({
  disabled,
  onClick,
  label,
  direction,
}: {
  disabled: boolean
  onClick: () => void
  label: string
  direction: "prev" | "next"
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      className="inline-flex h-[25px] items-center rounded-md border border-line bg-surface px-2 text-ink-2 hover:bg-sub disabled:opacity-40 disabled:hover:bg-surface"
    >
      <HugeiconsIcon
        icon={ArrowRight01Icon}
        size={13}
        className={cn(direction === "prev" && "rotate-180")}
      />
    </button>
  )
}
