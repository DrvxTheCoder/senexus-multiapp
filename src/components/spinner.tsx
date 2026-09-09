"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import { Loading03Icon } from "@hugeicons/core-free-icons"

import { cn } from "@/lib/utils"

/**
 * The in-button pending indicator.
 *
 * One component so that every button in the application spins the same glyph at
 * the same size — the sign-in button set the pattern and it is lifted here
 * rather than re-typed. It sits *after* the label, so the button's text does
 * not shift when it appears.
 *
 * `aria-hidden` on purpose: the button is already `disabled` and its label
 * already changes to a pending verb, which is what a screen reader announces.
 * A third signal would just be noise.
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <HugeiconsIcon
      icon={Loading03Icon}
      aria-hidden
      className={cn("h-4 shrink-0 animate-spin motion-reduce:animate-none", className)}
    />
  )
}
