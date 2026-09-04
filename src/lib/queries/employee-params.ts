import {
  createLoader,
  createSerializer,
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
} from "nuqs/server"

import {
  CONTRACT_TYPES,
  EMPLOYEE_STATUSES,
  EMPLOYEE_SORT_IDS,
  INCOMPLETE_REASONS,
  employeeQuerySchema,
  type EmployeeQuery,
} from "@/lib/queries/employee-query"

/** The URL is a serialised EmployeeQuery — same contract as the contracts list. */
export const employeeSearchParams = {
  q: parseAsString,
  status: parseAsArrayOf(parseAsStringLiteral(EMPLOYEE_STATUSES), ","),
  contract: parseAsArrayOf(parseAsStringLiteral(CONTRACT_TYPES), ","),
  client: parseAsArrayOf(parseAsString, ","),
  dept: parseAsArrayOf(parseAsString, ","),
  dmin: parseAsInteger,
  dmax: parseAsInteger,
  gaps: parseAsArrayOf(parseAsStringLiteral(INCOMPLETE_REASONS), ","),
  sort: parseAsArrayOf(parseAsString, ","),
  page: parseAsInteger.withDefault(1),
  per: parseAsInteger.withDefault(50),
}

export const loadEmployeeSearchParams = createLoader(employeeSearchParams)
export const serializeEmployeeSearchParams = createSerializer(employeeSearchParams)

type RawParams = {
  [K in keyof typeof employeeSearchParams]: ReturnType<
    (typeof employeeSearchParams)[K]["parseServerSide"]
  >
}

function parseSort(raw: string[] | null): EmployeeQuery["sort"] {
  if (!raw?.length) return []
  return raw.flatMap((entry) => {
    const desc = entry.startsWith("-")
    const id = desc ? entry.slice(1) : entry
    return (EMPLOYEE_SORT_IDS as readonly string[]).includes(id)
      ? [{ id, desc }]
      : []
  })
}

export function toEmployeeQuery(raw: RawParams): EmployeeQuery {
  return employeeQuerySchema.parse({
    search: raw.q ?? undefined,
    status: raw.status ?? undefined,
    contractType: raw.contract ?? undefined,
    clientId: raw.client ?? undefined,
    departmentId: raw.dept ?? undefined,
    interimDaysMin: raw.dmin ?? undefined,
    interimDaysMax: raw.dmax ?? undefined,
    incomplete: raw.gaps ?? undefined,
    sort: parseSort(raw.sort),
    page: raw.page,
    perPage: raw.per,
  })
}

export function fromEmployeeQuery(query: EmployeeQuery) {
  return {
    q: query.search ?? null,
    status: query.status ?? null,
    contract: query.contractType ?? null,
    client: query.clientId ?? null,
    dept: query.departmentId ?? null,
    dmin: query.interimDaysMin ?? null,
    dmax: query.interimDaysMax ?? null,
    gaps: query.incomplete ?? null,
    sort: query.sort.length
      ? query.sort.map((entry) => (entry.desc ? `-${entry.id}` : entry.id))
      : null,
    page: query.page === 1 ? null : query.page,
    per: query.perPage === 50 ? null : query.perPage,
  }
}

/** Pre-filtered, shareable URL — how a dashboard number drills through. */
export function employeesHref(
  firmSlug: string,
  query: Partial<EmployeeQuery>
): string {
  return serializeEmployeeSearchParams(
    `/${firmSlug}/hr/employees`,
    fromEmployeeQuery(employeeQuerySchema.parse(query))
  )
}
