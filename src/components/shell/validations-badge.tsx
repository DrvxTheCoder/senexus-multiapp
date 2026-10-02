"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { notify } from "@/lib/toast"
import { cn } from "@/lib/utils"

/**
 * The count on the Validations entry: portal bons waiting for a decision,
 * plus flagged ones nobody has looked at.
 *
 * Polled, deliberately — every 30 s while the tab is visible, on focus, and
 * whenever this tab itself changes the queue. A queue a handful of people
 * watch, filled a few times a day, does not justify holding a socket open;
 * the cost is up to 30 s of delay on a bon that will wait for a human anyway.
 *
 * When the pending count goes **up**, a toast says so — on every back-office
 * page, since the sidebar is everywhere. Never on the first read: arriving on
 * a page with three bons waiting is not news.
 */

const CHANGED = "senexus:ipm-validations-changed"
const INTERVAL_MS = 30_000

/** Call after approving, refusing or acknowledging, so the badge re-reads. */
export function announceValidationsChanged(): void {
  window.dispatchEvent(new Event(CHANGED))
}

type Counts = { pending: number; toVerify: number }

export function ValidationsBadge({
  firmSlug,
  collapsed,
}: {
  firmSlug: string
  collapsed: boolean
}) {
  const router = useRouter()
  const [counts, setCounts] = React.useState<Counts | null>(null)
  const lastPending = React.useRef<number | null>(null)

  React.useEffect(() => {
    let cancelled = false
    let inFlight = false

    async function load() {
      if (inFlight || document.visibilityState === "hidden") return
      inFlight = true
      try {
        const response = await fetch(`/${firmSlug}/api/ipm/validations/count`, {
          cache: "no-store",
        })
        if (!response.ok || cancelled) return
        const next = (await response.json()) as Counts
        if (cancelled) return

        if (lastPending.current !== null && next.pending > lastPending.current) {
          notify.warning("Nouveau bon à valider", {
            description:
              next.pending > 1
                ? `${next.pending} bons du portail attendent une validation.`
                : "Un bon du portail attend une validation.",
            action: {
              label: "Ouvrir",
              onClick: () => router.push(`/${firmSlug}/ipm/validations`),
            },
          })
        }
        lastPending.current = next.pending
        setCounts(next)
      } catch {
        // Offline or mid-deploy: keep the last count, try again next tick.
      } finally {
        inFlight = false
      }
    }

    void load()
    const timer = window.setInterval(() => void load(), INTERVAL_MS)
    const onFocus = () => void load()
    window.addEventListener("focus", onFocus)
    window.addEventListener(CHANGED, onFocus)
    document.addEventListener("visibilitychange", onFocus)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener("focus", onFocus)
      window.removeEventListener(CHANGED, onFocus)
      document.removeEventListener("visibilitychange", onFocus)
    }
  }, [firmSlug, router])

  const total = counts ? counts.pending + counts.toVerify : 0
  if (total === 0) return null

  const label = `${counts!.pending} en attente, ${counts!.toVerify} à vérifier`

  if (collapsed) {
    return (
      <span
        aria-label={label}
        title={label}
        className="absolute top-1 right-1 size-2 rounded-full bg-signal"
      />
    )
  }

  return (
    <span
      aria-label={label}
      title={label}
      className={cn(
        "num ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold",
        counts!.pending > 0 ? "bg-signal text-white" : "bg-sunken text-ink-2"
      )}
    >
      {total}
    </span>
  )
}
