import {
  createLoader,
  createSerializer,
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
} from "nuqs/server"

const LEAVE_TYPES = [
  "ANNUAL",
  "SICK",
  "MATERNITY",
  "PATERNITY",
  "UNPAID",
  "SPECIAL",
  "COMPENSATORY",
] as const
const LEAVE_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const
const VIEWS = ["liste", "calendrier"] as const

/**
 * The list and the calendar are the same query rendered two ways, so `view`
 * lives in the URL beside the filters rather than in component state. Switching
 * view keeps the filters; sharing a link shares both.
 */
export const leaveSearchParams = {
  q: parseAsString,
  type: parseAsArrayOf(parseAsStringLiteral(LEAVE_TYPES), ","),
  status: parseAsArrayOf(parseAsStringLiteral(LEAVE_STATUSES), ","),
  month: parseAsString,
  view: parseAsStringLiteral(VIEWS).withDefault("liste"),
  page: parseAsInteger.withDefault(1),
  per: parseAsInteger.withDefault(50),
}

export const loadLeaveSearchParams = createLoader(leaveSearchParams)
export const serializeLeaveSearchParams = createSerializer(leaveSearchParams)

type RawParams = {
  [K in keyof typeof leaveSearchParams]: ReturnType<
    (typeof leaveSearchParams)[K]["parseServerSide"]
  >
}

export function toLeaveQuery(raw: RawParams) {
  return {
    search: raw.q ?? undefined,
    type: raw.type ?? undefined,
    status: raw.status ?? undefined,
    // The calendar is always about one month; the list is not.
    month:
      raw.view === "calendrier" ? (raw.month ?? currentMonth()) : (raw.month ?? undefined),
    sort: [],
    page: raw.page,
    perPage: raw.per,
  }
}

export function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

export function shiftMonth(month: string, delta: number): string {
  const [year, index] = month.split("-").map(Number)
  const date = new Date(Date.UTC(year, index - 1 + delta, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
}
