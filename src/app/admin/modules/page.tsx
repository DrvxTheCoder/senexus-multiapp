import type { Metadata } from "next"

import { AdminPageHeader } from "@/app/admin/admin-page-header"
import { ModulesManager } from "@/app/admin/modules/modules-manager"
import { db } from "@/lib/db"
import { requireHoldingAccess } from "@/server/auth/require-firm-access"

export const metadata: Metadata = { title: "Modules" }

export type AdminModule = {
  id: string
  slug: string
  name: string
  description: string | null
  version: string
  basePath: string
  isSystem: boolean
  isActive: boolean
  installs: number
  dependsOn: string[]
}

export type ModuleFirm = {
  id: string
  name: string
  slug: string
  /** moduleId → enabled. Absent means not installed. */
  installed: Record<string, boolean>
}

export default async function AdminModulesPage() {
  await requireHoldingAccess()

  const [modules, firms] = await Promise.all([
    db.module.findMany({
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        version: true,
        basePath: true,
        isSystem: true,
        isActive: true,
        _count: { select: { firmModules: true } },
        dependencies: { select: { dependsOn: { select: { slug: true } } } },
      },
    }),
    db.firm.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        firmModules: { select: { moduleId: true, isEnabled: true } },
      },
    }),
  ])

  return (
    <>
      <AdminPageHeader
        title="Modules"
        description="Ce qu'une entreprise peut ouvrir. Un module désactivé masque sa navigation et renvoie 404."
      />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1420px] p-4.5">
          <ModulesManager
            modules={modules.map((module) => ({
              id: module.id,
              slug: module.slug,
              name: module.name,
              description: module.description,
              version: module.version,
              basePath: module.basePath,
              isSystem: module.isSystem,
              isActive: module.isActive,
              installs: module._count.firmModules,
              dependsOn: module.dependencies.map((d) => d.dependsOn.slug),
            }))}
            firms={firms.map((firm) => ({
              id: firm.id,
              name: firm.name,
              slug: firm.slug,
              installed: Object.fromEntries(
                firm.firmModules.map((entry) => [entry.moduleId, entry.isEnabled])
              ),
            }))}
            hasDocumentsModule={modules.some((m) => m.slug === "documents")}
          />
        </div>
      </div>
    </>
  )
}
