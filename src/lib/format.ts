import {
  differenceInCalendarDays,
  differenceInMonths,
  format as formatDateFns,
} from "date-fns"
import { fr } from "date-fns/locale"

/**
 * §1.3 — one implementation of every format the UI uses.
 *
 * French locale grouping produces U+202F (narrow no-break space) or U+00A0
 * depending on the runtime, and the two disagree between the server and some
 * browsers. We normalise to a plain space so server and client render the same
 * string and hydration stays quiet.
 */
const GROUPING_SPACES = /[   ]/g

function normaliseSpaces(value: string): string {
  return value.replace(GROUPING_SPACES, " ")
}

/** `145 190 000`. Always tabular in the UI — pair with the `num` class. */
export function formatNumber(value: number | bigint): string {
  return normaliseSpaces(new Intl.NumberFormat("fr-FR").format(value))
}

/**
 * `145 190 000 FCFA`. Never a decimal: the franc CFA has no minor unit in use,
 * even though the columns are `Decimal(10, 2)`.
 */
export function formatCurrency(
  value: number | bigint | { toString(): string } | null | undefined
): string {
  if (value === null || value === undefined) return "—"
  const numeric =
    typeof value === "number" || typeof value === "bigint"
      ? Number(value)
      : Number(value.toString())
  if (Number.isNaN(numeric)) return "—"
  return `${formatNumber(Math.round(numeric))} FCFA`
}

/** Compact money for KPI tiles: `145,2 M FCFA`. */
export function formatCurrencyCompact(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    const millions = value / 1_000_000
    return `${normaliseSpaces(millions.toLocaleString("fr-FR", { maximumFractionDigits: 1 }))} M FCFA`
  }
  return formatCurrency(value)
}

/** `02/01/2025` — the form used inside tables and data columns. */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—"
  const date = typeof value === "string" ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return "—"
  return formatDateFns(date, "dd/MM/yyyy", { locale: fr })
}

/** `2 janv. 2025` — the form used in prose, summaries and footers. */
export function formatDateProse(value: Date | string | null | undefined): string {
  if (!value) return "—"
  const date = typeof value === "string" ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return "—"
  return formatDateFns(date, "d MMM yyyy", { locale: fr })
}

/** `18 j`, for aging and remaining-days columns. */
export function formatDays(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—"
  return `${formatNumber(value)} j`
}

/**
 * `3 ans 2 mois` — an ancienneté, between two dates.
 *
 * Calendar months, not a day count divided by thirty-something. Whichever
 * divisor you pick, 365 days floors to 11 months, so someone affiliated a
 * year ago to the day reads as `11 mois` next to the very date that proves
 * otherwise. `differenceInMonths` counts the months that have actually
 * turned over, which is what the reader is counting too.
 */
export function formatSeniority(from: Date, to: Date): string {
  // Clamped: a date in the future is a data-entry slip, and a negative
  // ancienneté is not the way to report it.
  const days = Math.max(0, differenceInCalendarDays(to, from))
  if (days < 31) return `${days} j d'ancienneté`

  const months = Math.max(0, differenceInMonths(to, from))
  if (months < 12) return `${months} mois d'ancienneté`

  const years = Math.floor(months / 12)
  const rest = months % 12
  const label = `${years} an${years > 1 ? "s" : ""}`
  return rest ? `${label} ${rest} mois` : `${label} d'ancienneté`
}

/** Whole-day difference, positive when `to` is after `from`. */
export function daysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 86_400_000
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b - a) / MS_PER_DAY)
}

/** Initials for an avatar chip, at most two letters. */
export function initials(...parts: (string | null | undefined)[]): string {
  return parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .flatMap((part) => part.trim().split(/\s+/))
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("")
}
