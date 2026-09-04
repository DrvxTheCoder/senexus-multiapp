import type { Metadata, Viewport } from "next"
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google"

import "./globals.css"
import { NuqsAdapter } from "nuqs/adapters/next/app"

import { InstallPrompt } from "@/components/install-prompt"
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
  applicationName: "Senexus",
  // Q14 — declared once, in the root layout, so every route is installable.
  // The old application only wired this on some pages, which is why the prompt
  // never appeared on the login screen.
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Senexus",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  // Personnel data has no business in a search index.
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EFF1EE" },
    { media: "(prefers-color-scheme: dark)", color: "#131E1C" },
  ],
  // An installed window should reach under the notch rather than letterbox.
  viewportFit: "cover",
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
        <a
          href="#main"
          className="sr-only rounded-md bg-ink px-3 py-2 text-paper focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-100"
        >
          Aller au contenu
        </a>
        <NuqsAdapter>
          <ThemeProvider>
            {children}
            <InstallPrompt />
          </ThemeProvider>
        </NuqsAdapter>
      </body>
    </html>
  )
}
