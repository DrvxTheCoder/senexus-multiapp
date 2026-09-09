"use client"

import * as React from "react"
import { usePathname, useSearchParams } from "next/navigation"

/**
 * The navigation progress line, on the top bar's lower edge.
 *
 * App Router gives no navigation-start event — `usePathname` only changes once
 * the new route has committed, which is the *end* of the wait, not the
 * beginning. So the start is taken from the gesture that causes it: a
 * left-click on a same-origin link, or a back/forward. That is the same
 * approach the nprogress bridges take, kept here as ~90 lines against the sx
 * tokens rather than pulled in as a dependency with its own palette.
 *
 * Anything that is not a page navigation must opt out with `data-no-progress` —
 * the export links are downloads, so they never change the pathname and would
 * otherwise leave the bar hanging until the safety timeout.
 *
 * §4.8: the bar is functional, not decorative. It appears only after a short
 * grace period, so a fast navigation — which most are, the shell being
 * persistent — shows nothing at all rather than a flash of bar.
 */

/** Below this, a navigation is "instant" and shows no bar. */
const GRACE_MS = 180
/** A navigation that never commits still has to release the bar. */
const MAX_MS = 12_000

/**
 * `useSearchParams` suspends, and this mounts in a layout that wraps every
 * route. The boundary lives here so no shell has to remember it.
 */
export function RouteProgress() {
  return (
    <React.Suspense fallback={null}>
      <RouteProgressBar />
    </React.Suspense>
  )
}

function RouteProgressBar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [value, setValue] = React.useState(0)
  const [visible, setVisible] = React.useState(false)

  const grace = React.useRef<number | undefined>(undefined)
  const trickle = React.useRef<number | undefined>(undefined)
  const hide = React.useRef<number | undefined>(undefined)
  const max = React.useRef<number | undefined>(undefined)
  /** A navigation is in flight. */
  const running = React.useRef(false)
  /** The bar actually made it onto the screen, so it owes an exit. */
  const shown = React.useRef(false)

  const clearTimers = React.useCallback(() => {
    window.clearTimeout(grace.current)
    window.clearInterval(trickle.current)
    window.clearTimeout(hide.current)
    window.clearTimeout(max.current)
    grace.current = trickle.current = hide.current = max.current = undefined
  }, [])

  const reset = React.useCallback(() => {
    running.current = false
    shown.current = false
    clearTimers()
    setVisible(false)
    setValue(0)
  }, [clearTimers])

  const start = React.useCallback(() => {
    if (running.current) return
    running.current = true
    clearTimers()

    grace.current = window.setTimeout(() => {
      shown.current = true
      setVisible(true)
      setValue(12)
      // Ease towards 90% and stop: the last tenth belongs to the commit, and a
      // bar that reaches the end before the page does is a lie.
      trickle.current = window.setInterval(() => {
        setValue((v) => (v >= 90 ? v : v + Math.max(0.5, (90 - v) * 0.09)))
      }, 200)
    }, GRACE_MS)

    max.current = window.setTimeout(reset, MAX_MS)
  }, [clearTimers, reset])

  const done = React.useCallback(() => {
    if (!running.current) return
    running.current = false

    // Beat the grace period: the navigation was instant, so leave the interface
    // untouched rather than flashing a completed bar at the user.
    if (!shown.current) {
      reset()
      return
    }

    clearTimers()
    setValue(100)
    hide.current = window.setTimeout(reset, 220)
  }, [clearTimers, reset])

  // The commit. `searchParams` is in the dependency list because filtering and
  // paging are navigations too, and they are the slowest ones in the app.
  React.useEffect(() => {
    done()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams])

  React.useEffect(() => () => clearTimers(), [clearTimers])

  React.useEffect(() => {
    function onClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }

      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest("a[href]")
      if (!(anchor instanceof HTMLAnchorElement)) return

      if (anchor.hasAttribute("download")) return
      if (anchor.dataset.noProgress !== undefined) return
      if (anchor.target && anchor.target !== "_self") return

      let url: URL
      try {
        url = new URL(anchor.href, window.location.href)
      } catch {
        return
      }

      if (url.origin !== window.location.origin) return
      // A pure hash change, or a link to where we already are.
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      ) {
        return
      }

      start()
    }

    document.addEventListener("click", onClick, { capture: true })
    window.addEventListener("popstate", start)
    return () => {
      document.removeEventListener("click", onClick, { capture: true })
      window.removeEventListener("popstate", start)
    }
  }, [start])

  if (!visible) return null

  return (
    <div
      // Progress, not status: there is nothing for a screen reader to do with
      // a trickling percentage, and the destination page announces itself.
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-top z-40 h-px -translate-y-px"
    >
      <div
        className="h-full bg-brand transition-[width,opacity] duration-200 ease-out"
        style={{ width: `${value}%`, opacity: value >= 100 ? 0 : 1 }}
      />
    </div>
  )
}
