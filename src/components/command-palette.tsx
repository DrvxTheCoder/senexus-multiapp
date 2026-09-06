"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowUpDownIcon,
  Building03Icon,
  CornerDownLeftIcon,
  File01Icon,
  Loading03Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"

import { useFirm } from "@/components/firm-provider"
import { Avatar, ClientDot } from "@/components/primitives"
import { clientDotVar } from "@/lib/client-color"
import { commandSearch } from "@/server/actions/search"
import { visibleNavItems } from "@/components/shell/nav-config"
import type { SearchHit } from "@/server/queries/search"
import { cn } from "@/lib/utils"

/**
 * §5.2 — the command palette.
 *
 * The brief calls this the single biggest fix for the "too many clicks"
 * complaint, so it is a feature rather than a nicety: real server-side search
 * over employees, clients and contracts, debounced, firm-scoped and
 * role-scoped, plus navigation, all reachable from ⌘K anywhere.
 *
 * Search runs on the server through an action, so a responsable typing a name
 * finds only people at their own clients — the palette cannot become a way
 * around the scoping the lists enforce.
 */

const KIND_ICON: Record<SearchHit["kind"], IconSvgElement> = {
  employee: Search01Icon,
  client: Building03Icon,
  contract: File01Icon,
}

const KIND_SECTION: Record<SearchHit["kind"], string> = {
  employee: "Employés",
  client: "Clients",
  contract: "Contrats",
}

type NavHit = {
  id: string
  label: string
  sublabel: string
  href: string
  icon: IconSvgElement
}

export function CommandPalette() {
  const firm = useFirm()
  const router = useRouter()

  const [open, setOpen] = React.useState(false)
  const [term, setTerm] = React.useState("")
  const [results, setResults] = React.useState<{
    term: string
    hits: SearchHit[]
  } | null>(null)
  const [active, setActive] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const restoreRef = React.useRef<HTMLElement | null>(null)

  /* ---- open / close ----------------------------------------------------- */
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setOpen((value) => !value)
      }
      if (event.key === "Escape") close()
    }

    function onTrigger() {
      setOpen(true)
    }

    window.addEventListener("keydown", onKeyDown)
    document.addEventListener("senexus:open-command", onTrigger)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("senexus:open-command", onTrigger)
    }
  }, [])

  // Opening and closing only touch refs and the DOM; the query state is reset
  // by `close()` at the point of closing, so no effect writes state here.
  React.useEffect(() => {
    if (open) {
      restoreRef.current = document.activeElement as HTMLElement | null
      inputRef.current?.focus()
    } else {
      restoreRef.current?.focus()
    }
  }, [open])

  /* ---- debounced server search ------------------------------------------ */
  // Results are keyed by the term they were fetched for, so `searching` and the
  // displayed hits are derived rather than a second and third piece of state
  // that have to be kept in step with it.
  const trimmed = term.trim()
  const searchable = trimmed.length >= 2

  React.useEffect(() => {
    if (!searchable) return
    let cancelled = false
    const timer = setTimeout(() => {
      void commandSearch(firm.slug, trimmed).then((results) => {
        if (!cancelled) setResults({ term: trimmed, hits: results })
      })
    }, 180)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [trimmed, searchable, firm.slug])

  const hits = searchable && results?.term === trimmed ? results.hits : []
  const searching = searchable && results?.term !== trimmed

  /* ---- navigation entries, filtered client-side (they are a fixed list) -- */
  const navHits: NavHit[] = React.useMemo(() => {
    const trimmed = term.trim().toLowerCase()
    return visibleNavItems(firm.modules)
      .filter((item) => !trimmed || item.label.toLowerCase().includes(trimmed))
      .slice(0, trimmed ? 4 : 8)
      .map((item) => ({
        id: item.href,
        label: item.label,
        sublabel: "Aller à",
        href: `/${firm.slug}${item.href}`,
        icon: item.icon,
      }))
  }, [term, firm.modules, firm.slug])

  type Row =
    | { key: string; section: string; hit: SearchHit }
    | { key: string; section: string; nav: NavHit }

  const rows: Row[] = React.useMemo(() => {
    const grouped: Row[] = []
    for (const kind of ["employee", "client", "contract"] as const) {
      for (const hit of hits.filter((entry) => entry.kind === kind)) {
        grouped.push({ key: `${kind}-${hit.id}`, section: KIND_SECTION[kind], hit })
      }
    }
    for (const nav of navHits) {
      grouped.push({ key: `nav-${nav.id}`, section: "Navigation", nav })
    }
    return grouped
  }, [hits, navHits])

  const clampedActive = Math.min(active, Math.max(0, rows.length - 1))

  function close() {
    setOpen(false)
    setTerm("")
    setActive(0)
  }

  function run(row: Row) {
    close()
    router.push("hit" in row ? row.hit.href : row.nav.href)
  }

  if (!open) return null

  let lastSection: string | null = null

  return (
    <div
      className="fixed inset-0 z-60 flex justify-center bg-black/10 backdrop-blur-xs pt-[11vh] motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
      onMouseDown={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Recherche"
        onMouseDown={(event) => event.stopPropagation()}
        className={cn(
          "flex h-fit max-h-[70vh] w-140 max-w-[92%] flex-col overflow-hidden rounded-xl bg-surface shadow-lg border",
          "",
          "motion-safe:animate-in motion-safe:slide-in-from-top-2 motion-safe:duration-150"
        )}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <HugeiconsIcon icon={Search01Icon} size={17} className="text-ink-3" />
          <input
            ref={inputRef}
            value={term}
            onChange={(event) => {
              setTerm(event.target.value)
              setActive(0)
            }}
            placeholder="Nom, matricule, client, page…"
            aria-label="Rechercher"
            aria-controls="command-results"
            className="w-full border-none bg-transparent text-[15px] outline-none placeholder:text-ink-3"
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault()
                setActive((value) => Math.min(rows.length - 1, value + 1))
              }
              if (event.key === "ArrowUp") {
                event.preventDefault()
                setActive((value) => Math.max(0, value - 1))
              }
              if (event.key === "Enter" && rows[clampedActive]) {
                event.preventDefault()
                run(rows[clampedActive])
              }
            }}
          />
          {searching ? (
            <HugeiconsIcon icon={Loading03Icon} className="h-4 animate-spin ease-in-out" />
          ) : null}
        </div>

        <div id="command-results" role="listbox" className="overflow-y-auto pb-1.5">
          {rows.length === 0 ? (
            <p className="px-4 py-7 text-center text-[13px] text-ink-3">
              {term.trim().length < 2
                ? "Tapez au moins deux caractères."
                : "Aucun résultat. Essayez un matricule."}
            </p>
          ) : (
            rows.map((row, index) => {
              const header = row.section !== lastSection ? row.section : null
              lastSection = row.section
              const selected = index === clampedActive

              return (
                <React.Fragment key={row.key}>
                  {header ? (
                    <p className="px-4 pt-2.5 pb-1 text-[10.5px] font-medium text-ink-3">
                      {header}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => run(row)}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-4 py-1.5 text-left text-[13.5px]",
                      selected && "bg-brand-wash"
                    )}
                  >
                    {"hit" in row ? (
                      row.hit.kind === "employee" ? (
                        <Avatar initials={row.hit.initials ?? "?"} size={23} />
                      ) : row.hit.accentId ? (
                        <ClientDot
                          colorVar={clientDotVar(row.hit.accentId)}
                          className="size-2.5"
                        />
                      ) : (
                        <HugeiconsIcon
                          icon={KIND_ICON[row.hit.kind]}
                          size={16}
                          className="text-ink-3"
                        />
                      )
                    ) : (
                      <HugeiconsIcon icon={row.nav.icon} size={16} className="text-ink-3" />
                    )}

                    <span className="truncate">
                      {"hit" in row ? row.hit.label : row.nav.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-3">
                      {"hit" in row ? row.hit.sublabel : row.nav.sublabel}
                    </span>
                    {selected ? (
                      <HugeiconsIcon
                        icon={CornerDownLeftIcon}
                        size={13}
                        className="shrink-0 text-ink-3"
                      />
                    ) : null}
                  </button>
                </React.Fragment>
              )
            })
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-line bg-sub px-4 py-2 text-[11.5px] text-ink-2">
          <span className="flex items-center gap-1 bg-muted rounded-md border px-1.5 py-0.5 text-xs">
            <HugeiconsIcon icon={ArrowUpDownIcon} className="size-2" /> Naviguer
          </span>
          <span className="flex items-center gap-1 bg-muted rounded-md border px-1.5 py-0.5 text-xs">
            <HugeiconsIcon icon={CornerDownLeftIcon} className="size-2" /> Ouvrir
          </span>
          <span className="flex items-center gap-1 bg-muted rounded-md border px-1.5 py-0.5 text-xs">
            <small className="text-[0.5rem]">Echap</small> Fermer
          </span>
        </div>
      </div>
    </div>
  )
}
