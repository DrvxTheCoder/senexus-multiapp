# Open questions

Raised per §0 and §1.1: where the UI needs a value the schema cannot supply, or where the brief and
the existing behaviour disagree. **No question here is answered by adding a column.**

Status: `OPEN` — blocks work · `ASSUMED` — proceeding on the stated assumption, correct me · `CLOSED`.

---

## Q1 — Which database, and may I read production? · `OPEN` · blocks the census

`DATABASE_URL` resolves to `localhost:5432/senexusdb`, which is an empty seed: 1 user, 2 firms,
2 modules, 1 audit log, and **zero** employees, contracts, clients or documents. The brief describes
a live database with 200+ personnel records, which is presumably the commented-out
`postgres://…@72.62.27.117:5433/postgres`.

I have not contacted that host. Two things are needed:

1. **Permission for a read-only census** against production, so §0 can report real row counts and
   answer which modules actually carry data (payroll, missions, absences, departments, IPM). That
   determines the scope you picked — "everything currently in use".
2. **A development data story.** Building the tables, dashboard aggregates and the p95 < 300 ms
   target against an empty database proves nothing. Options, in order of preference:
   - restore a production dump into `localhost:5432/senexusdb` (best: real shapes, no risk to prod);
   - point dev at production read-only and never write (risky, one careless mutation away from harm);
   - generate a synthetic seed at production volume (safe, but hides real data quirks, and §10 of the
     brief forbids leaving placeholder content anywhere).

**Nothing downstream of the query layer can be measured until this is settled.**

---

## Q2 — What exactly is a "cumulative interim day"? · `OPEN` · blocks §6 and the InterimMeter

This is a genuine behaviour change, not a port, so it needs your decision rather than my assumption.

**Today** (`senexus-hr/src/modules/hr/actions/employee-actions.ts`) the ceiling is calendar time
since hire: `daysElapsed = now − Employee.hireDate`, ceiling `= hireDate + 2 years`. Contract
history, contract type and gaps between contracts are all ignored.

**The brief** (§6) asks for cumulative days computed from contract history, within the current firm
only. That is a different number for every employee who has had a gap, and it is the number the
`InterimMeter` will display everywhere.

Decisions needed:

1. **Elapsed or contracted?** Sum `min(endDate, today) − startDate` (days actually worked so far),
   or the full contracted span `endDate − startDate` including future end dates? The second is what
   a labour inspector would count against a renewal decision; the first is what "cumulative days
   worked" literally means. The prototype shows both a "used" figure and days remaining, which reads
   as *elapsed* — but the pre-flight renewal check (§6) only works on *contracted*.
2. **Overlaps.** If two contracts overlap in time, count the union of days or the sum? Union is
   legally right; sum is what a naive `SUM(endDate - startDate)` gives.
3. **Gaps.** Confirmed excluded — days between contracts do not count. (Assumed yes.)
4. **Which statuses count?** `TERMINATED` and `EXPIRED` contracts presumably still count toward the
   ceiling (the days were worked). `RENEWED` predecessors certainly do. Confirm.

---

## Q3 — Which contract types count toward the 730-day ceiling? · `OPEN`

`ContractType` is `CDI` · `CDD` · `INTERIM` · `STAGE` · `PRESTATION`. The brief says CDI is exempt
and renders "non applicable". That leaves three unstated:

- **`CDD`** — Senegalese law caps CDD renewals separately from interim. Does it share the 730 meter,
  get its own rule, or show "non applicable"?
- **`STAGE`** (internship) — presumably exempt.
- **`PRESTATION`** (service provision) — presumably exempt, since it is not employment.

The prototype shows a meter for `CDD` and `PRESTATION` rows, which contradicts "the 730-day interim
ceiling", so I need the rule rather than a guess.

---

## Q4 — Modules are database rows; five of them do not exist · `OPEN`

Only two `Module` rows exist, `hr` and `crm`. Per §3.4 a disabled module hides its nav and 404s its
routes — which means **payroll, missions, absences, IPM, documents, transfers and admin have no
module to gate them**, and would 404 on arrival.

Three ways forward, and the choice is yours because two of them write to production data:

1. **Insert the missing `Module` rows + `FirmModule` rows.** Data, not schema, so §1.1 permits it —
   but it is a production write and I will not do it unprompted.
2. **Treat HR sub-features as part of the `hr` module** (leaves, documents, transfers, absences,
   payroll all live under `/hr/…` and are gated by `hr`). Simplest, and matches `basePath: '/hr'`.
   **This is my recommendation** and what I will assume if you do not say otherwise.
3. Leave them ungated entirely, which loses the per-firm on/off switch.

---

## Q5 — How is one person identified across two firms? · `OPEN` · blocks the Parcours tab

§5.5 wants "employments across group firms, each with its own matricule". The schema has no `Person`
table, and `Employee` is per-firm. After a transfer, the single `Employee` row *moves* firm and its
matricule is overwritten (see `DATA_MODEL.md` §5), so the history exists only as:

- `EmployeeTransfer` rows (`fromFirmId` → `toFirmId`, `newMatricule`, dates), and
- `Contract` rows, which keep the `firmId` they were signed under.

That reconstructs the parcours for **transferred** employees. It does **not** link two independently
created `Employee` rows for the same person in two firms — someone hired separately by both.

Candidate join keys, none reliable: `Employee.cni` (nullable, free text, formatting varies),
`Employee.userId` (almost always null), or name + `dateOfBirth`.

**Proposal:** build Parcours from transfers + contract firm history only, and treat unlinked
duplicate people as out of scope rather than fuzzy-matching on CNI. Say if you want CNI matching —
it is doable, but it will produce false positives on a nullable free-text field, and it would join
personnel records across tenants, which is precisely what §1.2 forbids.

---

## Q6 — Where do the sidebar and UI preferences persist? · `ASSUMED`

§5.1 wants the collapsed/expanded sidebar "persisted server-side per user". No preferences table
exists. `DashboardView { firmId, userId, name, config Json }` is the only per-user-per-firm JSON
store, and §1.1 directs us to use it rather than invent storage.

**Assumption:** a reserved `DashboardView` row per user per firm, `name = '__ui_state'`, holding
sidebar state and similar chrome preferences; user-created saved views use ordinary names and the
reserved name is filtered out of the saved-views UI. Cookie-only would be simpler but is per-device,
which is not what "server-side per user" means. Correct me if you would rather use a cookie.

---

## Q7 — Auth.js v5, and the existing password hashes · `ASSUMED`

Legacy runs `next-auth@4` with a credentials provider over bcrypt `User.passwordHash`. v4 does not
support Next 16; the brief specifies Auth.js v5, JWT strategy.

**Assumption:** Auth.js v5 with the same credentials provider and the same bcrypt verification, so
**every existing password keeps working** and no user has to reset anything. Memberships and roles
go into the JWT at sign-in per §3.2. The `sessions` table stays unused.

---

## Q8 — Which GlitchTip project? · `OPEN` · small but blocking for §7

The brief gives DSN `…@glitchtip.senexus-app.cloud/1` with `GLITCHTIP_PROJECT_ID=1`. Your `.env`
already has a different `NEXT_PUBLIC_SENTRY_DSN` plus `NEXT_PUBLIC_SENTRY_DISABLED` and
`SENTRY_AUTH_TOKEN`. Should the new app report to the same project as the old one, or to a fresh
project so the rebuild has its own error stream? A fresh project is cleaner during the rebuild.

Note the brief prints the DSN and key in plain text; they will live in `.env` only, and
`.env.example` gets placeholders. `.env` is already gitignored here.

---

## Q9 — What does the top-bar date range filter? · `OPEN` · low priority

The prototype shows a range picker ("1 – 30 sept. 2026") in the top bar on every screen, but nothing
in the mock reacts to it. Candidates: dashboard aggregates only; contract start/end overlap; the
period for the KPI deltas. Until answered I will scope it to the dashboard and leave the resource
lists filtered by their own explicit facets, since a hidden global date filter on a list is exactly
the kind of thing that makes an exported file disagree with the screen.

---

## Q10 — What is in the "Décisions" queue? · `ASSUMED`

The prototype sidebar shows a `Décisions` item with a count, and the dashboard panel mixes ceiling
breaches, contract renewals, leave requests and transfers, sorted by age.

**Assumption:** the queue is the union of — `LeaveRequest.status = PENDING`,
`EmployeeTransfer.status = PENDING`, contracts within their `alertThreshold` of `endDate`, and
employees at or above the ceiling warning band. Aged by `requestedAt` / `createdAt` / days remaining
respectively, firm-scoped and role-scoped like everything else. Tell me if approvals belong to
specific roles only, or if there are other decision types.

---

## Q11 — FCFA has no minor unit, but money columns are `Decimal(10,2)` · `ASSUMED`

`Employee.netSalary`, `Contract.salary`, `Payslip.*`, `Claim.amount`, `Contribution.amount` and
`MissionExpense.amount` are all `Decimal(10, 2)`. The brief says currency renders space-grouped with
**no decimal**.

**Assumption:** store as-is, render rounded to the unit (`145 190 000 FCFA`), and never introduce a
decimal in input either. Worth knowing that `Decimal(10,2)` caps a single value at 99 999 999,99 —
fine per salary, and aggregate sums are computed in SQL and returned wider, so payroll totals are not
capped.
