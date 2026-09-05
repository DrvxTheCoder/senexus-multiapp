"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Search01Icon,
  Settings02Icon,
  SidebarLeft01Icon,
} from "@hugeicons/core-free-icons"

import { FirmLogo } from "@/components/firm-logo"
import { useFirm } from "@/components/firm-provider"
import { visibleNavGroups, type NavGroup } from "@/components/shell/nav-config"
import { UserMenu } from "@/components/shell/user-menu"
import { setSidebarCollapsed } from "@/server/preferences/actions"
import { cn } from "@/lib/utils"

/**
 * §5.1 — the labelled sidebar. 226px, collapsible to icons, collapse state
 * persisted per user through a server action.
 *
 * Navigation is grouped by module (see nav-config): each module is one
 * collapsible section, so switching a module off removes a whole labelled part
 * of the sidebar rather than silently dropping an item from a flat list.
 *
 * `clientNav` and `riskCard` are slots filled by server components higher up,
 * so the shell never fetches anything itself.
 */
export function AppSidebar({
  initialCollapsed,
  clientNav,
  riskCard,
}: {
  initialCollapsed: boolean
  clientNav?: React.ReactNode
  riskCard?: React.ReactNode
}) {
  const firm = useFirm()
  const pathname = usePathname()
  const [collapsed, setCollapsed] = React.useState(initialCollapsed)
  const [, startTransition] = React.useTransition()

  const groups = visibleNavGroups(firm.modules)

  function toggle() {
    const next = !collapsed
    setCollapsed(next)
    startTransition(() => {
      void setSidebarCollapsed(firm.slug, next)
    })
  }

  return (
    <nav
      aria-label="Navigation principale"
      data-collapsed={collapsed ? "1" : "0"}
      className={cn(
        "flex shrink-0 flex-col border-r border-line bg-sub transition-[width] duration-150",
        collapsed ? "w-[62px]" : "w-side"
      )}
    >
      <FirmSwitcher collapsed={collapsed} />

      <button
        type="button"
        className={cn(
          "mx-3 mb-3 flex h-[31px] items-center gap-2 rounded-[7px] border border-line bg-surface px-2.5 text-[13px] text-ink-3 hover:border-line-2",
          collapsed && "justify-center px-0"
        )}
        onClick={() => {
          document.dispatchEvent(new CustomEvent("senexus:open-command"))
        }}
      >
        <HugeiconsIcon icon={Search01Icon} size={14} strokeWidth={1.8} />
        {!collapsed ? (
          <>
            Rechercher…
            <kbd className="ml-auto rounded border border-line bg-sub px-1 font-mono text-[10px]">
              ⌘K
            </kbd>
          </>
        ) : null}
      </button>

      <div className="flex-1 overflow-y-auto">
        {groups.map((group) => (
          <NavGroupSection
            key={group.id}
            group={group}
            firmSlug={firm.slug}
            pathname={pathname}
            collapsed={collapsed}
          />
        ))}

        {!collapsed ? clientNav : null}
      </div>

      {!collapsed ? riskCard : null}

      <UserMenu collapsed={collapsed} />

      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? "Déplier le menu" : "Replier le menu"}
        aria-expanded={!collapsed}
        className="flex items-center justify-center gap-2 border-t border-line py-2 text-[11.5px] text-ink-3 hover:bg-sunken hover:text-ink"
      >
        <HugeiconsIcon
          icon={SidebarLeft01Icon}
          size={15}
          strokeWidth={1.8}
          className={cn(collapsed && "rotate-180")}
        />
        {!collapsed ? "Replier" : null}
      </button>
    </nav>
  )
}

/* -------------------------------------------------------------------------- */

function NavGroupSection({
  group,
  firmSlug,
  pathname,
  collapsed,
}: {
  group: NavGroup
  firmSlug: string
  pathname: string
  collapsed: boolean
}) {
  const hrefFor = (href: string) => `/${firmSlug}${href}`
  const isActive = (href: string) =>
    pathname === hrefFor(href) || pathname.startsWith(`${hrefFor(href)}/`)

  const containsActive = group.items.some((item) => isActive(item.href))

  // Groups start **open**. The legacy sidebar opened only the group holding the
  // current page, which meant that from the dashboard you could not see
  // "Employés" without expanding first — an extra click on the most-used links,
  // in a 226px column with room to spare. Collapsing is available; hiding by
  // default is not the right trade here. A group re-opens if you navigate into
  // it while it is closed.
  const [open, setOpen] = React.useState(true)
  const [lastActive, setLastActive] = React.useState(containsActive)
  if (containsActive !== lastActive) {
    setLastActive(containsActive)
    if (containsActive) setOpen(true)
  }

  const items = (
    <ul className="px-2">
      {group.items.map((item) => {
        const active = isActive(item.href)
        return (
          <li key={item.href}>
            <Link
              href={hrefFor(item.href)}
              aria-current={active ? "page" : undefined}
              title={collapsed ? item.label : undefined}
              data-on={active ? "1" : "0"}
              className={cn(
                "flex items-center gap-2.5 rounded-[7px] px-3 py-1.5 text-[13.5px] text-ink-2 transition-colors",
                "hover:bg-sunken hover:text-ink",
                "data-[on=1]:bg-surface data-[on=1]:font-medium data-[on=1]:text-ink data-[on=1]:shadow-[0_0_0_1px_var(--sx-line)]",
                collapsed && "justify-center px-0",
                !collapsed && group.collapsible && "pl-6"
              )}
            >
              <HugeiconsIcon
                icon={item.icon}
                size={16}
                strokeWidth={1.8}
                className={cn("shrink-0", active ? "opacity-100" : "opacity-70")}
              />
              {!collapsed ? <span className="truncate">{item.label}</span> : null}
            </Link>
          </li>
        )
      })}
    </ul>
  )

  // Collapsed to icons: group headings would be unreadable, so every item is
  // shown flat with its label as a tooltip.
  if (collapsed) return items

  if (!group.collapsible) {
    return (
      <>
        <p className="px-5 pt-3 pb-1.5 text-[11px] font-medium text-ink-3">
          {group.label}
        </p>
        {items}
      </>
    )
  }

  return (
    <div className="pt-1.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={cn(
          "mx-2 flex w-[calc(100%-16px)] items-center gap-2.5 rounded-[7px] px-3 py-1.5 text-[13.5px] transition-colors hover:bg-sunken",
          containsActive ? "font-medium text-ink" : "text-ink-2"
        )}
      >
        {group.icon ? (
          <HugeiconsIcon
            icon={group.icon}
            size={16}
            strokeWidth={1.8}
            className="shrink-0 opacity-70"
          />
        ) : null}
        <span className="truncate">{group.label}</span>
        <HugeiconsIcon
          icon={open ? ArrowDown01Icon : ArrowRight01Icon}
          size={13}
          className="ml-auto shrink-0 text-ink-3"
        />
      </button>
      {open ? items : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * The firm switcher, with the synthetic **Administration** entry the legacy app
 * shows to anyone who is OWNER or ADMIN of any firm. It is not a `Firm` row —
 * it is a role-derived shortcut into the holding-level console.
 */
function FirmSwitcher({ collapsed }: { collapsed: boolean }) {
  const firm = useFirm()
  const [open, setOpen] = React.useState(false)

  const canAdminister = firm.memberships.some(
    (membership) => membership.role === "OWNER" || membership.role === "ADMIN"
  )
  const hasChoice = firm.memberships.length > 1 || canAdminister

  return (
    <div className="relative flex items-center gap-2.5 px-3 py-2.5">
      <FirmLogo name={firm.name} logo={firm.logo} themeColor={firm.themeHex} />

      {!collapsed ? (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-semibold tracking-[-0.012em]">
              {firm.name}
            </span>
            <span className="-mt-0.5 block truncate text-[11px] text-ink-3">
              Senexus Group
            </span>
          </span>

          {hasChoice ? (
            <button
              type="button"
              aria-label="Changer d'entreprise"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
              className="rounded p-1 text-ink-3 hover:bg-sunken hover:text-ink"
            >
              <HugeiconsIcon icon={ArrowDown01Icon} size={14} />
            </button>
          ) : null}
        </>
      ) : null}

      {open ? (
        <>
          <div
            aria-hidden
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <ul className="absolute top-full left-3 z-50 w-56 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg">
            {firm.memberships.map((membership) => (
              <li key={membership.firmId}>
                <Link
                  href={`/${membership.firmSlug}/dashboard`}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-1.5 text-[13px] hover:bg-brand-wash",
                    membership.firmSlug === firm.slug && "font-medium text-brand"
                  )}
                >
                  <FirmLogo
                    name={membership.firmName}
                    logo={membership.logo}
                    themeColor={membership.themeColor}
                    size={20}
                    radius={5}
                  />
                  <span className="truncate">{membership.firmName}</span>
                </Link>
              </li>
            ))}

            {canAdminister ? (
              <>
                <li aria-hidden className="my-1 border-t border-line" />
                <li>
                  <Link
                    href="/admin"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-brand-wash"
                  >
                    <HugeiconsIcon
                      icon={Settings02Icon}
                      size={14}
                      className="text-ink-3"
                    />
                    Administration
                  </Link>
                </li>
              </>
            ) : null}
          </ul>
        </>
      ) : null}
    </div>
  )
}
