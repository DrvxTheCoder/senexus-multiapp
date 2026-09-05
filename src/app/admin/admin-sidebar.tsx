"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import { useTheme } from "next-themes"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowLeft01Icon,
  Building03Icon,
  ComputerIcon,
  DashboardSquare01Icon,
  Logout01Icon,
  Moon02Icon,
  MoreHorizontalIcon,
  PackageIcon,
  Sun03Icon,
  UserMultipleIcon,
} from "@hugeicons/core-free-icons"

import { Avatar } from "@/components/primitives"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { initials } from "@/lib/format"
import { cn } from "@/lib/utils"

const NAV = [
  { label: "Vue d'ensemble", href: "/admin", icon: DashboardSquare01Icon },
  { label: "Entreprises", href: "/admin/firms", icon: Building03Icon },
  { label: "Utilisateurs", href: "/admin/users", icon: UserMultipleIcon },
  { label: "Modules", href: "/admin/modules", icon: PackageIcon },
]

/**
 * The console's own sidebar.
 *
 * Same anatomy as the firm sidebar so the two do not feel like different
 * applications, but no firm switcher: there is nothing to switch between here.
 * The way back out is explicit, because an administrator who lands in the
 * console should never have to guess how to return to their own firm.
 */
export function AdminSidebar({
  user,
}: {
  user: { name: string | null; email: string }
}) {
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()
  const name = user.name ?? user.email

  return (
    <nav
      aria-label="Navigation de l'administration"
      className="flex w-side shrink-0 flex-col border-r border-line bg-sub"
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span
          aria-hidden
          className="grid size-[26px] shrink-0 place-items-center rounded-[7px] bg-ink text-[10.5px] font-semibold text-paper"
        >
          SX
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold tracking-[-0.012em]">
            Administration
          </span>
          <span className="-mt-0.5 block truncate text-[11px] text-ink-3">
            Senexus Group
          </span>
        </span>
      </div>

      <p className="px-5 pt-2 pb-1.5 text-[11px] font-medium text-ink-3">
        Groupe
      </p>

      <ul className="flex-1 px-2">
        {NAV.map((item) => {
          const active =
            item.href === "/admin"
              ? pathname === "/admin"
              : pathname.startsWith(item.href)
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                data-on={active ? "1" : "0"}
                className={cn(
                  "flex items-center gap-2.5 rounded-[7px] px-3 py-1.5 text-[13.5px] text-ink-2 transition-colors",
                  "hover:bg-sunken hover:text-ink",
                  "data-[on=1]:bg-surface data-[on=1]:font-medium data-[on=1]:text-ink data-[on=1]:shadow-[0_0_0_1px_var(--sx-line)]"
                )}
              >
                <HugeiconsIcon
                  icon={item.icon}
                  size={16}
                  strokeWidth={1.8}
                  className={cn("shrink-0", active ? "opacity-100" : "opacity-70")}
                />
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>

      <Link
        href="/"
        className="mx-3 mb-2.5 flex items-center gap-2 rounded-[7px] border border-line bg-surface px-2.5 py-1.5 text-[12.5px] text-ink-2 hover:bg-sub hover:text-ink"
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
        Retour aux entreprises
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label="Menu du compte"
              className="flex w-full items-center gap-2.5 border-t border-line px-3.5 py-2.5 text-left transition-colors hover:bg-sunken"
            >
              <Avatar initials={initials(name)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium">
                  {name}
                </span>
                <span className="block truncate text-[11px] text-ink-3">
                  Administration
                </span>
              </span>
              <HugeiconsIcon
                icon={MoreHorizontalIcon}
                size={15}
                className="shrink-0 text-ink-3"
              />
            </button>
          }
        />
        <DropdownMenuContent side="top" align="start" className="w-60">
          <DropdownMenuRadioGroup
            value={theme ?? "system"}
            onValueChange={(value) => setTheme(String(value))}
          >
            {/* Inside the radio group, not before it: `DropdownMenuLabel` is a
                Base UI GroupLabel and throws outside its group. */}
            <DropdownMenuLabel className="text-[11px] font-medium text-ink-3">
              Thème
            </DropdownMenuLabel>
            <DropdownMenuRadioItem value="light">
              <HugeiconsIcon icon={Sun03Icon} size={15} />
              Clair
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <HugeiconsIcon icon={Moon02Icon} size={15} />
              Sombre
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">
              <HugeiconsIcon icon={ComputerIcon} size={15} />
              Système
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            variant="destructive"
            onClick={() => void signOut({ callbackUrl: "/auth/sign-in" })}
          >
            <HugeiconsIcon icon={Logout01Icon} size={15} />
            Déconnexion
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  )
}
