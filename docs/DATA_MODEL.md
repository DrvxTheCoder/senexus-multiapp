# Data model

Authoritative dictionary for the Senexus database. **The schema is frozen.** Where this document
and `prisma/schema.prisma` disagree, the schema wins.

- **Source:** `prisma/schema.prisma`, copied byte-for-byte from `senexus-hr/prisma/schema.prisma`
  (sha256 `86188a02d557f65dca8bd9a8840ab010608900c0b75c5201a529a64427411df7`, 29 057 bytes, CRLF).
- **Shape:** 37 models, 17 enums, 2 composite primary keys, 14 composite uniques, **0 declared indexes**.
- **Generated section:** everything under "Model reference" is emitted from the Prisma DMMF by
  `scripts/gen-data-model.mjs`, not transcribed by hand. Re-run it after any schema change.
- `prisma generate` only. No migration has been or will be run from this project.

---

## 1. Connection check

`pnpm exec prisma generate` succeeded on Prisma 6.19.3, and a read-only count ran against every one
of the 37 models (`scripts/db-census.mjs`).

**The configured database is not the production one.** `DATABASE_URL` points at
`localhost:5432/senexusdb`, which holds a bare seed:

| Model | Rows | | Model | Rows |
| --- | ---: | --- | --- | ---: |
| `Holding` | 1 | | `Module` | 2 |
| `Firm` | 2 | | `FirmModule` | 4 |
| `User` | 1 | | `AuditLog` | 1 |
| `UserFirm` | 2 | | **all 30 others** | **0** |

Zero employees, zero contracts, zero clients, zero documents. The commented-out
`postgres://…@72.62.27.117:5433/postgres` in `.env` is presumably the production database holding
the 200+ personnel records the brief describes; it has not been contacted. See
`docs/OPEN_QUESTIONS.md` Q1.

What the seed does tell us:

| Firm | slug | `themeColor` | `logo` |
| --- | --- | --- | --- |
| Connect Interim | `connect-interim` | `amber` | `''` (empty string) |
| Senexus Consulting | `senexus-consulting` | `#10b981` | `null` |

Both firms belong to holding `senexus-group-holding` ("Senexus Group"). Both have the `hr` and
`crm` modules enabled — those are the only two `Module` rows that exist. The single user is `OWNER`
of both firms.

---

## 2. Tenancy

The chain is **`Holding` → `Firm` → `UserFirm` → `User`**.

- `Firm.holdingId` is required, cascade-deleted. One holding today.
- `Firm.slug` is globally `@unique` — safe as the sole key for `/[firmSlug]` route resolution, with
  no holding qualifier needed.
- `UserFirm` is the membership join: `@@unique([userId, firmId])` with a required `role`. A given
  user has a small, cheap set of memberships — exactly the shape to embed in the JWT (§3.2).
- **Firm scoping is a plain `firmId` column, not relation nesting.** These models carry `firmId`
  directly: `Employee`, `Contract`, `Department`, `LeaveRequest`, `Absence`, `Mission`, `Payslip`,
  `PayrollConfig`, `Client`, `UserClientAssignment`, `ClientFirmAssignment`,
  `ClientQuarterlyReport`, `Partner`, `PartnerAgreement`, `BenefitPlan`, `Contribution`, `Claim`,
  `FileObject`, `EmployeeDocument`, `DashboardView`, plus nullable `AuditLog.firmId`.
- These carry **no `firmId`** and must be scoped through their parent: `LeaveBalance`
  (→ `Employee`), `EmployeeSalary` (→ `Employee`), `MissionExpense` (→ `Mission`), `PartnerBranch`
  (→ `Partner`), `EmployeeCoverageEnrollment` (→ `Employee`), `ModuleDependency` (global), and
  `EmployeeTransfer`, which has `fromFirmId` **and** `toFirmId` but never a single `firmId` — see §5.
- `Contract` carries **two** firm references: `firmId` (the employer) and `clientFirmId` (a *group*
  firm the employee is placed at, relation `ClientFirmContracts`). Only `firmId` is the tenancy key.
  Filtering on `clientFirmId` by mistake would silently cross tenants.

### Roles

`FirmRole` = `OWNER` · `ADMIN` · `MANAGER` · **`RESPONSABLE`** · `STAFF` · `VIEWER`.

`RESPONSABLE` is the client-responsable concept the brief anticipated. It carries no schema-level
meaning; the restriction it implies is expressed by **`UserClientAssignment`**
(`@@unique([userId, clientId, firmId])`) — the set of clients a user may see within a firm. That is
the scoping `buildEmployeeWhere` and its siblings must apply internally (§3.5), and it is the leak
the brief flags: today it is applied in the list endpoint only.

---

## 3. Employees, firms and contracts

- **`Employee` is per-firm, not per-person.** `@@unique([firmId, matricule])`. One human working for
  two group firms is two `Employee` rows with two matricules — except after a transfer; see §5.
- `Employee.userId` is optional and links a login account. It is **not** a person identity key:
  nothing prevents two `Employee` rows sharing a `userId`, and almost no employee will have one.
  There is no `Person` table. The only person-level identifiers available are `cni` (nullable, free
  text) and name + `dateOfBirth`.
- `Contract.firmId` + `Contract.employeeId` + `Contract.type` is what the **730-day ceiling** must be
  computed from: sum the covered days of `INTERIM` contracts for one employee **within one
  `firmId`**. `Employee.hireDate` is not the input — see the discrepancy in §7.
- Renewal chains are `Contract.renewedFromId` → self-relation `ContractRenewal`. Walk a chain by
  following `renewedFrom`, or gather it in one query through `renewals`.
- `Contract.alertThreshold` is `Int @default(30)`, per contract. It exists; nothing reads it today.
- `Contract` has three overlapping state fields — `status`
  (`ACTIVE`/`EXPIRED`/`TERMINATED`/`RENEWED`), `isActive Boolean`, and `endDate` — which can
  disagree. Treat `status` as authoritative and derive expiry from `endDate` against `now`; never
  trust `isActive` alone.
- `Employee.contractEndDate` and `Employee.netSalary` duplicate data that also lives on `Contract`.
  They are denormalised copies with no enforced consistency. Prefer `Contract`.
- `Department` is `@@unique([firmId, code])`, and `Department.managerId` points at an `Employee`
  (relation `DepartmentManager`) with no guarantee that manager and department share a firm.

---

## 4. Documents and files

Two parallel, unrelated models:

| | `FileObject` | `EmployeeDocument` |
| --- | --- | --- |
| Scope | `firmId` + polymorphic `entity`/`entityId` | `firmId` + `employeeId` (real FK) |
| Entities | `FileEntity`: EMPLOYEE, CLIENT, CONTRACT, MISSION, LEAVE_REQUEST, CLAIM | employees only |
| Storage | `storageKey` | `storageKey` **and** `fileUrl` |
| Verification | none | `isVerified`, `verifiedBy`, `verifiedAt` |
| Extras | `expiryDate` | `expiryDate`, `tags[]`, `metadata Json` |

`EmployeeDocument.fileUrl` is the raw Zipline URL the brief wants off the wire (§3.7). It stays in
the database; the app serves bytes through `GET /api/files/[documentId]` behind `requireFirmAccess`,
and never renders `fileUrl` into HTML. `FileObject.entityId` is untyped — any query on it must be
paired with an `entity` predicate *and* the `firmId`.

Other unauthenticated URL columns that belong behind the same gate:
`LeaveRequest.supportingDoc`, `Absence.supportingDoc`, `MissionExpense.receiptUrl`,
`ClientQuarterlyReport.pdfUrl` / `excelUrl`, `Employee.photoUrl`, `Client.photoUrl`, `Firm.logo`,
`User.image`.

---

## 5. Transfers, and why they complicate isolation

`EmployeeTransfer` records a move between two group firms: `fromFirmId`, `toFirmId`,
`effectiveDate`, `status` (`TransferStatus`), `newMatricule`, requester and approver.

**The legacy completion routine mutates the employee in place**
(`senexus-hr/src/app/api/firms/[id]/transfers/[transferId]/complete/route.ts`): inside one
transaction it terminates every `ACTIVE` contract in the source firm, then sets
`employee.firmId = toFirmId`, `assignedClientId`, and `matricule = newMatricule`.

Four consequences the new query layer has to handle deliberately:

1. **A person has one `Employee` row, and it migrates.** The old matricule is overwritten and
   survives only on the `EmployeeTransfer` row.
2. **Contracts stay behind.** Source-firm contracts keep `firmId = fromFirmId` while their employee
   now belongs to another firm. A firm-scoped contract query therefore joins to an employee row
   owned by a *different* tenant — a real cross-tenant read unless the `select` set is restricted.
   Firm-scoped **employee** lists, by contrast, lose the person entirely.
3. **Parcours (§5.5) is reconstructable, but not from `Employee`.** Build it from the distinct
   `firmId`s on that employee's `Contract` rows, plus the `EmployeeTransfer` chain for the per-firm
   matricules and dates.
4. **The 730-day count stays correct** under this design precisely because it derives from
   `Contract.firmId`, not from the employee's current firm.

---

## 6. NextAuth tables

Standard Auth.js / NextAuth shape, all `@@map`ped to snake_case: `users`, `accounts`, `sessions`,
`verification_tokens`.

- `User.passwordHash` is an extra column for the credentials provider (bcrypt in legacy).
- `Account` uses `@@id([provider, providerAccountId])` and snake_case OAuth columns
  (`refresh_token`, `access_token`, `expires_at`, …) — the names Auth.js v5 expects.
- `Account` and `Session` both add non-standard `createdAt` / `updatedAt`, and both are **empty**
  (0 rows), consistent with the legacy JWT session strategy: the `sessions` table is unused.
- Keeping the JWT strategy means the adapter never writes `Session`. That is both the current
  behaviour and the brief's §3.2 requirement.

---

## 7. Discrepancies between the brief and the schema

Flagged as §0 requires. None of these change the schema.

1. **`Firm.themeColor` holds two different formats in live data** — `'#10b981'` (hex) on one firm,
   `'amber'` (a name) on the other. The brief predicted this. Standardise on hex, validate at the
   application boundary, convert to OKLCH for the token set, and fall back to the brand token when
   the value is a name or null. `Firm.logo` is `''` on one firm and `null` on the other, so `??` is
   not enough — treat the empty string as absent.
2. **The 730-day rule is computed differently today.**
   `senexus-hr/src/modules/hr/actions/employee-actions.ts` derives it from `Employee.hireDate`:
   elapsed = `now − hireDate`, ceiling = `hireDate + 2 years`. That is calendar time since hire, not
   cumulative contracted interim days; it ignores contract type and gaps between contracts. The
   brief's §6 ("cumulative days from contract history … within the current firm only") is therefore
   a **behaviour change**, not a port. Raised as Q2.
3. **Alert thresholds disagree three ways**, as the brief says: legacy `isApproachingLimit` uses 90
   days, the contracts route buckets `EXPIRING` at 90, the dashboard uses 30, and the stored
   `Contract.alertThreshold` (default 30) is never read. Unify on the stored value, defaulting to
   30, surfaced in firm settings.
4. **CDI has no exemption in the data.** Nothing marks a contract as exempt from the ceiling; it is
   inferred from `type == CDI`. `STAGE` and `PRESTATION` are unclassified — Q3.
5. **`DashboardView` is empty and unused** — 0 rows. Its shape is `{ firmId, userId, name, config
   Json }`, the correct home for saved views (§3.5). No schema change needed; `config` stores the
   serialised query.
6. **Modules are data, not code.** Only `hr` and `crm` rows exist, with `basePath` `/hr` and `/crm`.
   Payroll, missions, absences, IPM and admin have models but no `Module` row, so they cannot
   currently be enabled per firm. Routes for them need a module row, or must live outside the module
   gate — Q4.

---

## 8. Indexes

**The live database has 56 indexes and every one is a primary key or a unique constraint.** There is
not a single secondary index, and `prisma/schema.prisma` declares no `@@index` at all. PostgreSQL
does not index foreign keys automatically, so these hot columns are currently unindexed:

`contracts.firmId`, `contracts.employeeId`, `contracts.clientId`, `contracts.renewedFromId`,
`contracts.endDate`, `employees.assignedClientId`, `employees.departmentId`, `employees.status`,
`leave_requests.firmId`, `leave_requests.employeeId`, `employee_documents.employeeId`,
`file_objects.(firmId, entity, entityId)`, `employee_transfers.employeeId`, `audit_logs.firmId`,
`clients.firmId`.

`employees.firmId` is the one exception: it leads `employees_firmId_matricule_key`, so firm-scoped
employee scans can use that index.

Per §1.1 nothing is applied. Candidates go to `docs/PROPOSED_INDEXES.sql` with the query each serves
and a measured cost, once there is production-shaped data to measure against.

---

## Model reference

## Enums

| Enum | Values |
| --- | --- |
| `FirmRole` | `OWNER` · `ADMIN` · `MANAGER` · `RESPONSABLE` · `STAFF` · `VIEWER` |
| `EmployeeStatus` | `ACTIVE` · `INACTIVE` · `SUSPENDED` · `TERMINATED` · `ON_LEAVE` |
| `Gender` | `MALE` · `FEMALE` · `OTHER` |
| `ContractType` | `CDI` · `CDD` · `INTERIM` · `STAGE` · `PRESTATION` |
| `ContractStatus` | `ACTIVE` · `EXPIRED` · `TERMINATED` · `RENEWED` |
| `TransferStatus` | `PENDING` · `APPROVED` · `REJECTED` · `COMPLETED` · `CANCELLED` |
| `LeaveType` | `ANNUAL` · `SICK` · `MATERNITY` · `PATERNITY` · `UNPAID` · `SPECIAL` · `COMPENSATORY` |
| `LeaveStatus` | `PENDING` · `APPROVED` · `REJECTED` · `CANCELLED` |
| `AbsenceType` | `UNJUSTIFIED` · `JUSTIFIED` · `LATE_ARRIVAL` · `EARLY_DEPARTURE` |
| `MissionStatus` | `DRAFT` · `SUBMITTED` · `APPROVED` · `REJECTED` · `IN_PROGRESS` · `COMPLETED` · `CANCELLED` |
| `ExpenseCategory` | `TRANSPORT` · `ACCOMMODATION` · `MEALS` · `FUEL` · `OTHER` |
| `PayslipStatus` | `DRAFT` · `APPROVED` · `PAID` · `CANCELLED` |
| `ClientStatus` | `ACTIVE` · `INACTIVE` · `PROSPECT` · `ARCHIVED` |
| `PartnerType` | `PHARMACY` · `HOSPITAL` · `CLINIC` |
| `ClaimStatus` | `SUBMITTED` · `REVIEWING` · `APPROVED` · `REJECTED` · `PAID` |
| `DocumentType` | `CV` · `ID_CARD` · `PASSPORT` · `CONTRACT` · `PAYSLIP` · `CERTIFICATE` · `DIPLOMA` · `MEDICAL_CERTIFICATE` · `LEGAL_DOCUMENT` · `MISSION_REPORT` · `EXPENSE_RECEIPT` · `OTHER` |
| `FileEntity` | `EMPLOYEE` · `CLIENT` · `CONTRACT` · `MISSION` · `LEAVE_REQUEST` · `CLAIM` |

## Models

### `User` → table `users`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `name` | String | yes |  |
| `email` | String | no | unique |
| `emailVerified` | DateTime | yes |  |
| `image` | String | yes |  |
| `passwordHash` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `accounts` | `Account` | many | — | — | — |
| `sessions` | `Session` | many | — | — | — |
| `userFirms` | `UserFirm` | many | — | — | — |
| `employees` | `Employee` | many | — | — | — |
| `dashboards` | `DashboardView` | many | — | — | — |
| `auditLogs` | `AuditLog` | many | — | — | — |
| `uploadedFiles` | `FileObject` | many | — | — | — |
| `reviewedLeaves` | `LeaveRequest` | many | — | — | — |
| `recordedAbsences` | `Absence` | many | — | — | — |
| `approvedMissions` | `Mission` | many | — | — | — |
| `approvedPayslips` | `Payslip` | many | — | — | — |
| `generatedReports` | `ClientQuarterlyReport` | many | — | — | — |
| `requestedTransfers` | `EmployeeTransfer` | many | — | — | `TransferRequester` |
| `approvedTransfers` | `EmployeeTransfer` | many | — | — | `TransferApprover` |
| `uploadedDocuments` | `EmployeeDocument` | many | — | — | `DocumentUploader` |
| `verifiedDocuments` | `EmployeeDocument` | many | — | — | `DocumentVerifier` |
| `clientAssignments` | `UserClientAssignment` | many | — | — | — |

**Constraints:** `@id` on `id` · `@unique` on `email`

---

### `Account` → table `accounts`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `userId` | String | no |  |
| `type` | String | no |  |
| `provider` | String | no |  |
| `providerAccountId` | String | no |  |
| `refresh_token` | String | yes |  |
| `access_token` | String | yes |  |
| `expires_at` | Int | yes |  |
| `token_type` | String | yes |  |
| `scope` | String | yes |  |
| `id_token` | String | yes |  |
| `session_state` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `user` | `User` | one | `userId` | Cascade | — |

**Constraints:** `@@id([provider, providerAccountId])`

---

### `Session` → table `sessions`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `sessionToken` | String | no | unique |
| `userId` | String | no |  |
| `expires` | DateTime | no |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `user` | `User` | one | `userId` | Cascade | — |

**Constraints:** `@unique` on `sessionToken`

---

### `VerificationToken` → table `verification_tokens`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `identifier` | String | no |  |
| `token` | String | no |  |
| `expires` | DateTime | no |  |

**Constraints:** `@@id([identifier, token])`

---

### `Holding` → table `holdings`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `name` | String | no |  |
| `description` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firms` | `Firm` | many | — | — | — |

**Constraints:** `@id` on `id`

---

### `Firm` → table `firms`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `holdingId` | String | no |  |
| `name` | String | no |  |
| `slug` | String | no | unique |
| `logo` | String | yes |  |
| `themeColor` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `holding` | `Holding` | one | `holdingId` | Cascade | — |
| `userFirms` | `UserFirm` | many | — | — | — |
| `firmModules` | `FirmModule` | many | — | — | — |
| `departments` | `Department` | many | — | — | — |
| `employees` | `Employee` | many | — | — | — |
| `contracts` | `Contract` | many | — | — | — |
| `clientFirmContracts` | `Contract` | many | — | — | `ClientFirmContracts` |
| `leaveRequests` | `LeaveRequest` | many | — | — | — |
| `missions` | `Mission` | many | — | — | — |
| `clients` | `Client` | many | — | — | — |
| `clientAssignments` | `ClientFirmAssignment` | many | — | — | — |
| `userClientAssignments` | `UserClientAssignment` | many | — | — | — |
| `clientReports` | `ClientQuarterlyReport` | many | — | — | — |
| `partners` | `Partner` | many | — | — | — |
| `partnerAgreements` | `PartnerAgreement` | many | — | — | — |
| `benefitPlans` | `BenefitPlan` | many | — | — | — |
| `contributions` | `Contribution` | many | — | — | — |
| `claims` | `Claim` | many | — | — | — |
| `files` | `FileObject` | many | — | — | — |
| `dashboards` | `DashboardView` | many | — | — | — |
| `auditLogs` | `AuditLog` | many | — | — | — |
| `transfersOut` | `EmployeeTransfer` | many | — | — | `TransfersOut` |
| `transfersIn` | `EmployeeTransfer` | many | — | — | `TransfersIn` |
| `payrollConfig` | `PayrollConfig` | one? | — | — | — |
| `payslips` | `Payslip` | many | — | — | — |

**Constraints:** `@id` on `id` · `@unique` on `slug`

---

### `UserFirm` → table `user_firms`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `userId` | String | no |  |
| `firmId` | String | no |  |
| `role` | FirmRole | no |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `user` | `User` | one | `userId` | Cascade | — |
| `firm` | `Firm` | one | `firmId` | Cascade | — |

**Constraints:** `@id` on `id` · `@@unique([userId, firmId])`

---

### `Module` → table `modules`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `slug` | String | no | unique |
| `name` | String | no |  |
| `description` | String | yes |  |
| `version` | String | no |  |
| `icon` | String | yes |  |
| `basePath` | String | no |  |
| `isSystem` | Boolean | no | default `false` |
| `isActive` | Boolean | no | default `true` |
| `metadata` | Json | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firmModules` | `FirmModule` | many | — | — | — |
| `dependencies` | `ModuleDependency` | many | — | — | `ModuleDeps` |
| `requiredBy` | `ModuleDependency` | many | — | — | `RequiredBy` |

**Constraints:** `@id` on `id` · `@unique` on `slug`

---

### `FirmModule` → table `firm_modules`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `moduleId` | String | no |  |
| `isEnabled` | Boolean | no | default `true` |
| `settings` | Json | yes |  |
| `installedAt` | DateTime | no | default `now()` |
| `installedBy` | String | yes |  |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `module` | `Module` | one | `moduleId` | Cascade | — |

**Constraints:** `@id` on `id` · `@@unique([firmId, moduleId])`

---

### `ModuleDependency` → table `module_dependencies`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `moduleId` | String | no |  |
| `dependsOnId` | String | no |  |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `module` | `Module` | one | `moduleId` | Cascade | `ModuleDeps` |
| `dependsOn` | `Module` | one | `dependsOnId` | Cascade | `RequiredBy` |

**Constraints:** `@id` on `id` · `@@unique([moduleId, dependsOnId])`

---

### `Department` → table `departments`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `name` | String | no |  |
| `code` | String | no |  |
| `managerId` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `manager` | `Employee` | one? | `managerId` | — | `DepartmentManager` |
| `employees` | `Employee` | many | — | — | `DepartmentEmployees` |

**Constraints:** `@id` on `id` · `@@unique([firmId, code])`

---

### `Employee` → table `employees`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `userId` | String | yes |  |
| `firstName` | String | no |  |
| `lastName` | String | no |  |
| `matricule` | String | no |  |
| `photoUrl` | String | yes |  |
| `departmentId` | String | yes |  |
| `assignedClientId` | String | yes |  |
| `status` | EmployeeStatus | no | default `"ACTIVE"` |
| `hireDate` | DateTime | no |  |
| `phone` | String | yes |  |
| `email` | String | yes |  |
| `address` | String | yes |  |
| `emergencyContact` | Json | yes |  |
| `dateOfBirth` | DateTime | yes |  |
| `placeOfBirth` | String | yes |  |
| `gender` | Gender | yes |  |
| `maritalStatus` | String | yes |  |
| `nationality` | String | yes |  |
| `cni` | String | yes | — National ID number |
| `fatherName` | String | yes |  |
| `motherName` | String | yes |  |
| `jobTitle` | String | yes |  |
| `category` | String | yes |  |
| `contractEndDate` | DateTime | yes |  |
| `netSalary` | Decimal | yes | `@db.Decimal(10, 2)` |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `user` | `User` | one? | `userId` | — | — |
| `department` | `Department` | one? | `departmentId` | — | `DepartmentEmployees` |
| `assignedClient` | `Client` | one? | `assignedClientId` | — | — |
| `managedDepartments` | `Department` | many | — | — | `DepartmentManager` |
| `contracts` | `Contract` | many | — | — | — |
| `leaveRequests` | `LeaveRequest` | many | — | — | — |
| `leaveBalances` | `LeaveBalance` | many | — | — | — |
| `absences` | `Absence` | many | — | — | — |
| `requestedMissions` | `Mission` | many | — | — | — |
| `transfersOut` | `EmployeeTransfer` | many | — | — | `TransferFrom` |
| `salaries` | `EmployeeSalary` | many | — | — | — |
| `payslips` | `Payslip` | many | — | — | — |
| `coverageEnrollments` | `EmployeeCoverageEnrollment` | many | — | — | — |
| `contributions` | `Contribution` | many | — | — | — |
| `claims` | `Claim` | many | — | — | — |
| `documents` | `EmployeeDocument` | many | — | — | — |

**Constraints:** `@id` on `id` · `@@unique([firmId, matricule])`

---

### `Contract` → table `contracts`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `employeeId` | String | no |  |
| `clientId` | String | yes |  |
| `type` | ContractType | no |  |
| `status` | ContractStatus | no | default `"ACTIVE"` |
| `startDate` | DateTime | no |  |
| `endDate` | DateTime | yes |  |
| `renewalDate` | DateTime | yes |  |
| `renewedFromId` | String | yes | — Reference to previous contract if renewed |
| `clientFirmId` | String | yes | — For interim: the client firm employee works at |
| `alertThreshold` | Int | no | default `30` |
| `isAutoRenewal` | Boolean | no | default `false` |
| `position` | String | yes |  |
| `salary` | Decimal | yes | `@db.Decimal(10, 2)` |
| `workingHours` | Int | yes |  |
| `trialPeriodEnd` | DateTime | yes |  |
| `notes` | String | yes |  |
| `isVise` | Boolean | no | default `false` |
| `isActive` | Boolean | no | default `true` |
| `terminationDate` | DateTime | yes |  |
| `terminationReason` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `employee` | `Employee` | one | `employeeId` | Cascade | — |
| `client` | `Client` | one? | `clientId` | — | — |
| `renewedFrom` | `Contract` | one? | `renewedFromId` | — | `ContractRenewal` |
| `renewals` | `Contract` | many | — | — | `ContractRenewal` |
| `clientFirm` | `Firm` | one? | `clientFirmId` | — | `ClientFirmContracts` |

**Constraints:** `@id` on `id`

---

### `EmployeeTransfer` → table `employee_transfers`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `employeeId` | String | no |  |
| `fromFirmId` | String | no |  |
| `toFirmId` | String | no |  |
| `clientId` | String | yes |  |
| `transferDate` | DateTime | no |  |
| `effectiveDate` | DateTime | no |  |
| `reason` | String | no |  |
| `status` | TransferStatus | no | default `"PENDING"` |
| `newMatricule` | String | yes |  |
| `requestedBy` | String | no |  |
| `approvedBy` | String | yes |  |
| `approvedAt` | DateTime | yes |  |
| `rejectionReason` | String | yes |  |
| `notes` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `employee` | `Employee` | one | `employeeId` | — | `TransferFrom` |
| `fromFirm` | `Firm` | one | `fromFirmId` | — | `TransfersOut` |
| `toFirm` | `Firm` | one | `toFirmId` | — | `TransfersIn` |
| `client` | `Client` | one? | `clientId` | — | — |
| `requester` | `User` | one | `requestedBy` | — | `TransferRequester` |
| `approver` | `User` | one? | `approvedBy` | — | `TransferApprover` |

**Constraints:** `@id` on `id`

---

### `LeaveRequest` → table `leave_requests`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `employeeId` | String | no |  |
| `leaveType` | LeaveType | no |  |
| `startDate` | DateTime | no |  |
| `endDate` | DateTime | no |  |
| `totalDays` | Decimal | no | `@db.Decimal(5, 2)` |
| `isPaid` | Boolean | no | default `true` |
| `status` | LeaveStatus | no | default `"PENDING"` |
| `reason` | String | yes |  |
| `isJustified` | Boolean | no | default `false` |
| `justification` | String | yes |  |
| `supportingDoc` | String | yes |  |
| `requestedAt` | DateTime | no | default `now()` |
| `reviewedBy` | String | yes |  |
| `reviewedAt` | DateTime | yes |  |
| `rejectionReason` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `employee` | `Employee` | one | `employeeId` | Cascade | — |
| `reviewer` | `User` | one? | `reviewedBy` | — | — |

**Constraints:** `@id` on `id`

---

### `LeaveBalance` → table `leave_balances`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `employeeId` | String | no |  |
| `year` | Int | no |  |
| `leaveType` | LeaveType | no |  |
| `totalDays` | Decimal | no | `@db.Decimal(5, 2)` |
| `usedDays` | Decimal | no | default `0`, `@db.Decimal(5, 2)` |
| `remainingDays` | Decimal | no | `@db.Decimal(5, 2)` |
| `carriedOver` | Decimal | no | default `0`, `@db.Decimal(5, 2)` |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `employee` | `Employee` | one | `employeeId` | Cascade | — |

**Constraints:** `@id` on `id` · `@@unique([employeeId, year, leaveType])`

---

### `Absence` → table `absences`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `employeeId` | String | no |  |
| `firmId` | String | no |  |
| `absenceType` | AbsenceType | no |  |
| `date` | DateTime | no |  |
| `startTime` | DateTime | yes |  |
| `endTime` | DateTime | yes |  |
| `hours` | Decimal | yes | `@db.Decimal(5, 2)` |
| `isJustified` | Boolean | no | default `false` |
| `justification` | String | yes |  |
| `supportingDoc` | String | yes |  |
| `recordedBy` | String | no |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `employee` | `Employee` | one | `employeeId` | Cascade | — |
| `recorder` | `User` | one | `recordedBy` | — | — |

**Constraints:** `@id` on `id`

---

### `Mission` → table `missions`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `requesterId` | String | no |  |
| `title` | String | no |  |
| `destination` | String | no |  |
| `startDate` | DateTime | no |  |
| `endDate` | DateTime | no |  |
| `status` | MissionStatus | no | default `"DRAFT"` |
| `purpose` | String | yes |  |
| `budgetAmount` | Decimal | yes | `@db.Decimal(10, 2)` |
| `actualAmount` | Decimal | yes | `@db.Decimal(10, 2)` |
| `missionFees` | Decimal | yes | `@db.Decimal(10, 2)` |
| `approvedBy` | String | yes |  |
| `approvedAt` | DateTime | yes |  |
| `rejectionReason` | String | yes |  |
| `completedAt` | DateTime | yes |  |
| `report` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `requester` | `Employee` | one | `requesterId` | Cascade | — |
| `approver` | `User` | one? | `approvedBy` | — | — |
| `expenses` | `MissionExpense` | many | — | — | — |

**Constraints:** `@id` on `id`

---

### `MissionExpense` → table `mission_expenses`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `missionId` | String | no |  |
| `category` | ExpenseCategory | no |  |
| `amount` | Decimal | no | `@db.Decimal(10, 2)` |
| `date` | DateTime | no |  |
| `description` | String | yes |  |
| `receiptUrl` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `mission` | `Mission` | one | `missionId` | Cascade | — |

**Constraints:** `@id` on `id`

---

### `PayrollConfig` → table `payroll_configs`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no | unique |
| `constants` | Json | no |  |
| `formulas` | Json | yes |  |
| `currency` | String | no | default `"XOF"` |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |

**Constraints:** `@id` on `id` · `@unique` on `firmId`

---

### `EmployeeSalary` → table `employee_salaries`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `employeeId` | String | no |  |
| `baseSalary` | Decimal | no | `@db.Decimal(10, 2)` |
| `variables` | Json | yes |  |
| `effectiveDate` | DateTime | no |  |
| `endDate` | DateTime | yes |  |
| `notes` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `employee` | `Employee` | one | `employeeId` | Cascade | — |
| `payslips` | `Payslip` | many | — | — | — |

**Constraints:** `@id` on `id`

---

### `Payslip` → table `payslips`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `employeeId` | String | no |  |
| `salaryId` | String | no |  |
| `period` | String | no |  |
| `grossSalary` | Decimal | no | `@db.Decimal(10, 2)` |
| `netSalary` | Decimal | no | `@db.Decimal(10, 2)` |
| `deductions` | Json | no |  |
| `additions` | Json | no |  |
| `calculationData` | Json | no |  |
| `status` | PayslipStatus | no | default `"DRAFT"` |
| `generatedAt` | DateTime | no | default `now()` |
| `approvedBy` | String | yes |  |
| `approvedAt` | DateTime | yes |  |
| `paidAt` | DateTime | yes |  |
| `notes` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `employee` | `Employee` | one | `employeeId` | Cascade | — |
| `salary` | `EmployeeSalary` | one | `salaryId` | Cascade | — |
| `approver` | `User` | one? | `approvedBy` | — | — |

**Constraints:** `@id` on `id` · `@@unique([employeeId, period])`

---

### `Client` → table `clients`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `name` | String | no |  |
| `photoUrl` | String | yes |  |
| `contactName` | String | yes |  |
| `contactEmail` | String | yes |  |
| `contactPhone` | String | yes |  |
| `taxNumber` | String | yes |  |
| `address` | String | yes |  |
| `industry` | String | yes |  |
| `tags` | String[] | no |  |
| `status` | ClientStatus | no | default `"PROSPECT"` |
| `contractStartDate` | DateTime | yes |  |
| `contractEndDate` | DateTime | yes |  |
| `notes` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `firmAssignments` | `ClientFirmAssignment` | many | — | — | — |
| `assignedEmployees` | `Employee` | many | — | — | — |
| `contracts` | `Contract` | many | — | — | — |
| `transfers` | `EmployeeTransfer` | many | — | — | — |
| `quarterlyReports` | `ClientQuarterlyReport` | many | — | — | — |
| `userAssignments` | `UserClientAssignment` | many | — | — | — |

**Constraints:** `@id` on `id`

---

### `UserClientAssignment` → table `user_client_assignments`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `userId` | String | no |  |
| `clientId` | String | no |  |
| `firmId` | String | no |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `user` | `User` | one | `userId` | Cascade | — |
| `client` | `Client` | one | `clientId` | Cascade | — |
| `firm` | `Firm` | one | `firmId` | Cascade | — |

**Constraints:** `@id` on `id` · `@@unique([userId, clientId, firmId])`

---

### `ClientFirmAssignment` → table `client_firm_assignments`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `clientId` | String | no |  |
| `firmId` | String | no |  |
| `startDate` | DateTime | no |  |
| `endDate` | DateTime | yes |  |
| `isActive` | Boolean | no | default `true` |
| `notes` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `client` | `Client` | one | `clientId` | Cascade | — |
| `firm` | `Firm` | one | `firmId` | Cascade | — |

**Constraints:** `@id` on `id` · `@@unique([clientId, firmId])`

---

### `ClientQuarterlyReport` → table `client_quarterly_reports`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `clientId` | String | no |  |
| `quarter` | String | no |  |
| `year` | Int | no |  |
| `quarterNumber` | Int | no |  |
| `employeeCount` | Int | no |  |
| `totalHours` | Decimal | yes | `@db.Decimal(10, 2)` |
| `totalCost` | Decimal | yes | `@db.Decimal(10, 2)` |
| `reportData` | Json | no |  |
| `generatedAt` | DateTime | no | default `now()` |
| `generatedBy` | String | no |  |
| `pdfUrl` | String | yes |  |
| `excelUrl` | String | yes |  |
| `sentAt` | DateTime | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `client` | `Client` | one | `clientId` | Cascade | — |
| `generator` | `User` | one | `generatedBy` | — | — |

**Constraints:** `@id` on `id` · `@@unique([clientId, quarter])`

---

### `Partner` → table `partners`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `type` | PartnerType | no |  |
| `name` | String | no |  |
| `slug` | String | no |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `branches` | `PartnerBranch` | many | — | — | — |
| `agreements` | `PartnerAgreement` | many | — | — | — |
| `preferredEnrollments` | `EmployeeCoverageEnrollment` | many | — | — | — |
| `claims` | `Claim` | many | — | — | — |

**Constraints:** `@id` on `id` · `@@unique([firmId, slug])`

---

### `PartnerBranch` → table `partner_branches`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `partnerId` | String | no |  |
| `name` | String | no |  |
| `address` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `partner` | `Partner` | one | `partnerId` | Cascade | — |

**Constraints:** `@id` on `id`

---

### `PartnerAgreement` → table `partner_agreements`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `partnerId` | String | no |  |
| `firmId` | String | no |  |
| `tariffTable` | Json | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `partner` | `Partner` | one | `partnerId` | Cascade | — |
| `firm` | `Firm` | one | `firmId` | Cascade | — |

**Constraints:** `@id` on `id` · `@@unique([partnerId, firmId])`

---

### `BenefitPlan` → table `benefit_plans`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `name` | String | no |  |
| `code` | String | no |  |
| `coverage` | Json | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `enrollments` | `EmployeeCoverageEnrollment` | many | — | — | — |
| `contributions` | `Contribution` | many | — | — | — |

**Constraints:** `@id` on `id` · `@@unique([firmId, code])`

---

### `EmployeeCoverageEnrollment` → table `employee_coverage_enrollments`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `employeeId` | String | no |  |
| `planId` | String | no |  |
| `preferredPartnerId` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `employee` | `Employee` | one | `employeeId` | Cascade | — |
| `plan` | `BenefitPlan` | one | `planId` | Cascade | — |
| `preferredPartner` | `Partner` | one? | `preferredPartnerId` | — | — |

**Constraints:** `@id` on `id` · `@@unique([employeeId, planId])`

---

### `Contribution` → table `contributions`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `employeeId` | String | no |  |
| `planId` | String | no |  |
| `period` | String | no |  |
| `amount` | Decimal | no | `@db.Decimal(10, 2)` |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `employee` | `Employee` | one | `employeeId` | Cascade | — |
| `plan` | `BenefitPlan` | one | `planId` | Cascade | — |

**Constraints:** `@id` on `id`

---

### `Claim` → table `claims`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `employeeId` | String | no |  |
| `partnerId` | String | yes |  |
| `amount` | Decimal | no | `@db.Decimal(10, 2)` |
| `status` | ClaimStatus | no | default `"SUBMITTED"` |
| `dateOfService` | DateTime | no |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `employee` | `Employee` | one | `employeeId` | Cascade | — |
| `partner` | `Partner` | one? | `partnerId` | — | — |

**Constraints:** `@id` on `id`

---

### `FileObject` → table `file_objects`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `entity` | FileEntity | no |  |
| `entityId` | String | no |  |
| `documentType` | DocumentType | no |  |
| `fileName` | String | no |  |
| `storageKey` | String | no |  |
| `fileSize` | Int | yes |  |
| `mimeType` | String | yes |  |
| `uploadedBy` | String | no |  |
| `description` | String | yes |  |
| `expiryDate` | DateTime | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `uploader` | `User` | one | `uploadedBy` | — | — |

**Constraints:** `@id` on `id`

---

### `EmployeeDocument` → table `employee_documents`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `employeeId` | String | no |  |
| `firmId` | String | no |  |
| `documentType` | DocumentType | no |  |
| `fileName` | String | no |  |
| `storageKey` | String | no |  |
| `fileUrl` | String | yes |  |
| `fileSize` | Int | yes |  |
| `mimeType` | String | yes |  |
| `uploadedBy` | String | no |  |
| `description` | String | yes |  |
| `tags` | String[] | no | default `undefined()` |
| `metadata` | Json | yes |  |
| `expiryDate` | DateTime | yes |  |
| `isVerified` | Boolean | no | default `false` |
| `verifiedBy` | String | yes |  |
| `verifiedAt` | DateTime | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `employee` | `Employee` | one | `employeeId` | Cascade | — |
| `uploader` | `User` | one | `uploadedBy` | — | `DocumentUploader` |
| `verifier` | `User` | one? | `verifiedBy` | — | `DocumentVerifier` |

**Constraints:** `@id` on `id`

---

### `DashboardView` → table `dashboard_views`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `userId` | String | no |  |
| `name` | String | no |  |
| `config` | Json | no |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `user` | `User` | one | `userId` | Cascade | — |

**Constraints:** `@id` on `id`

---

### `AuditLog` → table `audit_logs`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | yes |  |
| `actorId` | String | no |  |
| `action` | String | no |  |
| `entity` | String | no |  |
| `entityId` | String | no |  |
| `metadata` | Json | yes |  |
| `createdAt` | DateTime | no | default `now()` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one? | `firmId` | Cascade | — |
| `actor` | `User` | one | `actorId` | — | — |

**Constraints:** `@id` on `id`

---
