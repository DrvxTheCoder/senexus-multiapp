import type { Metadata, Viewport } from "next"
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

/**
 * §4.3 — IBM Plex Sans for everything, IBM Plex Mono for identifiers only.
 * Self-hosted by next/font, so there is no request to Google at runtime.
 *
 * The brief asks for weight 450; the Google Fonts release of IBM Plex Sans
 * ships 100–700 in hundreds only, so 400/500/600 are what actually exist. Text
 * that wants 450 in the prototype uses 500 here.
 */
const plexSans = IBM_Plex_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
})

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
})

export const metadata: Metadata = {
  title: {
    default: "Senexus",
    template: "%s · Senexus",
  },
  description: "Gestion du personnel et des contrats du groupe Senexus.",
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EFF1EE" },
    { media: "(prefers-color-scheme: dark)", color: "#131E1C" },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="fr"
      suppressHydrationWarning
      className={cn(plexSans.variable, plexMono.variable, "font-sans")}
    >
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
