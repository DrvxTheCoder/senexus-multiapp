"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Delete02Icon, PlusSignIcon } from "@hugeicons/core-free-icons"

import { formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

export type ViewTab = {
  id: string
  label: string
  /** Optional count shown in the pill. */
  count?: number
  tone?: "default" | "signal" | "alert"
  /** True for the tab matching the current URL. */
  active: boolean
  onSelect: () => void
  /** Only user-created views can be deleted. */
  onDelete?: () => void
}

/**
 * §3.5 / §4.6 — saved views.
 *
 * A view is a serialised query stored in `DashboardView.config`, so switching
 * tabs is a URL change and nothing else. The built-in tabs on the left are the
 * same thing expressed in code rather than in a row, which is why they look and
 * behave identically.
 */
export function SavedViews({
  tabs,
  onSave,
  canSave,
}: {
  tabs: ViewTab[]
  onSave: (name: string) => void
  /** False when the current query is already exactly a saved view. */
  canSave: boolean
}) {
  const [naming, setNaming] = React.useState(false)
  const [name, setName] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (naming) inputRef.current?.focus()
  }, [naming])

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    onSave(trimmed)
    setName("")
    setNaming(false)
  }

  return (
    <div className="flex items-center gap-0.5 overflow-x-auto border-b border-line px-[15px]">
      {tabs.map((tab) => (
        <span key={tab.id} className="group relative inline-flex shrink-0 items-center">
          <button
            type="button"
            onClick={tab.onSelect}
            aria-current={tab.active ? "true" : undefined}
            className={cn(
              "-mb-px inline-flex items-center gap-1.5 border-b-2 border-transparent px-2.5 py-2 text-[12.5px] whitespace-nowrap text-ink-2 hover:text-ink",
              tab.active && "border-brand font-medium text-ink"
            )}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span
                className={cn(
                  "num rounded-full px-1.5 py-px text-[11px]",
                  tab.active ? "bg-brand-tint text-brand" : "bg-sunken text-ink-3",
                  tab.tone === "signal" && "bg-signal-tint text-signal",
                  tab.tone === "alert" && "bg-alert-tint text-alert"
                )}
              >
                {formatNumber(tab.count)}
              </span>
            ) : null}
          </button>
          {tab.onDelete ? (
            <button
              type="button"
              onClick={tab.onDelete}
              aria-label={`Supprimer la vue ${tab.label}`}
              className="mr-1 rounded p-0.5 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-sunken hover:text-alert focus-visible:opacity-100"
            >
              <HugeiconsIcon icon={Delete02Icon} size={12} />
            </button>
          ) : null}
        </span>
      ))}

      {naming ? (
        <form onSubmit={submit} className="ml-1 flex items-center gap-1 py-1">
          <input
            ref={inputRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              if (!name.trim()) setNaming(false)
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setName("")
                setNaming(false)
              }
            }}
            placeholder="Nom de la vue"
            aria-label="Nom de la vue"
            className="h-[26px] w-36 rounded-md border border-line bg-surface px-2 text-[12.5px] outline-none focus:border-brand"
          />
          <button
            type="submit"
            className="h-[26px] rounded-md bg-ink px-2 text-[12px] font-medium text-paper"
          >
            Enregistrer
          </button>
        </form>
      ) : canSave ? (
        <button
          type="button"
          onClick={() => setNaming(true)}
          className="ml-1 inline-flex shrink-0 items-center gap-1 px-2 py-2 text-[12.5px] text-ink-3 hover:text-ink"
        >
          <HugeiconsIcon icon={PlusSignIcon} size={12} />
          Enregistrer
        </button>
      ) : null}
    </div>
  )
}
