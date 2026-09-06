import {
  createLoader,
  createSerializer,
  parseAsArrayOf,
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
} from "nuqs/server"

import {
  contractQuerySchema,
  type ContractQuery,
} from "@/lib/queries/contract-query"

/**
 * §3.5 — the URL *is* the query.
 *
 * One definition, used by the server component that reads `searchParams`, by
 * the client components that write them through nuqs, and by the saved views
 * that store a query. Because there is a single set of parsers, a URL can be
 * pasted to a colleague, survives reload and the back button, and restores
 * exactly — including the sort and the page.
 *
 * Importing from `nuqs/server` keeps this file usable from a server component;
 * the same parsers drive `useQueryStates` on the client.
 */

const CONTRACT_TYPES = ["CDI", "CDD", "INTERIM", "STAGE", "PRESTATION"] as const
const CONTRACT_STATUSES = ["ACTIVE", "EXPIRED", "TERMINATED", "RENEWED"] as const
const SORT_IDS = [
  "employee",
  "type",
  "client",
  "period",
  "remaining",
  "ceiling",
  "visa",
  "status",
] as const

/**
 * Sort travels as `field` or `-field`, which stays readable in a shared link
 * and round-trips into the `{ id, desc }` shape TanStack expects.
 */
export const contractSearchParams = {
  q: parseAsString,
  type: parseAsArrayOf(parseAsStringLiteral(CONTRACT_TYPES), ","),
  status: parseAsArrayOf(parseAsStringLiteral(CONTRACT_STATUSES), ","),
  client: parseAsArrayOf(parseAsString, ","),
  dept: parseAsArrayOf(parseAsString, ","),
  vise: parseAsBoolean,
  exp: parseAsInteger,
  dmin: parseAsInteger,
  dmax: parseAsInteger,
  sort: parseAsArrayOf(parseAsString, ","),
  page: parseAsInteger.withDefault(1),
  per: parseAsInteger.withDefault(25),
}

export const loadContractSearchParams = createLoader(contractSearchParams)
export const serializeContractSearchParams = createSerializer(contractSearchParams)

type RawParams = {
  [K in keyof typeof contractSearchParams]: ReturnType<
    (typeof contractSearchParams)[K]["parseServerSide"]
  >
}

function parseSort(raw: string[] | null): ContractQuery["sort"] {
  if (!raw?.length) return []
  return raw.flatMap((entry) => {
    const desc = entry.startsWith("-")
    const id = desc ? entry.slice(1) : entry
    return (SORT_IDS as readonly string[]).includes(id) ? [{ id, desc }] : []
  })
}

function formatSort(sort: ContractQuery["sort"]): string[] | null {
  if (!sort.length) return null
  return sort.map((entry) => (entry.desc ? `-${entry.id}` : entry.id))
}

/** URL params to a validated query. Anything malformed falls back to a default. */
export function toContractQuery(raw: RawParams): ContractQuery {
  return contractQuerySchema.parse({
    search: raw.q ?? undefined,
    type: raw.type ?? undefined,
    status: raw.status ?? undefined,
    clientId: raw.client ?? undefined,
    departmentId: raw.dept ?? undefined,
    vise: raw.vise ?? undefined,
    expiringWithin: raw.exp ?? undefined,
    interimDaysMin: raw.dmin ?? undefined,
    interimDaysMax: raw.dmax ?? undefined,
    sort: parseSort(raw.sort),
    page: raw.page,
    perPage: raw.per,
  })
}

/** The inverse, for saved views and for links that pre-filter a list. */
export function fromContractQuery(query: ContractQuery) {
  return {
    q: query.search ?? null,
    type: query.type ?? null,
    status: query.status ?? null,
    client: query.clientId ?? null,
    dept: query.departmentId ?? null,
    vise: query.vise ?? null,
    exp: query.expiringWithin ?? null,
    dmin: query.interimDaysMin ?? null,
    dmax: query.interimDaysMax ?? null,
    sort: formatSort(query.sort),
    page: query.page === 1 ? null : query.page,
    per: query.perPage === 25 ? null : query.perPage,
  }
}

/** A shareable, pre-filtered URL — how every dashboard number drills through. */
export function contractsHref(
  firmSlug: string,
  query: Partial<ContractQuery>
): string {
  const full = contractQuerySchema.parse(query)
  return serializeContractSearchParams(
    `/${firmSlug}/hr/contracts`,
    fromContractQuery(full)
  )
}

/** True when anything beyond paging and sorting is set — drives "Réinitialiser". */
export function hasActiveFilters(query: ContractQuery): boolean {
  return Boolean(
    query.search ||
      query.type?.length ||
      query.status?.length ||
      query.clientId?.length ||
      query.departmentId?.length ||
      query.vise !== undefined ||
      query.expiringWithin !== undefined ||
      query.interimDaysMin !== undefined ||
      query.interimDaysMax !== undefined
  )
}
