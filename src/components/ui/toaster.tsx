"use client"

import { useTheme } from "next-themes"
import { Toaster as SonnerToaster } from "sonner"

/**
 * The one toast surface, mounted once in the root layout.
 *
 * Sonner ships its own palette and its own geometry. Both are overridden here
 * rather than at any call site, for the same reason the select trigger is
 * normalised in `form-field.tsx`: a second visual language next to the sx
 * tokens is the thing §4.x exists to prevent. Colours come from the tokens, so
 * a toast follows the firm theme and the dark class like everything else.
 *
 * `richColors` is deliberately off — it would reintroduce Sonner's own green
 * and red. Tone is carried by the icon and a tinted hairline instead.
 */
export function Toaster() {
  const { resolvedTheme } = useTheme()

  return (
    <SonnerToaster
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="bottom-right"
      // Long enough to read a sentence in French, short enough not to stack up
      // during a burst of row actions.
      duration={4000}
      gap={8}
      visibleToasts={4}
      offset={16}
      toastOptions={{
        classNames: {
          toast:
            "!bg-surface !border !border-line !text-ink !rounded-[9px] !shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-8px_rgba(0,0,0,0.12)] !font-sans !text-[13px] !items-start !gap-2.5 !p-3",
          title: "!text-[13px] !font-medium !leading-[1.35] !text-ink",
          description: "!text-[12px] !leading-[1.4] !text-ink-3 !mt-0.5",
          icon: "!mt-px !mr-0 !shrink-0",
          actionButton:
            "!h-7 !rounded-[6px] !bg-ink !px-2 !text-[12px] !font-medium !text-paper",
          cancelButton:
            "!h-7 !rounded-[6px] !border !border-line !bg-surface !px-2 !text-[12px] !text-ink-2",
          closeButton: "!bg-surface !border-line !text-ink-3",
          success: "!border-ok/35",
          error: "!border-alert/40",
          warning: "!border-signal/40",
          loading: "!border-line",
        },
      }}
    />
  )
}
