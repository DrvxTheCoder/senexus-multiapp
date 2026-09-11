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
  MEMBER_SORT_IDS,
  MEMBER_STATUSES,
  memberQuerySchema,
  type MemberQuery,
} from "@/lib/queries/ipm/member-query"

export const memberSearchParams = {
  q: parseAsString,
  status: parseAsArrayOf(parseAsStringLiteral(MEMBER_STATUSES), ","),
  employer: parseAsArrayOf(parseAsString, ","),
  deps: parseAsBoolean,
  sort: parseAsArrayOf(parseAsString, ","),
  page: parseAsInteger.withDefault(1),
  per: parseAsInteger.withDefault(25),
  /** Which participant the drawer is showing — part of the URL, so shareable. */
  open: parseAsString,
}

export const loadMemberSearchParams = createLoader(memberSearchParams)
export const serializeMemberSearchParams = createSerializer(memberSearchParams)

type RawParams = {
  [K in keyof typeof memberSearchParams]: ReturnType<
    (typeof memberSearchParams)[K]["parseServerSide"]
  >
}

export function toMemberQuery(raw: RawParams): MemberQuery {
  return memberQuerySchema.parse({
    search: raw.q ?? undefined,
    status: raw.status ?? undefined,
    employerId: raw.employer ?? undefined,
    withDependents: raw.deps ?? undefined,
    sort: (raw.sort ?? []).flatMap((entry) => {
      const desc = entry.startsWith("-")
      const id = desc ? entry.slice(1) : entry
      return (MEMBER_SORT_IDS as readonly string[]).includes(id)
        ? [{ id, desc }]
        : []
    }),
    page: raw.page,
    perPage: raw.per,
  })
}

/**
 * A pre-filtered participants URL, so a tile drills into exactly the list that
 * produced its number — built by the same serialiser the list parses, which is
 * what stops the count on the tile and the count on the list disagreeing.
 */
export function membersHref(
  firmSlug: string,
  query: Partial<MemberQuery> = {}
): string {
  const parsed = memberQuerySchema.parse(query)
  return serializeMemberSearchParams(`/${firmSlug}/ipm/participants`, {
    q: parsed.search ?? null,
    status: parsed.status ?? null,
    employer: parsed.employerId ?? null,
    deps: parsed.withDependents ?? null,
    sort: parsed.sort.map((entry) => (entry.desc ? `-${entry.id}` : entry.id)),
    page: parsed.page,
    per: parsed.perPage,
    open: null,
  })
}
