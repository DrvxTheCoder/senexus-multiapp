"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons"

import { Pager } from "@/components/list-controls"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/**
 * Recherche et pagination du relevé.
 *
 * Kept in the URL like the period, so a link to page 4 of a relevé filtered on
 * one participant opens on exactly that. Every change other than the page
 * itself sends the reader back to page 1: page 4 of a different cut is not the
 * page they were on.
 */
function useStatementParams() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  return React.useCallback(
    (changes: Record<string, string | null>, mode: "push" | "replace" = "push") => {
      const next = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) next.delete(key)
        else next.set(key, value)
      }
      const query = next.toString()
      router[mode](query ? `${pathname}?${query}` : pathname, { scroll: false })
    },
    [router, pathname, searchParams]
  )
}

export function StatementSearch({ value }: { value: string }) {
  const setParams = useStatementParams()
  const [search, setSearch] = React.useState({ draft: value, url: value })
  if (search.url !== value) setSearch({ draft: value, url: value })

  // Debounced: a query per keystroke over thousands of participants is three
  // useless round trips on the way to the name the user is still typing.
  React.useEffect(() => {
    if (search.draft === value) return
    const timer = setTimeout(() => {
      setParams({ q: search.draft || null, page: null }, "replace")
    }, 300)
    return () => clearTimeout(timer)
  }, [search.draft, value, setParams])

  return (
    <div className="flex h-[29px] w-full max-w-[260px] items-center gap-2 rounded-[7px] border border-line bg-surface px-2.5">
      <HugeiconsIcon icon={Search01Icon} size={13} className="text-ink-3" />
      <input
        value={search.draft}
        onChange={(event) =>
          setSearch((current) => ({ ...current, draft: event.target.value }))
        }
        placeholder="Nom ou matricule…"
        aria-label="Rechercher un participant"
        className="w-full border-none bg-transparent text-[12.5px] outline-none"
      />
      {search.draft ? (
        <button
          type="button"
          onClick={() => setSearch((current) => ({ ...current, draft: "" }))}
          aria-label="Effacer la recherche"
          className="text-ink-3 hover:text-ink"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} />
        </button>
      ) : null}
    </div>
  )
}

export function StatementPager({
  page,
  pageCount,
  perPage,
  sizes,
}: {
  page: number
  pageCount: number
  perPage: number
  sizes: readonly number[]
}) {
  const setParams = useStatementParams()
  const items = sizes.map((size) => ({ value: String(size), label: String(size) }))

  return (
    <span className="flex flex-wrap items-center gap-3">
      <span className="flex items-center gap-1.5 text-ink-3">
        <Select
          value={String(perPage)}
          onValueChange={(next) =>
            setParams({ per: next ? String(next) : null, page: null })
          }
          items={items}
        >
          <SelectTrigger
            size="sm"
            className="h-[25px] min-w-0 gap-1 px-2 text-[12px]"
            aria-label="Participants par page"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        par page
      </span>
      <Pager
        page={page}
        pageCount={pageCount}
        onChange={(next) => setParams({ page: next > 1 ? String(next) : null })}
      />
    </span>
  )
}
