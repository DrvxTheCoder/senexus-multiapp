import {
  ArrowDataTransferHorizontalIcon,
  Building03Icon,
  Calendar03Icon,
  CreditCardIcon,
  CheckmarkCircle02Icon,
  DashboardSquare01Icon,
  File01Icon,
  Folder01Icon,
  HealthIcon,
  Settings02Icon,
  UserMultipleIcon,
  UserSettings01Icon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"

/**
 * §3.4 — modules gate navigation and authorisation, not rendering. Every entry
 * here is a real file-system route; nothing dispatches through a component map.
 *
 * Navigation is **grouped by module**, the way the legacy sidebar does it: one
 * collapsible group per module, whose label is the module's name. That is the
 * honest shape — "Clients" belongs to CRM, "Contrats" to RH — and it means a
 * firm that has CRM switched off loses a whole labelled section rather than
 * having one item quietly vanish from a flat list.
 *
 * A group's `module` is the `Module.slug` that must be enabled for the firm.
 * Groups whose module is disabled are hidden here and 404 at the route.
 */
export type NavItem = {
  label: string
  href: string
  icon: IconSvgElement
}

export type NavGroup = {
  id: string
  label: string
  /** `null` for groups that are not gated on a module. */
  module: string | null
  /** Rendered as a collapsible section; single-item groups render flat. */
  collapsible: boolean
  icon?: IconSvgElement
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "workspace",
    label: "Espace de travail",
    module: null,
    collapsible: false,
    items: [
      {
        label: "Tableau de bord",
        href: "/dashboard",
        icon: DashboardSquare01Icon,
      },
      {
        label: "Décisions",
        href: "/decisions",
        icon: CheckmarkCircle02Icon,
      },
    ],
  },
  {
    id: "hr",
    label: "Ressources Humaines",
    module: "hr",
    collapsible: true,
    icon: UserMultipleIcon,
    items: [
      { label: "Employés", href: "/hr/employees", icon: UserMultipleIcon },
      { label: "Contrats", href: "/hr/contracts", icon: File01Icon },
      { label: "Congés", href: "/hr/leaves", icon: Calendar03Icon },
      {
        label: "Transferts",
        href: "/hr/transfers",
        icon: ArrowDataTransferHorizontalIcon,
      },
    ],
  },
  {
    id: "crm",
    label: "CRM",
    module: "crm",
    collapsible: true,
    icon: Building03Icon,
    items: [{ label: "Clients", href: "/crm/clients", icon: Building03Icon }],
  },
  {
    id: "documents",
    label: "Documents",
    // Its own module, so its route sits at the firm root rather than under /hr
    // and a firm can switch it off independently of HR.
    module: "documents",
    collapsible: false,
    items: [{ label: "Documents", href: "/documents", icon: Folder01Icon }],
  },
  {
    id: "ipm",
    label: "Prévoyance maladie",
    // Health data. The module gate is the only thing standing between a firm
    // that has no business seeing prestations and the pages that show them, so
    // this entry must never be given `module: null` for convenience.
    module: "ipm",
    collapsible: true,
    icon: HealthIcon,
    items: [
      { label: "Vue d'ensemble", href: "/ipm", icon: HealthIcon },
      { label: "Participants", href: "/ipm/participants", icon: UserMultipleIcon },
      { label: "Employeurs", href: "/ipm/employeurs", icon: Building03Icon },
      { label: "Cartes", href: "/ipm/cartes", icon: CreditCardIcon },
      { label: "Formules", href: "/ipm/formules", icon: File01Icon },
      { label: "Référentiel", href: "/ipm/referentiel", icon: Settings02Icon },
    ],
  },
  {
    id: "account",
    label: "Compte",
    module: null,
    collapsible: true,
    icon: Settings02Icon,
    items: [
      { label: "Profil", href: "/settings/profile", icon: UserSettings01Icon },
      { label: "Paramètres", href: "/settings", icon: Settings02Icon },
    ],
  },
]

/** Groups the firm actually has, with their items. Empty groups are dropped. */
export function visibleNavGroups(enabledModules: string[]): NavGroup[] {
  return NAV_GROUPS.filter(
    (group) => group.module === null || enabledModules.includes(group.module)
  ).filter((group) => group.items.length > 0)
}

/** Flat list of every reachable item — used by the command palette. */
export function visibleNavItems(enabledModules: string[]): NavItem[] {
  return visibleNavGroups(enabledModules).flatMap((group) => group.items)
}
