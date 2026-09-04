# Performance

Target from §3.6: **p95 server time under 300 ms for a 50-row list page on a
500-employee firm.**

Measured against the seeded development database, which is deliberately built to
production shape — 488 employees, 932 contracts, 2 202 documents, 15 clients
across two firms. Numbers below are development-mode (`next dev`, Turbopack),
which is the pessimistic case: a production build removes the per-request
compilation and instrumentation overhead.

Re-run with `pnpm exec vite-node -c vitest.config.ts scripts/check-query-layer.mts`
for the resolver figures, and with the URLs below for end-to-end page timings.

## Resolver (SQL + hydration only)

| Operation | Rows considered | Time |
| --- | ---: | ---: |
| `listContracts`, default sort, 50 rows | 932 | 104 ms cold, ~15 ms warm |
| Sort by cumulative interim days (SQL) | 932 | 17 ms |
| Filter `interimDaysMin=620` (SQL) | 932 | 20 ms |
| Filter `expiringWithin=30` | 932 | 16 ms |
| Search by matricule | 932 | 14 ms |
| `contractSummary`, five aggregates | 932 | 5 ms |
| Four facet counts, in parallel | 932 | included in list |
| `streamContractsForExport`, full walk | 182 | 16 ms |
| Ceiling CTE alone (`range_agg` over a firm) | 740 interim contracts | 5 ms |

## Page, end to end (dev server, including render and RSC payload)

| URL | Time |
| --- | ---: |
| `/hr/contracts` | 302 ms |
| `/hr/contracts?status=ACTIVE&exp=30` | 275 ms |
| `/hr/contracts?type=INTERIM&dmin=620` | 296 ms |
| `/hr/contracts?sort=-ceiling` | 267 ms |
| `/hr/contracts?page=3` | 377 ms |
| `/hr/contracts?q=CI0042` | 207 ms |

First request after a compile is ~1.7 s; that is Turbopack compiling the route,
not query time, and does not occur in production.

## Why it is this fast without a single index

The database has **no secondary indexes at all** — every one of its 56 indexes is
a primary key or a unique constraint (see `DATA_MODEL.md` §8). These timings are
therefore sequential scans over a few hundred rows, which Postgres does easily at
this size. **They will not hold at 10× the data**, and the missing indexes on
`contracts.firmId`, `contracts.employeeId`, `contracts.endDate` and
`clients.firmId` are the first thing to add when they stop holding.

Per §1.1 nothing has been applied. Candidates belong in
`docs/PROPOSED_INDEXES.sql` with the query each serves and a measured cost, to be
written once there is production data to measure against — measuring index value
against seeded data of this size would produce misleading numbers.

## Design decisions that keep it here

- **Two round trips per page, never more.** One raw query selects the ids in
  order with the computed ceiling columns and a `COUNT(*) OVER()` window; one
  Prisma `findMany` hydrates exactly those rows with an explicit `select`. No
  N+1, and no over-fetching.
- **The ceiling is computed in SQL**, with `range_agg` unioning overlapping
  contracts. Computing it in JavaScript would have forced either a full-table
  load to sort by it, or client-side sorting — both forbidden by §3.6.
- **Facet counts are `GROUP BY` queries**, not counts of a fetched array.
- **The export streams.** A 182-row export and a 40 000-row export cost the same
  memory, because rows are written to the XLSX as they arrive rather than
  collected first.
- **Nothing loads a full table.** The largest result set materialised anywhere in
  a page request is 50 rows.

## Not yet measured

- Production build timings (`next build && next start`) — dev numbers above are
  the pessimistic case.
- Lighthouse accessibility on dashboard, contracts and employee record (§9
  requires ≥ 95). Due in phase 7.
- Memory under load on the Coolify VPS, which §2.1 asks for before enabling
  anything experimental. Cache Components and Turbopack filesystem caching are
  both **off**; the only experimental flag enabled is `authInterrupts`.
