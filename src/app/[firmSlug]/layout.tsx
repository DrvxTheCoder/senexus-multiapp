import { Suspense } from "react"

import { AppSidebar } from "@/components/shell/app-sidebar"
import { CommandPalette } from "@/components/command-palette"
import {
  SidebarClientGroup,
  SidebarRiskCard,
} from "@/components/shell/sidebar-context"
import { FirmProvider } from "@/components/firm-provider"
import { getSession } from "@/server/auth/require-firm-access"
import { requireFirmPage } from "@/server/auth/firm-page"
import { buildFirmTheme } from "@/server/firms/theme"
import { getUiState } from "@/server/preferences/ui-state"

/**
 * §3.1 — the firm is resolved once, here, in a server component.
 *
 * Everything below this layout receives the resolved firm: server components
 * through `requireFirmAccess` (same request, same `cache()` entry, no second
 * query) and client components through `FirmProvider`. No page and no client
 * component ever looks a firm up by slug again, and there is no client-side
 * fetch between the shell painting and the page painting.
 *
 * The brand colour is written into a <style> block here rather than applied by
 * a client provider, so the correct brand is present in the very first paint.
 */
export default async function FirmLayout({
  children,
  params,
}: LayoutProps<"/[firmSlug]">) {
  const { firmSlug } = await params

  const ctx = await requireFirmPage(firmSlug)

  const [session, uiState] = await Promise.all([
    getSession(),
    getUiState(ctx.userId, ctx.firmId),
  ])

  const theme = buildFirmTheme(ctx.firm.themeColor)

  return (
    <>
      {theme.css ? (
        <style
          // Server-rendered brand, first paint. Values are derived from a
          // validated hex, never interpolated from the raw column.
          dangerouslySetInnerHTML={{ __html: theme.css }}
        />
      ) : null}

      <FirmProvider
        value={{
          id: ctx.firm.id,
          slug: ctx.firm.slug,
          name: ctx.firm.name,
          logo: ctx.firm.logo || null,
          themeHex: theme.hex,
          modules: ctx.firm.modules,
          role: ctx.role,
          memberships: session?.user.memberships ?? [],
          user: {
            id: ctx.userId,
            name: ctx.userName,
            email: ctx.userEmail,
          },
        }}
      >
        <div className="flex h-svh overflow-hidden bg-paper">
          <AppSidebar
            initialCollapsed={uiState.sidebarCollapsed}
            // Server-rendered slots: the sidebar never fetches anything itself.
            // Suspense keeps a slow aggregate from delaying the whole shell.
            clientNav={
              <Suspense fallback={null}>
                <SidebarClientGroup ctx={ctx} />
              </Suspense>
            }
            riskCard={
              <Suspense fallback={null}>
                <SidebarRiskCard ctx={ctx} />
              </Suspense>
            }
          />
          <main id="main" className="relative flex min-w-0 flex-1 flex-col">
            {children}
          </main>
          <CommandPalette />
        </div>
      </FirmProvider>
    </>
  )
}
