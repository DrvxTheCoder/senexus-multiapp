import * as React from "react"
import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon, Home01Icon } from "@hugeicons/core-free-icons"

export type Crumb = {
  label: string
  href?: string
}

/**
 * §5.1 — 48px top bar: breadcrumb on the left, actions on the right.
 *
 * A server component. Pages pass their own trail and their own right-hand
 * actions rather than the bar guessing at either.
 */
export function TopBar({
  crumbs,
  actions,
  homeHref,
}: {
  crumbs: Crumb[]
  actions?: React.ReactNode
  homeHref: string
}) {
  return (
    <header className="flex h-top shrink-0 items-center gap-3 border-b border-line bg-surface px-4.5">
      <Link
        href={homeHref}
        aria-label="Tableau de bord"
        className="text-ink-3 hover:text-ink"
      >
        <HugeiconsIcon icon={Home01Icon} size={14} strokeWidth={1.8} />
      </Link>

      <nav aria-label="Fil d'Ariane" className="min-w-0">
        <ol className="flex min-w-0 items-center gap-1.5 text-[13px] text-ink-3">
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1
            return (
              <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
                {index > 0 ? (
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    size={13}
                    className="shrink-0 opacity-35"
                    aria-hidden
                  />
                ) : null}
                {last ? (
                  <span className="truncate font-medium text-ink" aria-current="page">
                    {crumb.label}
                  </span>
                ) : crumb.href ? (
                  <Link href={crumb.href} className="truncate hover:text-ink">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="truncate">{crumb.label}</span>
                )}
              </li>
            )
          })}
        </ol>
      </nav>

      {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
    </header>
  )
}
