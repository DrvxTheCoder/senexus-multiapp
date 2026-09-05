import * as React from "react"

/**
 * The admin console has no firm, so it has no breadcrumb trail into one. This
 * is the deliberately plainer header the console uses instead.
 */
export function AdminPageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <header className="flex flex-wrap items-start gap-3 border-b border-line bg-surface px-4.5 py-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-[17px] leading-tight font-semibold tracking-[-0.018em]">
          {title}
        </h1>
        {description ? (
          <p className="mt-0.5 text-[12.5px] text-ink-3">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </header>
  )
}
