"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { selectTriggerClass } from "@/components/forms/form-field"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const MONTHS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
]

/**
 * La période du relevé.
 *
 * The page already read these four numbers from the URL; there was simply no
 * way to change them without editing the address bar. Keeping them in the URL
 * rather than in component state is what makes a relevé shareable — the link
 * someone sends to the direction shows the same period they were looking at.
 *
 * Applied on submit rather than on every change: four selects that each
 * re-query the register would make three useless round trips on the way to the
 * period the user actually wanted.
 */
export function StatementPeriod({
  from,
  to,
  basePath,
}: {
  from: { year: number; month: number }
  to: { year: number; month: number }
  basePath: string
}) {
  const router = useRouter()
  const [draft, setDraft] = React.useState({
    fromYear: from.year,
    fromMonth: from.month,
    toYear: to.year,
    toMonth: to.month,
  })

  const thisYear = new Date().getFullYear()
  const years = Array.from({ length: 6 }, (_, index) => thisYear - 4 + index)

  // An end before the start returns nothing and says nothing about why, so the
  // button refuses rather than the query.
  const ordered =
    draft.fromYear * 12 + draft.fromMonth <= draft.toYear * 12 + draft.toMonth

  const unchanged =
    draft.fromYear === from.year &&
    draft.fromMonth === from.month &&
    draft.toYear === to.year &&
    draft.toMonth === to.month

  const apply = () => {
    const params = new URLSearchParams({
      fromYear: String(draft.fromYear),
      fromMonth: String(draft.fromMonth),
      toYear: String(draft.toYear),
      toMonth: String(draft.toMonth),
    })
    router.push(`${basePath}?${params.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Bound
        label="Du"
        year={draft.fromYear}
        month={draft.fromMonth}
        years={years}
        onChange={(next) =>
          setDraft((state) => ({
            ...state,
            fromYear: next.year,
            fromMonth: next.month,
          }))
        }
      />
      <Bound
        label="Au"
        year={draft.toYear}
        month={draft.toMonth}
        years={years}
        onChange={(next) =>
          setDraft((state) => ({
            ...state,
            toYear: next.year,
            toMonth: next.month,
          }))
        }
      />
      <Button size="sm" disabled={!ordered || unchanged} onClick={apply}>
        {ordered ? "Afficher" : "Période inversée"}
      </Button>
    </div>
  )
}

function Bound({
  label,
  year,
  month,
  years,
  onChange,
}: {
  label: string
  year: number
  month: number
  years: number[]
  onChange: (next: { year: number; month: number }) => void
}) {
  const monthItems = MONTHS.map((name, index) => ({
    value: String(index + 1),
    label: name,
  }))
  const yearItems = years.map((value) => ({
    value: String(value),
    label: String(value),
  }))

  return (
    <div>
      <span className="mb-1 block text-[11.5px] text-ink-3">{label}</span>
      <div className="flex items-center gap-1.5">
        <Select
          value={String(month)}
          onValueChange={(next) =>
            onChange({ year, month: Number(next ?? month) })
          }
          items={monthItems}
        >
          <SelectTrigger
            className={selectTriggerClass}
            aria-label={`${label} — mois`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {monthItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select
          value={String(year)}
          onValueChange={(next) =>
            onChange({ year: Number(next ?? year), month })
          }
          items={yearItems}
        >
          <SelectTrigger
            className={selectTriggerClass}
            aria-label={`${label} — exercice`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {yearItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
