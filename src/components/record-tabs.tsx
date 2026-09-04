"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"

import { cn } from "@/lib/utils"

/**
 * Record tabs.
 *
 * The active tab is a URL parameter and each tab is a real link, so a tab is
 * shareable, survives reload and the back button, and works with a middle
 * click. Every other filter in the URL is preserved, which is what keeps the
 * prev/next walk intact when you switch tabs mid-review.
 */
export function RecordTabs({
  tabs,
  active,
}: {
  tabs: { id: string; label: string }[]
  active: string
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function hrefFor(id: string): string {
    const next = new URLSearchParams(searchParams.toString())
    if (id === "apercu") next.delete("tab")
    else next.set("tab", id)
    const query = next.toString()
    return query ? `${pathname}?${query}` : pathname
  }

  return (
    <nav aria-label="Sections de la fiche" className="flex gap-0.5 border-t border-line px-[15px]">
      {tabs.map((tab) => {
        const current = tab.id === active
        return (
          <Link
            key={tab.id}
            href={hrefFor(tab.id)}
            aria-current={current ? "page" : undefined}
            scroll={false}
            className={cn(
              "-mb-px border-b-2 border-transparent px-2.5 py-2 text-[12.5px] whitespace-nowrap text-ink-2 hover:text-ink",
              current && "border-brand font-medium text-ink"
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
