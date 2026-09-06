import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * §4.4 — the panel anatomy. Every content surface in the application is one of
 * these, including screens that were never in the prototype.
 *
 *   header : title + description + inline stats + tools
 *   body   : the content, padded unless the child manages its own padding
 *   footer : one summary sentence and, usually, a drill-through
 *
 * The header is a real <header> and the title a real heading, so a screen reads
 * as a document outline rather than a pile of divs. Pass `titleAs` to keep the
 * heading levels honest on a page that has several panels under an h1.
 */

export type PanelStat = {
  label: string
  value: React.ReactNode
  /** Ochre only ever means the legal ceiling. */
  tone?: "default" | "signal" | "alert" | "ok"
}

export type PanelFooterProps = {
  /** One sentence. No icon, no tint, no bold. */
  summary?: React.ReactNode
  /** Drill-through, pagination, totals — anything that belongs on the right. */
  action?: React.ReactNode
  className?: string
  children?: React.ReactNode
}

const statToneClass: Record<NonNullable<PanelStat["tone"]>, string> = {
  default: "text-ink",
  signal: "text-signal",
  alert: "text-alert",
  ok: "text-ok",
}

export function PanelFooter({
  summary,
  action,
  className,
  children,
}: PanelFooterProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 border-t border-line bg-sub px-[15px] py-2.5 text-[12.5px] text-ink-2",
        className
      )}
    >
      {children ?? (
        <>
          {summary ? <span className="min-w-0">{summary}</span> : null}
          {action ? <span className="ml-auto shrink-0">{action}</span> : null}
        </>
      )}
    </div>
  )
}

export function PanelStats({ stats }: { stats: PanelStat[] }) {
  return (
    <div className="ml-auto flex shrink-0 items-baseline gap-[15px]">
      {stats.map((stat) => (
        <span
          key={stat.label}
          className="inline-flex items-baseline gap-1.5 text-xs text-ink-3"
        >
          {stat.label}{" "}
          <b
            className={cn(
              "num text-[12.5px] font-semibold",
              statToneClass[stat.tone ?? "default"]
            )}
          >
            {stat.value}
          </b>
        </span>
      ))}
    </div>
  )
}

export type PanelProps = {
  title?: React.ReactNode
  /** One clause. Not a paragraph. */
  description?: React.ReactNode
  stats?: PanelStat[]
  tools?: React.ReactNode
  footer?: PanelFooterProps | React.ReactNode
  /** Set false when the body owns its own padding — tables, charts, queues. */
  padded?: boolean
  titleAs?: "h1" | "h2" | "h3"
  className?: string
  bodyClassName?: string
  children?: React.ReactNode
}

/**
 * `footer` accepts either the structured summary/action pair or arbitrary
 * nodes. This narrows the union: a plain object that is not a React element is
 * the structured form.
 */
function isPanelFooterProps(
  footer: PanelProps["footer"]
): footer is PanelFooterProps {
  return (
    typeof footer === "object" &&
    footer !== null &&
    !React.isValidElement(footer) &&
    !Array.isArray(footer)
  )
}

export function Panel({
  title,
  description,
  stats,
  tools,
  footer,
  padded = true,
  titleAs: Heading = "h2",
  className,
  bodyClassName,
  children,
}: PanelProps) {
  const hasHeader = Boolean(title || description || stats?.length || tools)
  const footerIsProps = isPanelFooterProps(footer)

  return (
    <section
      className={cn(
        "overflow-hidden rounded-panel border border-line bg-surface h-fit",
        className
      )}
    >
      {hasHeader ? (
        <header className="flex items-start gap-3.5 px-[15px] py-3">
          <div className="min-w-0">
            {title ? (
              <Heading className="text-[13px] font-semibold tracking-[-0.006em] text-ink">
                {title}
              </Heading>
            ) : null}
            {description ? (
              <p className="mt-px text-xs text-ink-3">{description}</p>
            ) : null}
          </div>
          {stats?.length ? <PanelStats stats={stats} /> : null}
          {tools ? (
            <div
              className={cn(
                "flex shrink-0 items-center gap-1.5",
                stats?.length ? "" : "ml-auto"
              )}
            >
              {tools}
            </div>
          ) : null}
        </header>
      ) : null}

      {padded ? (
        <div className={cn("px-[15px] pb-[15px]", !hasHeader && "pt-[15px]", bodyClassName)}>
          {children}
        </div>
      ) : (
        children
      )}

      {footerIsProps ? (
        <PanelFooter {...footer} />
      ) : footer ? (
        <PanelFooter>{footer}</PanelFooter>
      ) : null}
    </section>
  )
}
