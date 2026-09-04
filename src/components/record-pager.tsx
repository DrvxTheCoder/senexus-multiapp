"use client"

import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons"

import { formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * §5.5 — prev/next through the *current query result*, with a position counter.
 *
 * Not "the next employee by id" but the next one in the list the user was
 * looking at: the filter and sort travel in the URL, so walking a filtered
 * result set of 27 people at risk stays inside those 27. Both neighbours are
 * plain links, so they prefetch and work with a middle click.
 */
export function RecordPager({
  backHref,
  backLabel,
  position,
  total,
  prevHref,
  nextHref,
}: {
  backHref: string
  backLabel: string
  position: number | null
  total: number
  prevHref: string | null
  nextHref: string | null
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Link
        href={backHref}
        className="inline-flex h-[25px] items-center gap-1 rounded-md px-2 text-[12.5px] text-ink-2 hover:bg-sunken hover:text-ink"
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
        {backLabel}
      </Link>

      {position !== null ? (
        <div className="ml-auto flex items-center gap-1.5">
          <span className="num text-[12.5px] text-ink-3">
            {formatNumber(position)} sur {formatNumber(total)}
          </span>
          <NeighbourLink href={prevHref} label="Précédent" direction="prev" />
          <NeighbourLink href={nextHref} label="Suivant" direction="next" />
        </div>
      ) : null}
    </div>
  )
}

function NeighbourLink({
  href,
  label,
  direction,
}: {
  href: string | null
  label: string
  direction: "prev" | "next"
}) {
  const icon = direction === "prev" ? ArrowLeft01Icon : ArrowRight01Icon

  if (!href) {
    return (
      <span
        aria-disabled
        aria-label={`${label} (indisponible)`}
        className="inline-flex h-[25px] items-center rounded-md border border-line bg-surface px-2 text-ink-3 opacity-40"
      >
        <HugeiconsIcon icon={icon} size={14} />
      </span>
    )
  }

  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(
        "inline-flex h-[25px] items-center rounded-md border border-line bg-surface px-2 text-ink-2",
        "hover:bg-sub hover:text-ink"
      )}
    >
      <HugeiconsIcon icon={icon} size={14} />
    </Link>
  )
}
