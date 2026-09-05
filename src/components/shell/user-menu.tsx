"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { signOut } from "next-auth/react"
import { useTheme } from "next-themes"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon,
  ComputerIcon,
  Logout01Icon,
  Moon02Icon,
  Settings02Icon,
  Sun03Icon,
  Tick02Icon,
  UnfoldMoreIcon,
  UserSettings01Icon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"

import { FirmLogo } from "@/components/firm-logo"
import { useFirm } from "@/components/firm-provider"
import { Avatar } from "@/components/primitives"
import { ROLE_LABELS, roleLabel } from "@/components/shell/role-labels"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { initials } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * The account popover at the foot of the sidebar.
 *
 * One menu holds everything about *who you are and where you are*: the
 * entreprises you belong to, your profile, the theme, and Déconnexion. Firm
 * switching used to live in a second dropdown up in the brand block; putting
 * both in one place means the brand block can be what it should be — the firm's
 * identity plus the two controls that act on the sidebar itself.
 *
 * The theme is a three-way choice rendered as an inline segmented control
 * rather than three stacked rows: it is a setting with a current value, not a
 * command, and showing all three states at once says so. They are real
 * `RadioItem`s, so arrow keys reach them and choosing one does not close the
 * menu.
 */

const THEMES: { value: string; label: string; icon: IconSvgElement }[] = [
  { value: "light", label: "Clair", icon: Sun03Icon },
  { value: "dark", label: "Sombre", icon: Moon02Icon },
  { value: "system", label: "Système", icon: ComputerIcon },
]

/**
 * Module scope, not render-time detection: the popup only ever mounts in the
 * browser, so this is read once and cannot produce a hydration mismatch.
 */
const IS_APPLE =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)

const MOD = IS_APPLE ? "⌘" : "Ctrl"

export function UserMenu({ collapsed }: { collapsed: boolean }) {
  const firm = useFirm()
  const router = useRouter()

  const name = firm.user.name ?? firm.user.email
  const profileHref = `/${firm.slug}/settings/profile`

  const canAdminister = firm.memberships.some(
    (membership) => membership.role === "OWNER" || membership.role === "ADMIN"
  )

  // The shortcuts are printed in the menu, so they have to exist. Anything
  // printed and not wired is worse than nothing.
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = IS_APPLE ? event.metaKey : event.ctrlKey
      if (!mod || !event.shiftKey || event.altKey) return

      const key = event.key.toLowerCase()
      if (key === "p") {
        event.preventDefault()
        router.push(profileHref)
      } else if (key === "q") {
        event.preventDefault()
        void signOut({ callbackUrl: "/auth/sign-in" })
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [router, profileHref])

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
                  icon={UnfoldMoreIcon}
                  size={15}
                  strokeWidth={1.8}
                  className="shrink-0 text-ink-3"
                />
              </>
            ) : null}
          </button>
        }
      />

      <DropdownMenuContent side="top" align="start" className="w-[268px]">
        <div className="flex items-center gap-2.5 px-1.5 py-2">
          <Avatar initials={initials(name)} size={32} />
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium">{name}</span>
            <span className="block truncate text-[11.5px] text-ink-3">
              {firm.user.email}
            </span>
          </span>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="text-[11px] font-medium text-ink-3">
          Entreprises
        </DropdownMenuLabel>

        {firm.memberships.map((membership) => {
          const current = membership.firmSlug === firm.slug
          return (
            <DropdownMenuItem
              key={membership.firmId}
              className="gap-2.5 py-1.5"
              render={
                <Link href={`/${membership.firmSlug}/dashboard`}>
                  <FirmLogo
                    name={membership.firmName}
                    logo={membership.logo}
                    themeColor={membership.themeColor}
                    size={20}
                    radius={5}
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {membership.firmName}
                  </span>
                  {current ? (
                    <HugeiconsIcon
                      icon={Tick02Icon}
                      size={14}
                      strokeWidth={2.2}
                      className="shrink-0 text-brand"
                    />
                  ) : (
                    <span className="text-[10.5px] text-ink-3">
                      {roleLabel(membership.role)}
                    </span>
                  )}
                </Link>
              }
            />
          )
        })}

        {canAdminister ? (
          <>
            <DropdownMenuItem
              className="gap-2.5 py-1.5 text-ink-2"
              render={
                <Link href="/admin/firms">
                  <span
                    aria-hidden
                    className="grid size-5 shrink-0 place-items-center rounded-[5px] border border-dashed border-line-2 text-ink-3"
                  >
                    <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={2} />
                  </span>
                  <span className="text-[13px]">Nouvelle entreprise</span>
                </Link>
              }
            />
            <DropdownMenuItem
              className="gap-2.5 py-1.5 text-ink-2"
              render={
                <Link href="/admin">
                  <span
                    aria-hidden
                    className="grid size-5 shrink-0 place-items-center text-ink-3"
                  >
                    <HugeiconsIcon icon={Settings02Icon} size={14} />
                  </span>
                  <span className="text-[13px]">Administration</span>
                </Link>
              }
            />
          </>
        ) : null}

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="text-[11px] font-medium text-ink-3">
          Compte
        </DropdownMenuLabel>

        <DropdownMenuItem
          className="gap-2.5 py-1.5"
          render={
            <Link href={profileHref}>
              <HugeiconsIcon icon={UserSettings01Icon} size={15} />
              <span className="text-[13px]">Profil</span>
              <DropdownMenuShortcut>⇧{MOD}P</DropdownMenuShortcut>
            </Link>
          }
        />
        <DropdownMenuItem
          className="gap-2.5 py-1.5"
          render={
            <Link href={`/${firm.slug}/settings`}>
              <HugeiconsIcon icon={Settings02Icon} size={15} />
              <span className="text-[13px]">Préférences</span>
            </Link>
          }
        />

        <ThemeRow />

        <DropdownMenuSeparator />

        <DropdownMenuItem
          variant="destructive"
          className="gap-2.5 py-1.5"
          onClick={() => void signOut({ callbackUrl: "/auth/sign-in" })}
        >
          <HugeiconsIcon icon={Logout01Icon} size={15} />
          <span className="text-[13px]">Déconnexion</span>
          <DropdownMenuShortcut>⇧{MOD}Q</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* -------------------------------------------------------------------------- */

function ThemeRow() {
  const { theme, setTheme } = useTheme()

  // No mounted guard: this content is portalled on open, so next-themes has
  // already read storage by the time it renders. `system` is the provider
  // default and the correct fallback.
  const current = theme ?? "system"

  return (
    <div className="flex items-center gap-2 px-1.5 py-1">
      <span className="flex-1 text-[13px]">Thème</span>
      <DropdownMenuRadioGroup
        value={current}
        onValueChange={(value) => setTheme(String(value))}
        aria-label="Thème"
        className="flex items-center gap-0.5 rounded-[7px] border border-line bg-sub p-0.5"
      >
        {THEMES.map((option) => (
          <DropdownMenuRadioItem
            key={option.value}
            value={option.value}
            aria-label={option.label}
            title={option.label}
            className={cn(
              "grid size-[22px] place-items-center rounded-[5px] p-0 text-ink-3",
              "data-[checked]:bg-surface data-[checked]:text-ink data-[checked]:shadow-[0_0_0_1px_var(--sx-line)]",
              // The stacked-list tick would sit on top of the icon here; the
              // selected segment already carries the state.
              "[&_[data-slot=dropdown-menu-radio-item-indicator]]:hidden"
            )}
          >
            <HugeiconsIcon icon={option.icon} size={14} strokeWidth={1.8} />
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </div>
  )
}
