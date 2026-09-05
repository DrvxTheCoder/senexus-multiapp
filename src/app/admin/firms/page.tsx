import type { Metadata } from "next"

import { AdminPageHeader } from "@/app/admin/admin-page-header"
import { FirmsTable } from "@/app/admin/firms/firms-table"
import { db } from "@/lib/db"
import { HR_MODULE_SLUG, derivePrefix } from "@/server/domain/matricule"
import { requireHoldingAccess } from "@/server/auth/require-firm-access"

export const metadata: Metadata = { title: "Entreprises" }

export type AdminFirm = {
  id: string
  name: string
  slug: string
  logo: string | null
  themeColor: string | null
  matriculePrefix: string
  prefixIsDefault: boolean
  employees: number
  clients: number
  members: number
  modules: string[]
}

export default async function AdminFirmsPage() {
  await requireHoldingAccess()

  const rows = await db.firm.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      logo: true,
      themeColor: true,
      _count: { select: { employees: true, clients: true, userFirms: true } },
      firmModules: {
        select: {
          isEnabled: true,
          settings: true,
          module: { select: { slug: true } },
        },
      },
    },
  })

  const firms: AdminFirm[] = rows.map((firm) => {
    const hrModule = firm.firmModules.find(
      (entry) => entry.module.slug === HR_MODULE_SLUG
    )
    const settings = hrModule?.settings as { matriculePrefix?: unknown } | null
    const configured =
      typeof settings?.matriculePrefix === "string"
        ? settings.matriculePrefix
        : null

    return {
      id: firm.id,
      name: firm.name,
      slug: firm.slug,
      logo: firm.logo?.trim() ? firm.logo : null,
      themeColor: firm.themeColor,
      // Shown so an administrator can see at a glance which firms are still on
      // a guessed prefix rather than a chosen one.
      matriculePrefix: configured ?? derivePrefix(firm.slug),
      prefixIsDefault: configured === null,
      employees: firm._count.employees,
      clients: firm._count.clients,
      members: firm._count.userFirms,
      modules: firm.firmModules
        .filter((entry) => entry.isEnabled)
        .map((entry) => entry.module.slug)
        .sort(),
    }
  })

  return (
    <>
      <AdminPageHeader
        title="Entreprises"
        description="Les filiales du groupe, leur identité et leurs modules."
      />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1420px] p-4.5">
          <FirmsTable firms={firms} />
        </div>
      </div>
    </>
  )
}
