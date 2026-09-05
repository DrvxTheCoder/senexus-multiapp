# Performance

Target from §3.6: **p95 server time under 300 ms for a 50-row list page on a
500-employee firm.** Met with room to spare.

Measured against the seeded development database, built to production shape:
488 employees, 1 026 contracts, 2 151 documents, 15 clients across two firms of
one holding — Connect Interim (`CI`) and Synergie Pro (`SP`).

## Production build (`next build && next start`)

Twelve samples per route, full request time including render and the RSC
payload, signed in as an unrestricted administrator. Re-measured after the write
layer landed: every list now also renders its row actions, and the pages that
gained a dialog also load the pickers those dialogs need (clients, employees,
sibling firms).

| Route | p50 | **p95** | fastest |
| --- | ---: | ---: | ---: |
| `/hr/employees` — 50 rows of 430 | 162 ms | **191 ms** | 141 ms |
| `/hr/contracts` — 50 rows of 932 | 77 ms | **119 ms** | 56 ms |
| `/dashboard` — 7 aggregate panels | 89 ms | **105 ms** | 77 ms |
| `/decisions` | 51 ms | **64 ms** | 48 ms |
| `/hr/leaves` | 38 ms | **48 ms** | 36 ms |
| `/documents` | 34 ms | **42 ms** | 33 ms |
| `/crm/clients` | 33 ms | **41 ms** | 29 ms |
| `/hr/transfers` | 30 ms | **37 ms** | 28 ms |

The employees list is still the heaviest page and still at two-thirds of the
budget: it runs the ceiling CTE, a lateral join for each employee's current
contract, four facet counts, a five-part summary, and now the client and firm
lists the create wizard and the transfer dialog need. Those three extra queries
cost roughly 30 ms of its 191 ms, which is the price of not fetching anything
from the browser after the page paints.

## Resolver only (SQL + hydration, no render)

Via `pnpm exec vite-node -c vitest.config.ts scripts/check-query-layer.mts`.

| Operation | Rows considered | Time |
| --- | ---: | ---: |
| `listContracts`, default sort, 50 rows | 932 | ~15 ms warm |
| Sort by cumulative interim days (SQL) | 932 | 17 ms |
| Filter `interimDaysMin=620` (SQL) | 932 | 20 ms |
| Filter `expiringWithin=30` | 932 | 16 ms |
| `contractSummary`, five aggregates | 932 | 5 ms |
| `streamContractsForExport`, full walk | 182 | 16 ms |
| Ceiling CTE alone (`range_agg` over a firm) | 740 interim contracts | 5 ms |

## Development mode, for comparison

`next dev` adds compilation and instrumentation: the same pages run 200–380 ms,
and the first request after a change is ~1.7 s. Neither figure occurs in
production; they are recorded only so a slow dev server is not mistaken for a
slow application.

## Why it is this fast without a single index

The database has **no secondary indexes at all** — every one of its 56 indexes is
a primary key or a unique constraint (`DATA_MODEL.md` §8). These timings are
sequential scans over a few hundred rows, which Postgres does easily at this
size.

**They will not hold at 10× the data.** When they stop holding, the first levers
are the unindexed foreign keys: `contracts.firmId`, `contracts.employeeId`,
`contracts.endDate`, `employee_documents.employeeId`, `clients.firmId`.

Per §1.1 nothing has been applied, and `docs/PROPOSED_INDEXES.sql` is
deliberately still empty: measuring index value against seeded data of this size
would produce numbers that mislead rather than inform. The file gets written
from production `EXPLAIN ANALYZE` output, with the query each index serves.

## Design decisions that keep it here

- **Two round trips per list page, never more.** One raw query selects the ids in
  order with the computed ceiling columns and a `COUNT(*) OVER()` window; one
  Prisma `findMany` hydrates exactly those rows with an explicit `select`. No
  N+1, no over-fetching.
- **The ceiling is computed in SQL**, once, in a CTE shared by the contracts
  resolver, the employees resolver and the dashboard. Computing it in JavaScript
  would have forced either a full-table load to sort by it or client-side
  sorting — both forbidden by §3.6, and both a source of screens disagreeing.
- **Facet counts are `GROUP BY` queries**, not counts of a fetched array.
- **The dashboard fetches no rows.** Seven panels, seven aggregates, each behind
  its own Suspense boundary so a slow one cannot hold up the rest.
- **Exports stream.** A 182-row export and a 40 000-row export cost the same
  memory, because rows are written to the XLSX as they arrive.
- **Nothing loads a full table.** The largest result set materialised anywhere in
  a page request is 50 rows.

## Memory and experimental features

§2.1 asks for memory to be measured before enabling anything experimental. The
position today:

- **Cache Components: off.** Reported to increase memory significantly; nothing
  in this application needs it yet.
- **Turbopack filesystem caching: default.** It is a development-time disk cache.
  Worth knowing: it caused a stale build referencing a deleted file, and
  `pnpm dev:clean` exists for exactly that.
- **React Compiler: on**, which is stable in 16 and removes most hand-written
  memoisation.
- The only experimental flag enabled is `authInterrupts`, which powers
  `unauthorized()` and `forbidden()`.

Memory under load on the Coolify VPS is **not yet measured** — that needs the
real deployment, and is the one §2.1 item still outstanding.

## Accessibility

Audited on the rendered HTML of ten pages (dashboard, contracts, employees,
employee record, clients, leaves list and calendar, documents, decisions,
settings, sign-in). Every page: one `h1`, no heading-level jumps, no unlabelled
buttons or links, no unlabelled inputs, no images without `alt`, `lang="fr"`,
`main`/`nav`/`header` landmarks, a skip link, and `aria-sort` on every sortable
column header.

A Lighthouse run against the deployed instance is still pending — §9 asks for
≥ 95 on dashboard, contracts and the employee record, and the audit above covers
what Lighthouse checks statically, but contrast and focus-visibility want a real
browser.
