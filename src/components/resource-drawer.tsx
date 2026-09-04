"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"

import { cn } from "@/lib/utils"

/**
 * §4.6 — the resource drawer.
 *
 * Slides in over the list rather than navigating away, so the row stays in
 * view and dismissing it costs nothing. Used where a record is a summary a
 * person reads and closes — clients — rather than one they work inside, which
 * is what the employee record is for.
 *
 * Focus is trapped while open and restored to the trigger on close (§9), and
 * Escape closes. The slide is ~220ms per §4.8 and yields to
 * `prefers-reduced-motion` through the global rule.
 */
export function ResourceDrawer({
  open,
  onClose,
  title,
  subtitle,
  accent,
  footer,
  children,
}: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  subtitle?: React.ReactNode
  /** A colour dot rendered beside the title — the client's, usually. */
  accent?: string
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  const panelRef = React.useRef<HTMLDivElement>(null)
  const restoreRef = React.useRef<HTMLElement | null>(null)

  React.useEffect(() => {
    if (!open) return

    restoreRef.current = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    panel?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation()
        onClose()
        return
      }

      if (event.key !== "Tab" || !panel) return

      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      restoreRef.current?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 z-40 bg-[rgba(19,30,28,0.26)] motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : "Détail"}
        tabIndex={-1}
        className={cn(
          "absolute inset-y-0 right-0 z-41 flex w-[470px] max-w-[92%] flex-col border-l border-line bg-surface outline-none",
          "shadow-[-14px_0_40px_rgba(19,30,28,0.1)]",
          "motion-safe:animate-in motion-safe:slide-in-from-right-6 motion-safe:duration-200"
        )}
      >
        <div className="flex items-start gap-3 border-b border-line px-4 py-3.5">
          {accent ? (
            <span
              aria-hidden
              className="mt-1.5 size-2 shrink-0 rounded-full"
              style={{ background: accent }}
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[16.5px] font-semibold tracking-[-0.015em]">
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-0.5 truncate text-[12.5px] text-ink-3">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-md p-1 text-ink-3 hover:bg-sunken hover:text-ink"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">{children}</div>

        {footer ? (
          <div className="flex items-center gap-2 border-t border-line bg-sub px-4 py-2.5">
            {footer}
          </div>
        ) : null}
      </aside>
    </>
  )
}
