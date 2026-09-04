"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon, Download01Icon, Share08Icon } from "@hugeicons/core-free-icons"

/**
 * Q14 — the install affordance, available on **every** route.
 *
 * The old application only offered this on the firm selector and a few other
 * pages, never on sign-in — which is the first page a new user sees. This lives
 * in the root layout, so it behaves identically everywhere. (The proxy also has
 * to let `/manifest.webmanifest` through unauthenticated, or the browser cannot
 * consider the sign-in page installable at all.)
 *
 * Two paths, because the platforms differ:
 *
 * - Chromium fires `beforeinstallprompt`, which we capture and replay from our
 *   own button.
 * - iOS Safari fires nothing and exposes no API, so the only honest thing is to
 *   describe the Share → "Sur l'écran d'accueil" gesture, and only to iOS users
 *   who are not already running installed.
 *
 * Browser-only facts (dismissal, display mode, platform) are read through
 * `useSyncExternalStore` rather than assigned in an effect: it is the API for
 * subscribing to state React does not own, it renders correctly on the server,
 * and it avoids the cascading render an effect-then-setState would cause.
 */

const DISMISS_KEY = "senexus.install-prompt.dismissed"

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** "hidden" | "chromium" | "ios" — what, if anything, to offer. */
function readSnapshot(): string {
  if (typeof window === "undefined") return "hidden"

  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari exposes its own flag rather than the media query.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  if (standalone) return "hidden"

  try {
    if (window.localStorage.getItem(DISMISS_KEY) === "1") return "hidden"
  } catch {
    // A browser refusing storage simply gets the offer again next visit.
  }

  if (deferredPrompt) return "chromium"
  if (/iphone|ipad|ipod/i.test(window.navigator.userAgent)) return "ios"
  return "hidden"
}

/** Nothing is offered during server rendering; the client decides on mount. */
const serverSnapshot = () => "hidden"

let deferredPrompt: BeforeInstallPromptEvent | null = null

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Keep the browser from showing its own mini-infobar, so the offer appears
    // in one place on our terms.
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    notify()
  })

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null
    try {
      window.localStorage.setItem(DISMISS_KEY, "1")
    } catch {
      // Nothing to do; the display-mode check will hide it anyway.
    }
    notify()
  })
}

export function InstallPrompt() {
  const mode = React.useSyncExternalStore(subscribe, readSnapshot, serverSnapshot)

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1")
    } catch {
      deferredPrompt = null
    }
    notify()
  }

  async function install() {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    await deferredPrompt.userChoice
    deferredPrompt = null
    notify()
  }

  if (mode === "hidden") return null

  return (
    <div
      role="complementary"
      aria-label="Installer l'application"
      className="fixed right-4 bottom-4 z-50 flex max-w-[340px] items-start gap-3 rounded-[11px] border border-line bg-surface p-3 shadow-[0_9px_30px_rgba(19,30,28,0.18)] motion-safe:animate-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-200"
    >
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand text-[11px] font-semibold text-brand-contrast"
      >
        SX
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold">Installer Senexus</p>
        {mode === "chromium" ? (
          <>
            <p className="mt-0.5 text-[12.5px] text-ink-2">
              Ouvrez l'application depuis votre bureau, sans passer par le
              navigateur.
            </p>
            <button
              type="button"
              onClick={install}
              className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-[7px] bg-ink px-2.5 text-[12.5px] font-medium text-paper"
            >
              <HugeiconsIcon icon={Download01Icon} size={13} />
              Installer
            </button>
          </>
        ) : (
          <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[12.5px] text-ink-2">
            Touchez
            <HugeiconsIcon
              icon={Share08Icon}
              size={13}
              className="inline text-ink"
              aria-label="Partager"
            />
            puis « Sur l'écran d'accueil ».
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Ne plus proposer"
        className="rounded-md p-1 text-ink-3 hover:bg-sunken hover:text-ink"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={14} />
      </button>
    </div>
  )
}
