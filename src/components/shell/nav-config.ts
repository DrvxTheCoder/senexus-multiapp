import {
  ArrowDataTransferHorizontalIcon,
  Building03Icon,
  Calendar03Icon,
  CheckmarkCircle02Icon,
  DashboardSquare01Icon,
  File01Icon,
  Folder01Icon,
  Settings02Icon,
  UserMultipleIcon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"

/**
 * §3.4 — modules gate navigation and authorisation, not rendering. Every entry
 * here is a real file-system route; nothing dispatches through a component map.
 *
 * `module` is the `Module.slug` that must be enabled for the firm. Entries
 * whose module is disabled are hidden here and 404 at the route.
 */
export type NavItem = {
  label: string
  href: string
  icon: IconSvgElement
  module: string | null
}

export type NavGroup = {
  label: string
  items: NavItem[]
}

export const WORKSPACE_NAV: NavGroup = {
  label: "Espace de travail",
  items: [
    {
      label: "Tableau de bord",
      href: "/dashboard",
      icon: DashboardSquare01Icon,
      module: null,
    },
    {
      label: "Décisions",
      href: "/decisions",
      icon: CheckmarkCircle02Icon,
      module: null,
    },
    {
      label: "Employés",
      href: "/hr/employees",
      icon: UserMultipleIcon,
      module: "hr",
    },
    {
      label: "Contrats",
      href: "/hr/contracts",
      icon: File01Icon,
      module: "hr",
    },
    {
      label: "Clients",
      href: "/crm/clients",
      icon: Building03Icon,
      module: "crm",
    },
    {
      label: "Congés",
      href: "/hr/leaves",
      icon: Calendar03Icon,
      module: "hr",
    },
    {
      label: "Transferts",
      href: "/hr/transfers",
      icon: ArrowDataTransferHorizontalIcon,
      module: "hr",
    },
    {
      label: "Documents",
      href: "/hr/documents",
      icon: Folder01Icon,
      module: "hr",
    },
    {
      label: "Paramètres",
      href: "/settings",
      icon: Settings02Icon,
      module: null,
    },
  ],
}

export function visibleNavItems(
  group: NavGroup,
  enabledModules: string[]
): NavItem[] {
  return group.items.filter(
    (item) => item.module === null || enabledModules.includes(item.module)
  )
}
