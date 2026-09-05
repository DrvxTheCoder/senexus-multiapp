# Senexus MultiApp

Gestion du personnel, des contrats et des clients du groupe Senexus.

Next.js 16 (App Router, Turbopack, React Compiler) · Prisma · PostgreSQL ·
Auth.js v5 · Tailwind v4 · shadcn on Base UI.

---

## The one rule

**The database schema is frozen.** It is live, it holds real personnel records,
and it is shared with the application this one replaces.

- `prisma/schema.prisma` is byte-for-byte the production schema
  (sha256 `86188a02…`). Do not edit it.
- Run `prisma generate` only. **Never** `migrate dev`, `migrate deploy`,
  `db push` or `db pull`. There is no `prisma/migrations/` directory and there
  must not be one.
- Need a value the schema cannot supply? Derive it in the query layer, or add it
  to `docs/OPEN_QUESTIONS.md`. Do not add a column.

Verify at any time:

```bash
pnpm exec prisma migrate diff \
  --from-schema-datamodel prisma/schema.prisma \
  --to-schema-datasource prisma/schema.prisma   # → "No difference detected."
```

## Getting started

```bash
pnpm install
cp .env.example .env          # then set DATABASE_URL and AUTH_SECRET
pnpm exec prisma generate
pnpm dev
```

Against an empty local database, seed production-shaped fixtures:

```bash
pnpm db:seed:dev
```

The seed refuses to run against anything but localhost and never touches users,
firms, holdings or modules. It creates ~490 employees, ~930 contracts and ~2 200
documents with realistic distributions, plus three sign-in accounts — including
a `RESPONSABLE` restricted to two clients, which is what makes the role-scoping
guarantees testable.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm dev:clean` | Same, after clearing the Turbopack disk cache — use when a deleted file is still referenced |
| `pnpm build` / `pnpm start` | Production build and server |
| `pnpm test` | Unit tests: ceiling rules, form schemas, and jsdom smoke tests for the menus and dialogs |
| `pnpm typecheck` / `pnpm lint` | TypeScript and ESLint |
| `pnpm db:seed:dev` | Local development fixtures |
| `pnpm check:queries` | Role-scoping harness and query timings |
| `pnpm check:admin` | The administration console, over real HTTP |
| `pnpm check:hr` | The HR write layer and the transfer flow, over real HTTP |

`check:admin` needs a **production** server running, because it reads
server-action ids out of `.next/static` and fires them at the app the way the
browser does:

```bash
pnpm build && pnpm start
pnpm check:admin
```

It signs in as a STAFF account and attempts every administration action, which
is the only way to show that authorisation holds on the *actions* and not merely
on the pages. It writes two throwaway accounts and deletes them again, and
refuses to run against anything but a local database.

`check:hr` runs the same way and proves the claims inspection cannot settle:
creating an employee creates their contract in the same transaction, a CSV
import reports a bad row and a duplicate and still imports the rest, the 730-day
ceiling blocks a renewal that would cross it, a second transfer is refused while
one is PENDING *and* while one is APPROVED, and completing a transfer leaves the
employee with an active contract in the destination firm. It cleans up after
itself and can be run repeatedly.

What neither harness nor a build can see is a menu or a dialog, because
their content only mounts once someone clicks. `pnpm test` opens them in jsdom
instead — that is what `src/components/shell/shell-menus.test.tsx` is for, after
two client-only crashes shipped past a green build.

```bash
node scripts/gen-data-model.mjs   # regenerate docs/DATA_MODEL.md
```

## How it is put together

- **`src/lib/queries/*`** — query *shapes*: zod schemas and URL parsers. Runs in
  the browser.
- **`src/server/queries/*`** — query *resolvers*: Prisma and raw SQL. Marked
  `server-only`, and the split above is what keeps the database out of the
  client bundle.
- **`src/server/domain/*`** — business rules. The 730-day ceiling lives in one
  file and is unit tested.
- **`src/server/auth/require-firm-access.ts`** — the single authorisation
  helper. Every action, route handler and page calls it first.

Four properties the code is arranged to guarantee:

1. **The URL is the query.** Filters, sort and page live in the URL, so a list is
   shareable and restores exactly. A saved view is the same query stored in
   `DashboardView.config`.
2. **Role scoping lives in the where-builder**, never in a handler — so the
   list, the facet counts, the summary, the export and the bulk actions inherit
   it automatically. This is verified, not assumed: see the harness above.
3. **Nothing loads a full table.** Filtering, sorting, pagination and every count
   are SQL. The largest set materialised in a request is one page of 50.
4. **No raw storage URL reaches the HTML.** Files are served through
   `/[firmSlug]/api/files/[documentId]` behind `requireFirmAccess`.

## Documentation

| File | Contents |
| --- | --- |
| `docs/DATA_MODEL.md` | Every model, field, relation and constraint, plus how tenancy and the ceiling actually work |
| `docs/OPEN_QUESTIONS.md` | Decisions taken, with reasons, and what is still open |
| `docs/PERF.md` | Measured p95 timings and the accessibility audit |

## Notes for whoever picks this up

- Error tracking is **not** wired. GlitchTip was removed after it was confirmed
  never to have worked; the PII scrubber written for it is in history at
  commit `ea746e4` and can be lifted onto whatever replaces it.
- Settings is read-only. It shows what governs behaviour.
- **Documents is a module row.** The navigation entry and the employee Documents
  tab appear only where a `documents` module exists and is enabled for the firm.
  Production has no such row, which is why the section looked missing rather than
  broken. `/admin/modules` creates and installs it in one click.
- Payroll, missions, absences and IPM have models in the schema but were never
  implemented and are out of scope.
