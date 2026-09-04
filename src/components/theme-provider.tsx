"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"

/**
 * The scaffold shipped a global `d` hotkey that toggled dark mode. It is
 * removed here: single-letter global shortcuts collide with list navigation and
 * with typing in any surface that is not an input. Theme is switched from the
 * user menu; ⌘K owns the only global shortcut.
 */
function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}

export { ThemeProvider }
