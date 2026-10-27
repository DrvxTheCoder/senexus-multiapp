import { NAV_GROUPS } from "@/components/shell/nav-config"

/**
 * Where a firm's home is, and whether it has the HR workspace at all.
 *
 * The tableau de bord and the décisions queue are built entirely from
 * employees, contracts and the interim ceiling. A firm like the IPM has none of
 * those, so for it they are two empty pages in front of the module it actually
 * runs. `Firm.homeModule` marks such a firm: `null` is an HR firm, a module
 * slug is a firm whose home is that module.
 *
 * Isomorphic — the server builds breadcrumbs with it and the firm switcher
 * builds links with it — so every "go home" link agrees on where home is.
 */
export type FirmHomeInput = {
  slug: string
  homeModule: string | null
  /** Slugs of the modules enabled for the firm. */
  modules: string[]
}

export function isHrFirm(firm: Pick<FirmHomeInput, "homeModule">): boolean {
  return firm.homeModule === null
}

/** A module's landing page: the first entry of its navigation group. */
function moduleEntry(moduleSlug: string): string | null {
  const group = NAV_GROUPS.find((entry) => entry.module === moduleSlug)
  return group?.items[0]?.href ?? null
}

/**
 * Firm-relative path of the home page, e.g. `/dashboard` or `/ipm`.
 *
 * A home module that has since been switched off would 404, so it falls back
 * to the first enabled module in navigation order, and to the profile page —
 * which every member can open — when the firm has no module left at all. It
 * never falls back to the dashboard: the firm was marked hors RH on purpose.
 */
export function firmHomePath(firm: FirmHomeInput): string {
  if (firm.homeModule === null) return "/dashboard"

  if (firm.modules.includes(firm.homeModule)) {
    const entry = moduleEntry(firm.homeModule)
    if (entry) return entry
  }

  for (const group of NAV_GROUPS) {
    if (group.module && firm.modules.includes(group.module)) {
      const entry = group.items[0]?.href
      if (entry) return entry
    }
  }

  return "/settings/profile"
}

export function firmHomeHref(firm: FirmHomeInput): string {
  return `/${firm.slug}${firmHomePath(firm)}`
}
