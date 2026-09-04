import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * §4.6 — the chain.
 *
 * A vertical run of events on a hairline, with the live node filled. Used for
 * the renewal chain and for the group parcours, which are the same shape: a
 * sequence where one entry is current and the rest are history.
 */
export function Timeline({ children }: { children: React.ReactNode }) {
  return (
    <ol className="relative mt-1.5 list-none pl-5 before:absolute before:top-1.5 before:bottom-2.5 before:left-[5px] before:w-px before:bg-line-2">
      {children}
    </ol>
  )
}

export function TimelineNode({
  live = false,
  title,
  meta,
  trailing,
  note,
  children,
}: {
  /** The current entry: filled dot rather than an outlined one. */
  live?: boolean
  title: React.ReactNode
  meta?: React.ReactNode
  trailing?: React.ReactNode
  note?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <li
      className={cn(
        "relative py-2.5",
        "before:absolute before:top-3.5 before:-left-[19px] before:size-2.5 before:rounded-full",
        "before:border-2 before:border-line-2 before:bg-surface",
        live && "before:border-brand before:bg-brand"
      )}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-[13.5px] font-medium">{title}</span>
        {meta ? <span className="mono text-xs text-ink-3">{meta}</span> : null}
        {trailing ? <span className="ml-auto shrink-0">{trailing}</span> : null}
      </div>
      {note ? <div className="mt-px text-[11.5px] text-ink-3">{note}</div> : null}
      {children}
    </li>
  )
}
