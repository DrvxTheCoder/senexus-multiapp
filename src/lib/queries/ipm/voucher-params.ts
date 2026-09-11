import {
  createLoader,
  createSerializer,
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
} from "nuqs/server"

import {
  VOUCHER_SORT_IDS,
  VOUCHER_STATUSES,
  VOUCHER_TYPES,
  voucherQuerySchema,
  type VoucherQuery,
} from "@/lib/queries/ipm/voucher-query"

export const voucherSearchParams = {
  q: parseAsString,
  status: parseAsArrayOf(parseAsStringLiteral(VOUCHER_STATUSES), ","),
  type: parseAsArrayOf(parseAsStringLiteral(VOUCHER_TYPES), ","),
  provider: parseAsArrayOf(parseAsString, ","),
  category: parseAsArrayOf(parseAsString, ","),
  member: parseAsString,
  from: parseAsString,
  to: parseAsString,
  sort: parseAsArrayOf(parseAsString, ","),
  page: parseAsInteger.withDefault(1),
  per: parseAsInteger.withDefault(25),
  /** The bon the drawer is showing — part of the URL, so it is shareable. */
  open: parseAsString,
}

export const loadVoucherSearchParams = createLoader(voucherSearchParams)
export const serializeVoucherSearchParams = createSerializer(voucherSearchParams)

type RawParams = {
  [K in keyof typeof voucherSearchParams]: ReturnType<
    (typeof voucherSearchParams)[K]["parseServerSide"]
  >
}

export function toVoucherQuery(raw: RawParams): VoucherQuery {
  return voucherQuerySchema.parse({
    search: raw.q ?? undefined,
    status: raw.status ?? undefined,
    type: raw.type ?? undefined,
    providerId: raw.provider ?? undefined,
    categoryId: raw.category ?? undefined,
    memberId: raw.member ?? undefined,
    from: raw.from ?? undefined,
    to: raw.to ?? undefined,
    sort: (raw.sort ?? []).flatMap((entry) => {
      const desc = entry.startsWith("-")
      const id = desc ? entry.slice(1) : entry
      return (VOUCHER_SORT_IDS as readonly string[]).includes(id)
        ? [{ id, desc }]
        : []
    }),
    page: raw.page,
    perPage: raw.per,
  })
}

/**
 * A pre-filtered bons URL, built by the same serialiser the list parses — so a
 * tile that drills through cannot disagree with the list it lands on.
 */
export function vouchersHref(
  firmSlug: string,
  query: Partial<VoucherQuery> = {}
): string {
  const parsed = voucherQuerySchema.parse(query)
  return serializeVoucherSearchParams(`/${firmSlug}/ipm/bons`, {
    q: parsed.search ?? null,
    status: parsed.status ?? null,
    type: parsed.type ?? null,
    provider: parsed.providerId ?? null,
    category: parsed.categoryId ?? null,
    member: parsed.memberId ?? null,
    from: parsed.from ?? null,
    to: parsed.to ?? null,
    sort: parsed.sort.map((entry) => (entry.desc ? `-${entry.id}` : entry.id)),
    page: parsed.page,
    per: parsed.perPage,
    open: null,
  })
}
