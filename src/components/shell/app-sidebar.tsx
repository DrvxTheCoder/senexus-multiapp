"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Search01Icon,
  SidebarLeft01Icon,
} from "@hugeicons/core-free-icons"

import { FirmLogo } from "@/components/firm-logo"
import { useFirm } from "@/components/firm-provider"
import { visibleNavGroups, type NavGroup } from "@/components/shell/nav-config"
import { UserMenu } from "@/components/shell/user-menu"
import { setSidebarCollapsed } from "@/server/preferences/actions"
import { cn } from "@/lib/utils"

/**
 * §5.1 — the labelled sidebar. 226px, collapsible to an icon rail, collapse
 * state persisted per user through a server action.
 *
 * Anatomy, top to bottom:
 *
 *   brand      the firm's mark and name, plus the two controls that act on the
 *              shell itself — alerts and the collapse toggle
 *   search     opens the command palette (⌘K)
 *   navigation one collapsible section per module, so switching a module off
 *              removes a whole labelled part rather than silently dropping an
 *              item from a flat list
 *   context    effectif par client, then the pinned legal-ceiling card
 *   account    the consolidated profile popover — entreprises, profil, thème,
 *              déconnexion
 *
 * `alerts`, `clientNav` and `riskCard` are slots filled by server components
 * higher up, so the shell never fetches anything itself.
 */
export function AppSidebar({
  initialCollapsed,
  alerts,
  clientNav,
  riskCard,
}: {
  initialCollapsed: boolean
  alerts?: React.ReactNode
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

  const toggleButton = (
    <button
      type="button"
      onClick={toggle}
      aria-label={collapsed ? "Déplier le menu" : "Replier le menu"}
      aria-expanded={!collapsed}
      className="grid size-7 shrink-0 place-items-center rounded-[7px] text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
    >
      <HugeiconsIcon
        icon={SidebarLeft01Icon}
        size={16}
        strokeWidth={1.8}
        className={cn(collapsed && "rotate-180")}
      />
    </button>
  )

  return (
    <nav
      aria-label="Navigation principale"
      data-collapsed={collapsed ? "1" : "0"}
      className={cn(
        "flex shrink-0 flex-col border-r border-line bg-sub transition-[width] duration-150",
        collapsed ? "w-[62px]" : "w-side"
      )}
    >
      {/* Brand. The firm switcher lives in the account popover, so this block
          identifies the firm rather than acting as a control. */}
      {collapsed ? (
        <div className="flex flex-col items-center gap-1 px-3 py-2.5">
          <Link href={`/${firm.slug}/dashboard`} title={firm.name}>
            <FirmLogo name={firm.name} logo={firm.logo} themeColor={firm.themeHex} />
          </Link>
          {alerts}
          {toggleButton}
        </div>
      ) : (
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <Link
            href={`/${firm.slug}/dashboard`}
            className="flex min-w-0 flex-1 items-center gap-2.5"
          >
            <FirmLogo name={firm.name} logo={firm.logo} themeColor={firm.themeHex} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-semibold tracking-[-0.012em]">
                {firm.name}
              </span>
              <span className="-mt-0.5 block truncate text-[11px] text-ink-3">
                Senexus Group
              </span>
            </span>
          </Link>
          {alerts}
          {toggleButton}
        </div>
      )}

      <button
        type="button"
        className={cn(
          "mx-3 mb-3 flex h-[31px] items-center gap-2 rounded-[7px] border border-line bg-surface px-2.5 text-[13px] text-ink-3 hover:border-line-2",
          collapsed && "justify-center px-0"
        )}
        onClick={() => {
          document.dispatchEvent(new CustomEvent("senexus:open-command"))
        }}
        title={collapsed ? "Rechercher (⌘K)" : undefined}
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
        <p className="px-5 pt-3 pb-1.5 text-[11px] font-medium tracking-[0.02em] text-ink-3 uppercase">
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
