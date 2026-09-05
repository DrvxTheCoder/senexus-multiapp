# Open questions

Raised per §0 and §1.1: where the UI needs a value the schema cannot supply, or where the brief and
the existing behaviour disagree. **No question here is answered by adding a column.**

Status: `OPEN` — blocks work · `DECIDED` — answered, and what was decided · `ASSUMED` — proceeding
on the stated assumption, correct me · `FYI`.

---

## Q1 — Which database? · `DECIDED` — seed locally

Production is not reachable from here (and pgAdmin cannot reach it either), so the plan of importing
live data was dropped. **The local database is seeded with production-shaped fixtures instead**, via
`prisma/seed.dev.mjs` (`pnpm db:seed:dev`).

The seed refuses to run against any host that is not localhost, and only ever touches the two seeded
firms — it never deletes users, firms, holdings or modules. It is deterministic, so two runs produce
the same database.

What it creates:

| | Connect Interim | Senexus Consulting |
| --- | ---: | ---: |
| Clients | 10 | 5 |
| Departments | 4 | 2 |
| Employees | 430 | 58 |
| Contracts | ~840 | ~90 |
| Documents | ~1 980 | ~270 |
| Leave requests + balances | yes | yes |

Distributions are drawn to match the prototype rather than being uniform noise, so the screens are
built against realistic shapes: the client portfolio is concentrated (Touba Gaz Mbao ≈ 31 % of
placements), interim day totals follow the prototype bands (142 under 180 days … 4 over 730), around
10 % of active contracts fall inside the 30-day alert window, a quarter of employee records are
missing a CNI, and documents include expired, expiring and unverified pieces. `EmployeeDocument`
rows carry a raw storage URL exactly as the legacy data does, so §3.7 can be verified honestly.

Three sign-in accounts exist in development, and the last one matters:

| Account | Role | Purpose |
| --- | --- | --- |
| `flanpaul19@gmail.com` | OWNER, both firms | unchanged password |
| `manager.dev@senexus.local` | MANAGER, Connect Interim | password `senexus-dev` |
| `responsable.dev@senexus.local` | RESPONSABLE, **sees 2 clients only** | password `senexus-dev` |

The responsable account is how §3.5 gets proven: the same client restriction must apply to the list,
the facet counts, the export and the bulk actions. The definition of done requires exactly this
check, and it is untestable without a restricted account.

**Nothing in the application ships fixture content.** The seed is a development script only.

---

## Q2 — What exactly is a "cumulative interim day"? · `DECIDED` — both numbers, computed from contracts

Not answered directly, so this is the decision I am building on; it is one function to change.

The legacy computation (`now − Employee.hireDate`) is abandoned. Cumulative days come from
`Contract` rows, `firmId`-scoped, as the brief requires. Rather than choose between the two readings
of "cumulative", the resolver returns **both**, because the UI genuinely needs each:

- **`usedDays` — elapsed.** `min(endDate, today) − startDate`, summed. This is what the
  `InterimMeter` displays and what "694 jours cumulés" means on screen.
- **`projectedDays` — contracted.** The same sum with the full `endDate`, including runway not yet
  worked. This is what the **bulk renewal pre-flight** must test, because a renewal that would cross
  730 days before it ends has to be blocked *before* the user commits, not after.

The remaining rules:

- **Overlaps count once.** Days are unioned, not summed, so two overlapping contracts cannot inflate
  the total. A naive `SUM(endDate − startDate)` would be wrong and would over-block renewals.
- **Gaps do not count.** Only contracted days accumulate.
- **All statuses count** — `ACTIVE`, `EXPIRED`, `TERMINATED` and `RENEWED` alike. The days were
  worked; how the contract ended does not give them back.

Correct any of these and it changes one file, not the UI.

---

## Q3 — Which contract types count toward the ceiling? · `DECIDED` — INTERIM only

The 730-day ceiling is a rule about interim employment, so only `INTERIM` contracts accumulate
against it. `CDI`, `CDD`, `STAGE` and `PRESTATION` render **"non applicable"** rather than a zeroed
meter — a zero would read as "plenty of room left", which is a different and misleading statement.

This lives in one exported constant. If CDD needs its own separate cap (Senegalese law does limit
CDD renewals, by a different rule), that is an additive change, not a rework.

---

## Q4 — Modules · `DECIDED` — documents becomes its own module

Only `hr` and `crm` were ever implemented; the rest were planned but never built, so there is nothing
to carry over for payroll, missions, absences or IPM.

**Documents is now a module of its own, and the connection to employees is untouched.** This is
feasible precisely because §3.4 modules gate *navigation and authorisation*, never data:
`EmployeeDocument.employeeId` is a real foreign key and stays exactly as it is. The seed creates:

- a `Module` row — slug `documents`, `basePath` `/documents`;
- a `ModuleDependency` row making `documents` depend on `hr`, which is what that model is for;
- a `FirmModule` row per firm, enabled.

Consequences, all intended: documents get their own routes at `/[firmSlug]/documents/…` and their own
nav entry; a firm can switch documents off independently of HR; and the Documents tab on the employee
record is gated on the `documents` module while the record itself stays gated on `hr`.

For production this is three `INSERT`s — data, not schema — which I will hand over as a script rather
than run.

---

## Q5 — Identifying one person across two firms · `DECIDED` — transfers and contract history only

Accepted as proposed. Parcours is reconstructed from `EmployeeTransfer` rows plus the distinct
`firmId`s on the employee's `Contract` rows. **No CNI fuzzy-matching**: it would produce false
positives on a nullable free-text field, and it would join personnel records across tenants, which
§1.2 forbids outright.

For the transfer flow to be seamless while still respecting the ceiling, the consequence from
`DATA_MODEL.md` §5 has to be handled deliberately: the destination firm starts a **fresh** 730-day
count, because the ceiling is per employer and the count derives from `Contract.firmId`. The
employee record shows both — the current firm's count against the ceiling, and the group history as
context, labelled so nobody reads the two as one total.

---

## Q6 — Sidebar and UI preferences · `DECIDED` — prototype styling, server-side persistence

The sidebar follows the prototype exactly: labelled entries, the contextual "Effectif par client"
group that doubles as a filter, the pinned legal-ceiling risk card, the user chip. That is called out
as a change you particularly want, so it is built as drawn rather than approximated.

Persistence stays as assumed — a reserved `DashboardView` row (`name = '__ui_state'`) per user per
firm, filtered out of the saved-views UI. Verified round-tripping against the real schema.

---

## Q7 — Auth.js v5 and existing passwords · `DECIDED` — every password works

Verified end to end: existing bcrypt hashes in `users.passwordHash` authenticate through Auth.js v5,
so **no user has to reset anything**, on any domain. `AUTH_SECRET` falls back to the existing
`NEXTAUTH_SECRET`, so no deployment variable has to change either.

See Q14 for the PWA work this raises.

---

## Q8 — GlitchTip · `DECIDED` — removed

Confirmed that it never worked. All enforcement is gone: `@sentry/nextjs` uninstalled, the config
files, the instrumentation hooks, the client tunnel and the `withSentryConfig` wrapper deleted, and
the telemetry variables dropped from `.env.example`.

The PII scrubbing built for it — deny-by-default, never transmits a request body, sweeps CNI- and
email-shaped strings — is preserved in git history at commit `ea746e4` (`src/lib/telemetry/scrub.ts`)
and can be lifted onto whatever you choose later. Whatever that is, it must not receive request
bodies from employee, document or payroll routes.

---

## Q9 — The top-bar date range · `DECIDED` — contextual, hidden where it means nothing

Shown only where a period genuinely scopes what is on screen: the dashboard, and later the leave
calendar and any report view. Hidden on the resource lists, which are filtered by their own explicit
facets. A hidden global date filter on a list is exactly what makes an exported file disagree with
the screen.

---

## Q10 — The "Décisions" queue · `DECIDED` — an alert queue for the connected user

Not an approvals inbox but everything demanding this user's attention, access-filtered by default —
the same role and client scoping as every other query, applied inside the resolver.

Scope for now:

| Source | What surfaces |
| --- | --- |
| Contracts | expiring inside `alertThreshold`, awaiting visa (`isVise = false`), renewals due, ceiling breaches and near-breaches |
| Employees | incomplete records — missing CNI, missing contact details, no active contract |
| Documents | missing required pieces, expiring, expired, awaiting verification |

Leaves and transfers join later when those screens are built. Sorted by age, since §4.7 makes aging
a first-class column and urgency the default sort.

---

## Q11 — FCFA and `Decimal(10,2)` · `DECIDED` — never a decimal

Stored as the schema has it, rendered rounded to the unit (`145 190 000 FCFA`), and no decimal is
accepted on input either. Implemented once in `src/lib/format.ts`; no component formats money itself.

---

## Q12 — TanStack Table version · `DECIDED` — pinned to v8, as the brief says

Unanswered, and the decision could not wait past the first table, so: **v8.21.3 is installed**.

v9 is a ground-up redesign — an atom store, opt-in feature registration, a different `useTable`
signature — with thin documentation. In manual mode the library does no filtering, sorting or
pagination work at all; it owns column definitions, header and cell rendering, and selection. v9
therefore buys nothing here and costs exploratory risk on the one component every resource page
depends on.

Migrating later is contained: it touches `src/components/data-table.tsx` and nothing else, because
no page talks to TanStack directly.

---

## Q13 — The dev sign-in password is in the legacy seed · `FYI`

`senexus-hr/prisma/seed.ts` hard-codes an admin account and its password, and that account exists in
the local database. Fine locally; worth confirming it has never been run against production, since it
would create the same well-known credentials there.

---

## Q14 — PWA · `DONE` — phase 7

Built to the Next 16 convention: a single `app/manifest.ts` served at
`/manifest.webmanifest`, declared once in the root layout so **every** route is
installable, a generated icon set (192/512 plus maskable variants and an Apple
touch icon), and an install affordance that behaves the same everywhere.

**The inconsistency you described had a specific cause, and this build had it
too until it was tested.** The proxy authenticates everything by default, so
`/manifest.webmanifest` was being redirected to sign-in for anonymous visitors —
which is precisely why an install prompt never appeared on the login page. The
manifest and its icons are now in the proxy allow-list; they contain no data.

Verified: the manifest returns 200 unauthenticated, and all four routes checked
(sign-in, dashboard, employees, documents) link it.

Two platform paths, because they genuinely differ: Chromium fires
`beforeinstallprompt`, which is captured and replayed from our own button; iOS
Safari fires nothing and exposes no API, so iOS users get the Share → "Sur
l'écran d'accueil" instruction and nobody already running installed sees
anything. Dismissal is remembered per browser.

A service worker is deliberately **not** included. The documented use for one
here is push notifications, which nothing in the application sends yet, and an
offline cache over per-firm personnel data would be a data-leak surface rather
than a feature. Add one when there is a push story to serve.

## Q15 — Who reaches `/admin`? · `DECIDED` — OWNER **or** ADMIN, checked on every action

You chose to keep the legacy access rule rather than tighten it: being OWNER or
ADMIN of any firm grants the cross-tenant console. What was missing was the
enforcement, not the rule.

Two things this build got wrong first, and now does not:

- `requireHoldingAccess` admitted **OWNER only**, while the firm switcher offered
  the Administration entry to OWNER *and* ADMIN. An administrator was handed a
  link that always answered 403. The gate now matches the affordance.
- The legacy `/api/firms` and `/api/users` routes checked only that a session
  existed. Any signed-in user could create a firm, delete a colleague, or reset
  a password — including their own account to OWNER. Every console mutation now
  goes through `holdingAction`, which authorises before the handler runs and
  audits inside the same transaction.

This is verified rather than asserted: `pnpm check:admin` signs in as a STAFF
account against a running production server and fires all nine administration
actions at it, then reads the database back to prove that nothing was written —
no firm created, no password changed, no module registered — and that the
refused attempts left no audit rows. The same harness proves the admin happy
path end to end: firm create/update/delete with the typed-name confirmation,
user creation with a hashed password and a pre-verified email, RESPONSABLE
client assignments replacing rather than merging, and duplicate slug and
duplicate email arriving as field errors rather than Prisma stack traces.

## Q16 — Matricule prefixes · `DECIDED` — `CI` and `SP`, stored per firm

`generateNextMatricule` in the legacy app took a `prefix` parameter that no
caller ever passed, so every firm numbered its employees `CI####` — including
Synergie Pro. That is the root cause of the matricule collisions the transfer
flow keeps hitting, and the reason `newMatricule` exists on `EmployeeTransfer`
at all.

The prefix now lives per firm in `FirmModule.settings.matriculePrefix` on the HR
module — the schema's own JSON extension point, since the schema is frozen and
there is no column for it — and is editable in the admin firm dialog. Firms with
nothing configured fall back to initials derived from their slug. Existing
matricules are never rewritten.

You confirmed `SP` and `CI` are enough for now. Contract types with configurable
legal durations remain a later change; the ceiling constants are collected in
one file so that becomes an edit rather than a rewrite.

## Q17 — Sidebar structure · `DECIDED` — ReUI anatomy, one account popover

You pointed at the ReUI template sidebar and asked for its *structure*, keeping
the module-grouped links as they are. What you singled out was the popover that
opens from the profile chip.

What changed, and why:

- **Firm switching moved into the account popover.** It used to be a second
  dropdown hanging off a chevron in the brand block, which meant two menus that
  both answered "where am I and who am I". The brand block is now identity plus
  the two controls that act on the shell itself — the alert bell and the
  collapse toggle — and the popover holds Entreprises, Profil, Préférences,
  Thème and Déconnexion in one place.
- **The collapse toggle moved from the footer to the brand row.** It was the
  last thing in the column, below the account chip, which is the least likely
  place to look for it.
- **Theme is an inline three-icon segmented control**, not three stacked rows.
  It is a setting with a current value rather than three commands, and a
  segmented control says that at a glance. They are real menu `RadioItem`s, so
  arrow keys reach them and choosing one does not close the menu.
- **The shortcuts printed in the menu are wired.** `⇧⌘P` opens the profile and
  `⇧⌘Q` signs out (`⇧Ctrl` off Apple platforms, detected once at module load so
  it cannot cause a hydration mismatch). A shortcut printed in a menu and not
  implemented is worse than no shortcut.
- **An alert bell** in the brand block, counting the same Décisions queue
  through the same access-filtered resolver — so a responsable's badge counts
  only their own portfolio. The badge shows at most `9+`; the exact figure is in
  its accessible name. It is tinted rather than solid, because `--sx-signal`
  means the legal ceiling and nothing else, and solid alert loses contrast in
  the dark theme.

Unchanged, as you asked: the module-grouped links, the "effectif par client"
group with its per-client dots, the pinned legal-ceiling card, the search field
that opens the command palette, and the icon-rail collapsed variant.

## Q18 — The write layer · `DONE` — one spine, verified over HTTP

Every mutation in the application goes through `defineAction`: input parsed
from a schema shared with the form, authorisation from the caller's own session
before the handler runs, the handler inside a transaction, the audit row written
to that same transaction, and revalidation only after it commits. There are
three entry points — `firmAction`, `holdingAction`, `sessionAction` — and no
fourth way to write.

What that structurally prevents, all of which the legacy application did
somewhere: authorisation applied by copy-paste and forgotten in places, a firm
id taken from the client rather than resolved from the session, an audit row
that survives the failure of the write it describes, and a form whose rules
disagree with the action's.

**Behaviours kept verbatim.** Creating an employee creates their first contract
in the same transaction, deriving its dates, position, salary and client from
the fiche, with the `"Initial contract created during employee onboarding"`
marker so rows written by either application read the same. Leave days are
counted Monday to Friday, inclusive of both ends. Bcrypt cost 10.

**Behaviours fixed.**

- Editing an employee used to desynchronise the active contract in silence. The
  edit now asks, and the result says which contract it touched.
- Terminating a contract now pulls its end date back to the termination, so the
  730-day cumulation stops on the day the work did.
- Deleting a document removes the stored file too. Every deleted document used
  to leak its blob on the Zipline instance forever.
- An upload that fails to insert deletes the blob it just wrote, because the
  upload is a call to another host and cannot join the transaction.
- The CSV import had no role check at all.
- Archiving a client is refused while employees or active contracts are still
  attached, rather than silently emptying a responsable's portfolio.

**Public holidays are not subtracted from leave.** There is nowhere in the
frozen schema to record the Senegalese calendar, and a hard-coded list would be
wrong the first time a movable feast shifted. This matches the legacy
calculation. If it matters, the place to put it is a `FirmModule.settings` key.

## Q19 — Transfers · `DONE` — the four fixes, proven

The state machine is the legacy one, deliberately: the destination firm
approves, the source firm completes. `requireFirmAccess` authorises one firm and
a transfer touches two, so each step authorises the **correct side** — the piece
the legacy code lacked entirely, where any signed-in user could act on any
transfer.

1. **Duplicate guard.** A new request is refused while any transfer for that
   employee is in a non-terminal state — `PENDING` **or** `APPROVED`. The legacy
   guard checked `PENDING` only, which is how one employee ended up with two.
2. **Destination contract.** Completion now opens a contract in the destination
   firm. Before, it closed the source contracts, moved the person, and left them
   belonging to a firm and employed by nobody — visible in the live deployment
   today. The request dialog had the checkbox and never sent it; the choice is
   now recorded on the request and honoured at completion.
3. **Bulk transfer** is one server action in one transaction, replacing a
   browser-side loop that could half-succeed. Matricules are reserved in
   sequence inside that transaction, so a batch of thirty cannot hand out the
   same number twice.
4. **Client assignment** is written only when the transfer names one. Completion
   used to set it unconditionally, so a transfer raised without a client
   silently cleared the employee's existing assignment.

Two further guards that are not fixes so much as the rules stated out loud: the
effective date gates completion, and the reserved matricule is re-checked at
both approval and completion, because weeks pass in between and the number can
be taken.

`pnpm check:hr` proves all of it against a running production server — the
second request refused at both `PENDING` and `APPROVED`, the employee arriving
in the destination firm with an `SP` matricule and an **active contract**, and
every source contract closed.
