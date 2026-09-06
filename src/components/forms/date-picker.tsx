"use client"

import * as React from "react"
import {
  eachMonthOfInterval,
  eachYearOfInterval,
  endOfYear,
  format,
  isValid,
  parse,
  startOfYear,
} from "date-fns"
import { fr } from "date-fns/locale"
import type { CaptionLabelProps, MonthGridProps } from "react-day-picker"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon, Calendar04Icon } from "@hugeicons/core-free-icons"

import { selectTriggerClass } from "@/components/forms/form-field"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/**
 * The date field.
 *
 * Replaces `<input type="date">`, which rendered in OS chrome — a different
 * control on every browser, unstyleable, and English on a French page. This is
 * the ReUI `c-calendar-26` pattern: the caption is a button that opens a year
 * grid, then a month grid, so a date of birth is three clicks from today rather
 * than four hundred and forty months of paging.
 *
 * The value stays an ISO `yyyy-MM-dd` string in both directions, because that
 * is what the zod schemas and the server actions already read. Only the picker
 * changed.
 */

const ISO = "yyyy-MM-dd"

/** Dates of birth reach back decades; contract dates run a few years ahead. */
const YEARS_BACK = 80
const YEARS_AHEAD = 10

function parseISO(value: string): Date | undefined {
  if (!value) return undefined
  const parsed = parse(value, ISO, new Date())
  return isValid(parsed) ? parsed : undefined
}

export function DatePicker({
  id,
  value,
  onChange,
  onBlur,
  disabled,
  invalid,
  describedBy,
}: {
  id: string
  /** ISO `yyyy-MM-dd`, or "" for empty. */
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  disabled?: boolean
  invalid?: boolean
  describedBy?: string
}) {
  const [open, setOpen] = React.useState(false)
  const selected = parseISO(value)

  const today = React.useMemo(() => new Date(), [])
  const startDate = React.useMemo(
    () => startOfYear(new Date(today.getFullYear() - YEARS_BACK, 0)),
    [today]
  )
  const endDate = React.useMemo(
    () => endOfYear(new Date(today.getFullYear() + YEARS_AHEAD, 11)),
    [today]
  )

  const [month, setMonth] = React.useState<Date>(selected ?? today)
  const [isYearView, setIsYearView] = React.useState(false)
  const [selectedYear, setSelectedYear] = React.useState<number | null>(null)

  /**
   * Reopening on a filled field lands on that date rather than on wherever the
   * last visit left the calendar. Done here rather than in an effect on `open`:
   * an effect would re-run and fight the user paging through months.
   */
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setMonth(selected ?? today)
      setIsYearView(false)
      setSelectedYear(null)
    }
    setOpen(next)
  }

  const years = React.useMemo(
    () => eachYearOfInterval({ start: startDate, end: endDate }),
    [startDate, endDate]
  )

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            id={id}
            disabled={disabled}
            // `aria-invalid` is not valid on a button; the error is announced
            // by the Field's role="alert" paragraph, which this points at.
            data-invalid={invalid ? "" : undefined}
            aria-describedby={describedBy}
            onBlur={onBlur}
            className={cn(
              selectTriggerClass,
              "w-full",
              invalid && "border-alert"
            )}
          />
        }
      >
        <span className={cn("truncate", !selected && "text-ink-3")}>
          {selected ? format(selected, "d MMMM yyyy", { locale: fr }) : "Choisir une date"}
        </span>
        <HugeiconsIcon
          icon={Calendar04Icon}
          size={15}
          strokeWidth={1.8}
          aria-hidden
          className="shrink-0 text-ink-3"
        />
      </PopoverTrigger>

      <PopoverContent align="start" className="w-auto overflow-hidden p-0">
        <Calendar
          locale={fr}
          mode="single"
          month={month}
          onMonthChange={setMonth}
          selected={selected}
          onSelect={(date) => {
            onChange(date ? format(date, ISO) : "")
            if (date) setOpen(false)
          }}
          defaultMonth={selected ?? today}
          startMonth={startDate}
          endMonth={endDate}
          classNames={{
            month_caption: "justify-start",
            nav: "flex items-center w-full absolute inset-x-0 justify-end pointer-events-none [&>button]:pointer-events-auto",
          }}
          components={{
            CaptionLabel: (props: CaptionLabelProps) => (
              <CaptionLabel
                isYearView={isYearView}
                setIsYearView={(next) => {
                  setIsYearView(next)
                  if (!next) setSelectedYear(null)
                }}
                {...props}
              />
            ),
            MonthGrid: (props: MonthGridProps) => (
              <MonthGrid
                className={props.className}
                currentMonth={month.getMonth()}
                currentYear={month.getFullYear()}
                isYearView={isYearView}
                years={years}
                selectedYear={selectedYear}
                setSelectedYear={setSelectedYear}
                onMonthSelect={(next) => {
                  setMonth(next)
                  setIsYearView(false)
                  setSelectedYear(null)
                }}
              >
                {props.children}
              </MonthGrid>
            ),
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

/** The caption, as a toggle into the year grid. */
function CaptionLabel({
  children,
  isYearView,
  setIsYearView,
}: {
  isYearView: boolean
  setIsYearView: (next: boolean) => void
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <button
      type="button"
      onClick={() => setIsYearView(!isYearView)}
      aria-expanded={isYearView}
      data-state={isYearView ? "open" : "closed"}
      className="-ms-1 inline-flex items-center gap-1.5 rounded-[6px] px-1.5 py-0.5 text-[13px] font-medium capitalize transition-colors hover:bg-sunken"
    >
      {children}
      <HugeiconsIcon
        icon={ArrowDown01Icon}
        size={13}
        strokeWidth={2}
        aria-hidden
        className={cn("shrink-0 text-ink-3 transition-transform", isYearView && "rotate-180")}
      />
    </button>
  )
}

/**
 * The month grid, with the year/month overlay laid over it. Picking a year
 * narrows to its twelve months; picking a month returns to the day grid.
 */
function MonthGrid({
  className,
  children,
  isYearView,
  years,
  currentYear,
  currentMonth,
  onMonthSelect,
  selectedYear,
  setSelectedYear,
}: {
  className?: string
  children: React.ReactNode
  isYearView: boolean
  years: Date[]
  currentYear: number
  currentMonth: number
  onMonthSelect: (date: Date) => void
  selectedYear: number | null
  setSelectedYear: (year: number | null) => void
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null)

  // Open the year list on the year in view, not at 1946.
  React.useEffect(() => {
    if (!isYearView || !scrollRef.current) return
    scrollRef.current
      .querySelector<HTMLElement>("[data-active='true']")
      ?.scrollIntoView({ block: "center" })
  }, [isYearView, selectedYear])

  return (
    <div className="relative">
      <table className={className}>{children}</table>

      {isYearView ? (
        <div className="absolute inset-0 z-20 -m-2 bg-surface">
          <div ref={scrollRef} className="h-full max-h-[292px] overflow-y-auto px-3 pt-1 pb-3">
            {selectedYear === null ? (
              <div className="grid grid-cols-4 gap-1.5">
                {[...years].reverse().map((year) => {
                  const value = year.getFullYear()
                  const isCurrent = value === currentYear
                  return (
                    <button
                      key={value}
                      type="button"
                      data-active={isCurrent}
                      onClick={() => setSelectedYear(value)}
                      className={cn(
                        "num h-8 rounded-[6px] border text-[12.5px] transition-colors",
                        isCurrent
                          ? "border-brand bg-brand text-brand-contrast"
                          : "border-line hover:bg-sunken"
                      )}
                    >
                      {value}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedYear(null)}
                  className="inline-flex h-8 items-center gap-1 self-start rounded-[6px] px-1.5 text-[12.5px] font-medium transition-colors hover:bg-sunken"
                >
                  <HugeiconsIcon
                    icon={ArrowDown01Icon}
                    size={13}
                    strokeWidth={2}
                    aria-hidden
                    className="rotate-90 text-ink-3"
                  />
                  <span className="num">{selectedYear}</span>
                </button>

                <div className="grid grid-cols-3 gap-1.5">
                  {eachMonthOfInterval({
                    start: startOfYear(new Date(selectedYear, 0)),
                    end: endOfYear(new Date(selectedYear, 0)),
                  }).map((entry) => {
                    const isCurrent =
                      entry.getMonth() === currentMonth && selectedYear === currentYear
                    return (
                      <button
                        key={entry.getTime()}
                        type="button"
                        data-active={isCurrent}
                        onClick={() => onMonthSelect(entry)}
                        className={cn(
                          "h-8 rounded-[6px] border text-[12.5px] capitalize transition-colors",
                          isCurrent
                            ? "border-brand bg-brand text-brand-contrast"
                            : "border-line hover:bg-sunken"
                        )}
                      >
                        {format(entry, "MMM", { locale: fr })}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
