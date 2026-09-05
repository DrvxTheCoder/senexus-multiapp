"use client"

import * as React from "react"
import Link from "next/link"
import { signOut } from "next-auth/react"
import { useTheme } from "next-themes"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Building03Icon,
  ComputerIcon,
  Logout01Icon,
  Moon02Icon,
  MoreHorizontalIcon,
  Sun03Icon,
  UserSettings01Icon,
} from "@hugeicons/core-free-icons"

import { useFirm } from "@/components/firm-provider"
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
import { ROLE_LABELS } from "@/components/shell/role-labels"
import { cn } from "@/lib/utils"

/**
 * The account chip at the foot of the sidebar.
 *
 * Everything a signed-in person needs and could not previously reach: their
 * profile, the theme, the list of firms, and **Déconnexion** — which did not
 * exist at all in this rebuild until now.
 *
 * The theme is a genuine three-way choice (clair / sombre / système) rather
 * than the two-state flip the legacy app shipped, where "système" was reachable
 * only through the command palette.
 */
export function UserMenu({ collapsed }: { collapsed: boolean }) {
  const firm = useFirm()
  const { theme, setTheme } = useTheme()

  // No mounted guard is needed: the menu content is portalled on open, so by
  // the time this renders next-themes has already read storage on the client.
  // `system` is the provider default and the correct fallback.
  const current = theme ?? "system"

  const name = firm.user.name ?? firm.user.email

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Menu du compte"
            className={cn(
              "flex w-full items-center gap-2.5 border-t border-line px-3.5 py-2.5 text-left transition-colors hover:bg-sunken",
              collapsed && "justify-center px-0"
            )}
          >
            <Avatar initials={initials(name)} />
            {!collapsed ? (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium">
                    {name}
                  </span>
                  <span className="block truncate text-[11px] text-ink-3">
                    {ROLE_LABELS[firm.role] ?? firm.role}
                  </span>
                </span>
                <HugeiconsIcon
                  icon={MoreHorizontalIcon}
                  size={15}
                  className="shrink-0 text-ink-3"
                />
              </>
            ) : null}
          </button>
        }
      />

      <DropdownMenuContent side="top" align="start" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-[13px] font-medium">{name}</span>
          <span className="block truncate text-[11.5px] text-ink-3">
            {firm.user.email}
          </span>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          render={
            <Link href={`/${firm.slug}/settings/profile`}>
              <HugeiconsIcon icon={UserSettings01Icon} size={15} />
              Profil
            </Link>
          }
        />
        <DropdownMenuItem
          render={
            <Link href="/">
              <HugeiconsIcon icon={Building03Icon} size={15} />
              Changer d&apos;entreprise
            </Link>
          }
        />

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="text-[11px] font-medium text-ink-3">
          Thème
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(value) => setTheme(String(value))}
        >
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
  )
}
