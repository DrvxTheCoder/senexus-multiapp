import {
  createLoader,
  createSerializer,
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
} from "nuqs/server"

import {
  CLIENT_SORT_IDS,
  CLIENT_STATUSES,
  clientQuerySchema,
  type ClientQuery,
} from "@/lib/queries/client-query"

export const clientSearchParams = {
  q: parseAsString,
  status: parseAsArrayOf(parseAsStringLiteral(CLIENT_STATUSES), ","),
  industry: parseAsArrayOf(parseAsString, ","),
  exp: parseAsInteger,
  sort: parseAsArrayOf(parseAsString, ","),
  page: parseAsInteger.withDefault(1),
  per: parseAsInteger.withDefault(50),
  /** Which client the drawer is showing — part of the URL, so it is shareable. */
  open: parseAsString,
}

export const loadClientSearchParams = createLoader(clientSearchParams)
export const serializeClientSearchParams = createSerializer(clientSearchParams)

type RawParams = {
  [K in keyof typeof clientSearchParams]: ReturnType<
    (typeof clientSearchParams)[K]["parseServerSide"]
  >
}

export function toClientQuery(raw: RawParams): ClientQuery {
  return clientQuerySchema.parse({
    search: raw.q ?? undefined,
    status: raw.status ?? undefined,
    industry: raw.industry ?? undefined,
    expiringWithin: raw.exp ?? undefined,
    sort: (raw.sort ?? []).flatMap((entry) => {
      const desc = entry.startsWith("-")
      const id = desc ? entry.slice(1) : entry
      return (CLIENT_SORT_IDS as readonly string[]).includes(id) ? [{ id, desc }] : []
    }),
    page: raw.page,
    perPage: raw.per,
  })
}
