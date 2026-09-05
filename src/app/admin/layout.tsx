import { forbidden, unauthorized } from "next/navigation"

import { AdminSidebar } from "@/app/admin/admin-sidebar"
import { getSession, requireHoldingAccess } from "@/server/auth/require-firm-access"
import { ForbiddenError, UnauthorizedError } from "@/server/errors"

/**
 * The administration console.
 *
 * Deliberately outside `/[firmSlug]`: its subject is the group rather than one
 * firm, so it has its own shell and its own gate. `requireHoldingAccess`
 * reproduces the legacy rule — OWNER or ADMIN of any firm — and, unlike the
 * legacy API routes, actually enforces it on every action underneath.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  try {
    await requireHoldingAccess()
  } catch (error) {
    if (error instanceof UnauthorizedError) unauthorized()
    if (error instanceof ForbiddenError) forbidden()
    throw error
  }

  const session = await getSession()

  return (
    <div className="flex h-svh overflow-hidden bg-paper">
      <AdminSidebar
        user={{
          name: session?.user?.name ?? null,
          email: session?.user?.email ?? "",
        }}
      />
      <main id="main" className="relative flex min-w-0 flex-1 flex-col">
        {children}
      </main>
    </div>
  )
}
