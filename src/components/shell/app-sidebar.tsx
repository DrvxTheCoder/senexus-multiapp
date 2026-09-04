"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  MoreHorizontalIcon,
  Search01Icon,
  SidebarLeft01Icon,
} from "@hugeicons/core-free-icons"

import { useFirm } from "@/components/firm-provider"
import { WORKSPACE_NAV, visibleNavItems } from "@/components/shell/nav-config"
import { setSidebarCollapsed } from "@/server/preferences/actions"
import { cn } from "@/lib/utils"

/**
 * §5.1 — the labelled sidebar. 226px, collapsible to icons, collapse state
 * persisted per user through a server action.
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

  const items = visibleNavItems(WORKSPACE_NAV, firm.modules)

  function toggle() {
    const next = !collapsed
    setCollapsed(next)
    startTransition(() => {
      void setSidebarCollapsed(firm.slug, next)
    })
  }

  const initials = firm.name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase()

  return (
    <nav
      aria-label="Navigation principale"
      data-collapsed={collapsed ? "1" : "0"}
      className={cn(
        "flex shrink-0 flex-col border-r border-line bg-sub transition-[width] duration-150",
        collapsed ? "w-[62px]" : "w-side"
      )}
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span
          aria-hidden
          className="grid size-[26px] shrink-0 place-items-center rounded-[7px] bg-brand text-[10.5px] font-semibold text-brand-contrast"
        >
          {initials}
        </span>
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
            {firm.memberships.length > 1 ? (
              <FirmSwitcher currentSlug={firm.slug} />
            ) : null}
          </>
        ) : null}
      </div>

      <button
        type="button"
        data-command-trigger
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
        {!collapsed ? (
          <p className="px-5 pt-2 pb-1.5 text-[11px] font-medium text-ink-3">
            {WORKSPACE_NAV.label}
          </p>
        ) : null}

        <ul className="px-2">
          {items.map((item) => {
            const href = `/${firm.slug}${item.href}`
            const active =
              pathname === href || pathname.startsWith(`${href}/`)
            return (
              <li key={item.href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  title={collapsed ? item.label : undefined}
                  data-on={active ? "1" : "0"}
                  className={cn(
                    "flex items-center gap-2.5 rounded-[7px] px-3 py-1.5 text-[13.5px] text-ink-2 transition-colors",
                    "hover:bg-sunken hover:text-ink",
                    "data-[on=1]:bg-surface data-[on=1]:font-medium data-[on=1]:text-ink data-[on=1]:shadow-[0_0_0_1px_var(--sx-line)]",
                    collapsed && "justify-center px-0"
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

        {!collapsed ? clientNav : null}
      </div>

      {!collapsed ? riskCard : null}

      <div className="flex items-center gap-2.5 border-t border-line px-3.5 py-2.5">
        <span
          aria-hidden
          className="grid size-[26px] shrink-0 place-items-center rounded-full bg-brand-tint text-[10px] font-semibold text-brand"
        >
          {(firm.user.name ?? firm.user.email)
            .split(/\s+/)
            .slice(0, 2)
            .map((word) => word[0] ?? "")
            .join("")
            .toUpperCase()}
        </span>
        {!collapsed ? (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium">
                {firm.user.name ?? firm.user.email}
              </span>
              <span className="block truncate text-[11px] text-ink-3">
                {ROLE_LABELS[firm.role]}
              </span>
            </span>
            <button
              type="button"
              aria-label="Menu utilisateur"
              className="rounded p-1 text-ink-3 hover:bg-sunken hover:text-ink"
            >
              <HugeiconsIcon icon={MoreHorizontalIcon} size={15} />
            </button>
          </>
        ) : null}
      </div>

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

const ROLE_LABELS: Record<string, string> = {
  OWNER: "Propriétaire",
  ADMIN: "Administrateur",
  MANAGER: "Responsable RH",
  RESPONSABLE: "Responsable client",
  STAFF: "Collaborateur",
  VIEWER: "Lecture seule",
}

function FirmSwitcher({ currentSlug }: { currentSlug: string }) {
  const firm = useFirm()
  const [open, setOpen] = React.useState(false)

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Changer d'entreprise"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="rounded p-1 text-ink-3 hover:bg-sunken hover:text-ink"
      >
        <HugeiconsIcon icon={ArrowDown01Icon} size={14} />
      </button>
      {open ? (
        <ul className="absolute top-full left-0 z-50 mt-1 w-52 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg">
          {firm.memberships.map((membership) => (
            <li key={membership.firmId}>
              <Link
                href={`/${membership.firmSlug}/dashboard`}
                onClick={() => setOpen(false)}
                className={cn(
                  "block px-3 py-1.5 text-[13px] hover:bg-brand-wash",
                  membership.firmSlug === currentSlug && "font-medium text-brand"
                )}
              >
                {membership.firmName}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
