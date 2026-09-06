"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * §4.6 — the shared machinery behind the charts.
 *
 * The charts stay hand-drawn SVG (see charts.tsx) but interactivity needs a
 * client boundary and a few pieces every chart repeats: the mount reveal, the
 * pointer tracking, and the tooltip surface. They live here so a chart file
 * reads as shapes rather than as plumbing.
 */

/** The house easing. Slow in, fast through, settle — reads as physical. */
export const EASE = "cubic-bezier(0.85, 0, 0.15, 1)"
export const DURATION = 1100

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)"

/**
 * True when the chart should be drawn at full value.
 *
 * The default is **true**, and that direction is deliberate. A reveal that
 * starts from zero and is opened by JavaScript means the finished chart is the
 * one state the server cannot render: without scripts, before hydration, or
 * with an error in between, every bar sits at zero and the panel reads as empty
 * data rather than as a chart that has not animated yet. So the honest value is
 * the resting state, and the animation is what gets added afterwards.
 *
 * `collapse()` is what an animating chart calls for its from-state: it returns
 * the zero value only in the window where a mounted, motion-tolerant chart is
 * waiting to be scrolled into view.
 */
/**
 * The collapsed from-state is committed by the browser, not by React, so the
 * transition always has a painted value to start from. React re-rendering into
 * the collapsed state and back out of it in adjacent frames gets coalesced into
 * one layout, and the chart snaps to full size with no visible animation — the
 * failure this class avoids.
 *
 * `data-reveal="pending"` is set the moment the element is observed; the CSS
 * rule for it zeroes the marks. Removing the attribute lets them transition
 * back to the values already in the markup.
 */
export function useReveal<T extends Element>() {
  const ref = React.useRef<T>(null)

  React.useEffect(() => {
    const node = ref.current
    if (!node) return
    if (window.matchMedia(REDUCED_MOTION).matches) return

    node.setAttribute("data-reveal", "pending")

    let raf = 0
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        // One frame is enough here: the attribute was written straight to the
        // DOM on mount, so the collapsed geometry has already been laid out
        // and painted by the time this runs.
        raf = requestAnimationFrame(() => node.removeAttribute("data-reveal"))
      },
      { threshold: 0.25 }
    )
    observer.observe(node)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(raf)
      node.removeAttribute("data-reveal")
    }
  }, [])

  return ref
}

/* -------------------------------------------------------------------------- */

/**
 * The tooltip surface. Positioned by the caller in percentages so it works
 * inside any responsive SVG; it flips to the other side of the cursor near the
 * right edge so it is never clipped by the panel.
 */
export function ChartTooltip({
  x,
  y,
  flip,
  children,
}: {
  /** 0–100, percentage across the plot. */
  x: number
  /** 0–100, percentage down the plot. Omit to pin to the top. */
  y?: number
  flip?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      role="tooltip"
      className={cn(
        "pointer-events-none absolute z-10 min-w-[104px] rounded-[7px] border border-line",
        "bg-surface px-2.5 py-1.5 shadow-[0_4px_16px_-4px_rgb(0_0_0/0.18)]",
        "transition-[left,top] duration-100 ease-out"
      )}
      style={{
        left: `${x}%`,
        top: y === undefined ? 0 : `${y}%`,
        transform: `translate(${flip ? "calc(-100% - 12px)" : "12px"}, ${
          y === undefined ? "0" : "-50%"
        })`,
      }}
    >
      {children}
    </div>
  )
}

/** One `label — value` line inside a tooltip. */
export function TooltipRow({
  swatch,
  label,
  value,
}: {
  swatch?: string
  label: React.ReactNode
  value: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2 text-[11.5px] leading-[17px] whitespace-nowrap">
      {swatch ? (
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ background: swatch }}
        />
      ) : null}
      <span className="text-ink-2">{label}</span>
      <span className="num ml-auto font-medium text-ink">{value}</span>
    </div>
  )
}

export function TooltipTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 border-b border-line pb-1 text-[11px] font-medium text-ink">
      {children}
    </div>
  )
}
