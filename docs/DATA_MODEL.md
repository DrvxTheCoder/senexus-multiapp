# Data model

Authoritative dictionary for the Senexus database. Where this document and `prisma/schema.prisma`
disagree, the schema wins.

- **Source:** `prisma/schema.prisma`, originally byte-for-byte `senexus-hr/prisma/schema.prisma`
  (sha256 `86188a02…`, 29 057 bytes), plus one approved additive change
  (sha256 `fc5be73a508557560019a15fdd07c105ba4733160880e8bc2321ab687917a72f`, 29 821 bytes, CRLF).
- **The one change so far:** `Contract.contractDocumentId` — nullable, `ON DELETE SET NULL`, indexed.
  Invisible to the legacy application, which does not read it. Q20 in `OPEN_QUESTIONS.md` carries the
  SQL for the live database; it has **not** been applied there.
- **Shape:** 37 models, 17 enums, 2 composite primary keys, 14 composite uniques, **1 declared index**
  (the one above; every other index in the database is implicit, from a primary key or a unique).
- **Generated section:** everything under "Model reference" is emitted from the Prisma DMMF by
  `scripts/gen-data-model.mjs`, not transcribed by hand. Re-run it after any schema change.
- `prisma generate`, and `db push` for an approved additive change. No migration has been or will be
  run from this project.

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
not a single secondary index there. The schema now declares exactly one `@@index`, on
`contracts.contractDocumentId`, added with that column and present in the local database only —
see Q20. PostgreSQL does not index foreign keys automatically, so these hot columns are still
unindexed:

`contracts.firmId`, `contracts.employeeId`, `contracts.clientId`, `contracts.renewedFromId`,
`contracts.endDate`, `employees.assignedClientId`, `employees.departmentId`, `employees.status`,
`leave_requests.firmId`, `leave_requests.employeeId`, `employee_documents.employeeId`,
`file_objects.(firmId, entity, entityId)`, `employee_transfers.employeeId`, `audit_logs.firmId`,
`clients.firmId`.

`employees.firmId` is the one exception: it leads `employees_firmId_matricule_key`, so firm-scoped
employee scans can use that index.

Nothing else is applied. Candidates go to `docs/PROPOSED_INDEXES.sql` with the query each serves and
a measured cost, once there is production-shaped data to measure against.

---

## Model reference

## Enums

| Enum | Values |
| --- | --- |
| `FirmRole` | `OWNER` · `ADMIN` · `MANAGER` · `STAFF` · `VIEWER` · `RESPONSABLE` |
| `EmployeeStatus` | `ACTIVE` · `INACTIVE` · `SUSPENDED` · `TERMINATED` · `ON_LEAVE` |
| `Gender` | `MALE` · `FEMALE` · `OTHER` |
| `ContractType` | `CDI` · `CDD` · `STAGE` · `PRESTATION` · `INTERIM` |
| `ContractStatus` | `ACTIVE` · `EXPIRED` · `TERMINATED` · `RENEWED` |
| `TransferStatus` | `PENDING` · `APPROVED` · `REJECTED` · `COMPLETED` · `CANCELLED` |
| `LeaveType` | `ANNUAL` · `SICK` · `MATERNITY` · `PATERNITY` · `UNPAID` · `SPECIAL` · `COMPENSATORY` |
| `LeaveStatus` | `PENDING` · `APPROVED` · `REJECTED` · `CANCELLED` |
| `AbsenceType` | `UNJUSTIFIED` · `JUSTIFIED` · `LATE_ARRIVAL` · `EARLY_DEPARTURE` |
| `MissionStatus` | `DRAFT` · `SUBMITTED` · `APPROVED` · `REJECTED` · `COMPLETED` · `CANCELLED` · `IN_PROGRESS` |
| `ExpenseCategory` | `TRANSPORT` · `ACCOMMODATION` · `MEALS` · `FUEL` · `OTHER` |
| `PayslipStatus` | `DRAFT` · `APPROVED` · `PAID` · `CANCELLED` |
| `ClientStatus` | `ACTIVE` · `INACTIVE` · `PROSPECT` · `ARCHIVED` |
| `DocumentType` | `CV` · `ID_CARD` · `PASSPORT` · `CONTRACT` · `PAYSLIP` · `CERTIFICATE` · `DIPLOMA` · `MEDICAL_CERTIFICATE` · `LEGAL_DOCUMENT` · `MISSION_REPORT` · `EXPENSE_RECEIPT` · `OTHER` |
| `FileEntity` | `EMPLOYEE` · `CLIENT` · `CONTRACT` · `MISSION` · `LEAVE_REQUEST` · `CLAIM` |
| `IpmBeneficiaryType` | `ALL` · `MEMBER` · `SPOUSE_F` · `CHILD` · `SPOUSE_M` · `ASCENDANT` · `OTHER` |
| `IpmEmployerStatus` | `ACTIVE` · `SUSPENDED` · `TERMINATED` |
| `IpmMemberStatus` | `PENDING` · `ACTIVE` · `SUSPENDED` · `TERMINATED` |
| `IpmDependentStatus` | `ACTIVE` · `SUSPENDED` · `TERMINATED` |
| `IpmDependentRelation` | `SPOUSE_F` · `CHILD` · `SPOUSE_M` · `ASCENDANT` · `OTHER` |
| `IpmProviderStatus` | `ACTIVE` · `SUSPENDED` · `TERMINATED` |
| `IpmAgreementStatus` | `DRAFT` · `ACTIVE` · `EXPIRED` · `TERMINATED` |
| `IpmVoucherType` | `PHARMACY` · `OPTICAL` · `GUARANTEE` · `HOSPITALIZATION` |
| `IpmVoucherStatus` | `PENDING_REVIEW` · `ISSUED` · `PRESENTED` · `SETTLED` · `INVOICED` · `CANCELLED` · `EXPIRED` · `REJECTED` |
| `IpmVoucherOrigin` | `BACKOFFICE` · `PORTAL` |
| `IpmVoucherEntryMode` | `SCAN` · `MANUAL` |
| `IpmReviewFlag` | `ABOVE_THRESHOLD` · `AMOUNT_UNUSUAL` · `SAME_DAY_DUPLICATE` · `RECEIPT_REUSED` · `OCR_MISMATCH` · `ISSUANCE_WARNING` |
| `IpmLedgerType` | `OPENING` · `CONTRIBUTION` · `CONSUMPTION` · `ADJUSTMENT` · `REVERSAL` |
| `IpmLedgerSource` | `OPENING` · `INVOICE` · `VOUCHER` · `REIMBURSEMENT` · `MANUAL` |
| `IpmEmployerInvoiceStatus` | `DRAFT` · `ISSUED` · `PARTIALLY_PAID` · `PAID` · `OVERDUE` · `CANCELLED` |
| `IpmInvoiceOrigin` | `RECEIVED` · `GENERATED` |
| `IpmProviderInvoiceStatus` | `RECEIVED` · `CHECKED` · `APPROVED` · `PAID` · `REJECTED` |
| `IpmReimbursementStatus` | `SUBMITTED` · `REVIEWING` · `APPROVED` · `REJECTED` · `PAID` |
| `IpmDisbursementStatus` | `DRAFT` · `APPROVED` · `POSTED` · `PAID` · `CANCELLED` |
| `IpmPayeeType` | `PROVIDER` · `MEMBER` · `SUPPLIER` |
| `IpmPaymentMethod` | `CHEQUE` · `TRANSFER` · `CASH` · `ORANGE_MONEY` |
| `PortalAccountStatus` | `INVITED` · `ACTIVE` · `LOCKED` |
| `PortalNotificationKind` | `VOUCHER_APPROVED` · `VOUCHER_REJECTED` |

## Models

### `User` → table `users`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `name` | String | yes |  |
| `email` | String | no | unique |
| `emailVerified` | DateTime | yes |  |
| `image` | String | yes |  |
| `signatureUrl` | String | yes |  |
| `passwordHash` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `recordedAbsences` | `Absence` | many | — | — | — |
| `accounts` | `Account` | many | — | — | — |
| `auditLogs` | `AuditLog` | many | — | — | — |
| `generatedReports` | `ClientQuarterlyReport` | many | — | — | — |
| `dashboards` | `DashboardView` | many | — | — | — |
| `uploadedDocuments` | `EmployeeDocument` | many | — | — | `DocumentUploader` |
| `verifiedDocuments` | `EmployeeDocument` | many | — | — | `DocumentVerifier` |
| `approvedTransfers` | `EmployeeTransfer` | many | — | — | `TransferApprover` |
| `requestedTransfers` | `EmployeeTransfer` | many | — | — | `TransferRequester` |
| `employees` | `Employee` | many | — | — | — |
| `reviewedLeaves` | `LeaveRequest` | many | — | — | — |
| `approvedMissions` | `Mission` | many | — | — | — |
| `approvedPayslips` | `Payslip` | many | — | — | — |
| `sessions` | `Session` | many | — | — | — |
| `clientAssignments` | `UserClientAssignment` | many | — | — | — |
| `userFirms` | `UserFirm` | many | — | — | — |
| `ipmContributions` | `IpmMemberContribution` | many | — | — | `IpmContributionAuthor` |
| `ipmCards` | `IpmMemberCard` | many | — | — | `IpmCardAuthor` |
| `ipmVouchersIssued` | `IpmVoucher` | many | — | — | `IpmVoucherIssuer` |
| `ipmVouchersSettled` | `IpmVoucher` | many | — | — | `IpmVoucherSettler` |
| `ipmLedgerEntries` | `IpmLedgerEntry` | many | — | — | `IpmLedgerAuthor` |
| `ipmInvoiceStatuses` | `IpmEmployerInvoice` | many | — | — | `IpmInvoiceStatusAuthor` |
| `ipmInvoicesChecked` | `IpmProviderInvoice` | many | — | — | `IpmProviderInvoiceChecker` |
| `ipmReimbReviewed` | `IpmReimbursement` | many | — | — | `IpmReimbursementReviewer` |
| `ipmDisbEntered` | `IpmDisbursement` | many | — | — | `IpmDisbursementAuthor` |
| `ipmDisbApproved` | `IpmDisbursement` | many | — | — | `IpmDisbursementApprover` |
| `ipmDisbAccounting` | `IpmDisbursement` | many | — | — | `IpmDisbursementAccountant` |
| `ipmVouchersReviewed` | `IpmVoucher` | many | — | — | `IpmVoucherReviewer` |
| `ipmCeilingsAuthored` | `IpmMemberCeiling` | many | — | — | `IpmMemberCeilingAuthor` |

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
| `persons` | `Person` | many | — | — | — |
| `organizations` | `Organization` | many | — | — | — |

**Constraints:** `@id` on `id`

---

### `Firm` → table `firms`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `holdingId` | String | no |  |
| `name` | String | no |  |
| `slug` | String | no | unique |
| `themeColor` | String | yes |  |
| `letterhead` | String | yes |  |
| `stamp` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |
| `logo` | String | yes |  |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `auditLogs` | `AuditLog` | many | — | — | — |
| `clientAssignments` | `ClientFirmAssignment` | many | — | — | — |
| `clientReports` | `ClientQuarterlyReport` | many | — | — | — |
| `clients` | `Client` | many | — | — | — |
| `clientFirmContracts` | `Contract` | many | — | — | `ClientFirmContracts` |
| `contracts` | `Contract` | many | — | — | — |
| `dashboards` | `DashboardView` | many | — | — | — |
| `departments` | `Department` | many | — | — | — |
| `transfersOut` | `EmployeeTransfer` | many | — | — | `TransfersOut` |
| `transfersIn` | `EmployeeTransfer` | many | — | — | `TransfersIn` |
| `employees` | `Employee` | many | — | — | — |
| `firmModules` | `FirmModule` | many | — | — | — |
| `holding` | `Holding` | one | `holdingId` | Cascade | — |
| `leaveRequests` | `LeaveRequest` | many | — | — | — |
| `missions` | `Mission` | many | — | — | — |
| `payrollConfig` | `PayrollConfig` | one? | — | — | — |
| `payslips` | `Payslip` | many | — | — | — |
| `userClientAssignments` | `UserClientAssignment` | many | — | — | — |
| `userFirms` | `UserFirm` | many | — | — | — |
| `ipmServiceCategories` | `IpmServiceCategory` | many | — | — | — |
| `ipmServiceTypes` | `IpmServiceType` | many | — | — | — |
| `ipmProviderSpecialties` | `IpmProviderSpecialty` | many | — | — | — |
| `ipmMedicalActs` | `IpmMedicalAct` | many | — | — | — |
| `ipmPlans` | `IpmPlan` | many | — | — | — |
| `ipmPlanRates` | `IpmPlanRate` | many | — | — | — |
| `ipmEmployerRates` | `IpmEmployerRate` | many | — | — | — |
| `ipmEmployers` | `IpmEmployer` | many | — | — | — |
| `ipmMembers` | `Member` | many | — | — | — |
| `ipmDependents` | `Dependent` | many | — | — | — |
| `ipmContributions` | `IpmMemberContribution` | many | — | — | — |
| `ipmCards` | `IpmMemberCard` | many | — | — | — |
| `ipmProviders` | `IpmProvider` | many | — | — | — |
| `ipmProviderBranches` | `IpmProviderBranch` | many | — | — | — |
| `ipmAgreements` | `IpmAgreement` | many | — | — | — |
| `ipmVouchers` | `IpmVoucher` | many | — | — | — |
| `ipmVoucherLines` | `IpmVoucherLine` | many | — | — | — |
| `ipmConsumptions` | `IpmConsumption` | many | — | — | — |
| `ipmSequences` | `IpmSequence` | many | — | — | — |
| `ipmLedgerEntries` | `IpmLedgerEntry` | many | — | — | — |
| `ipmEmployerInvoices` | `IpmEmployerInvoice` | many | — | — | — |
| `ipmInvoiceLines` | `IpmEmployerInvoiceLine` | many | — | — | — |
| `ipmProviderInvoices` | `IpmProviderInvoice` | many | — | — | — |
| `ipmProviderInvoiceLines` | `IpmProviderInvoiceLine` | many | — | — | — |
| `ipmReimbursements` | `IpmReimbursement` | many | — | — | — |
| `ipmDisbursements` | `IpmDisbursement` | many | — | — | — |
| `ipmDisbursementLines` | `IpmDisbursementLine` | many | — | — | — |
| `portalAccounts` | `PortalAccount` | many | — | — | — |
| `ipmPortalSettings` | `IpmPortalSettings` | one? | — | — | — |
| `portalNotifications` | `PortalNotification` | many | — | — | — |
| `ipmPortalBookings` | `IpmPortalBooking` | many | — | — | — |
| `ipmMemberCeilings` | `IpmMemberCeiling` | many | — | — | — |

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
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `user` | `User` | one | `userId` | Cascade | — |

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
| `requiredBy` | `ModuleDependency` | many | — | — | `RequiredBy` |
| `dependencies` | `ModuleDependency` | many | — | — | `ModuleDeps` |

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
| `dependsOn` | `Module` | one | `dependsOnId` | Cascade | `RequiredBy` |
| `module` | `Module` | one | `moduleId` | Cascade | `ModuleDeps` |

**Constraints:** `@id` on `id` · `@@unique([moduleId, dependsOnId])`

---

### `Department` → table `departments`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `name` | String | no |  |
| `code` | String | no |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |
| `managerId` | String | yes |  |

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
| `departmentId` | String | yes |  |
| `status` | EmployeeStatus | no | default `"ACTIVE"` |
| `hireDate` | DateTime | no |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |
| `address` | String | yes |  |
| `assignedClientId` | String | yes |  |
| `email` | String | yes |  |
| `emergencyContact` | Json | yes |  |
| `phone` | String | yes |  |
| `category` | String | yes |  |
| `cni` | String | yes |  |
| `contractEndDate` | DateTime | yes |  |
| `dateOfBirth` | DateTime | yes |  |
| `fatherName` | String | yes |  |
| `gender` | Gender | yes |  |
| `jobTitle` | String | yes |  |
| `maritalStatus` | String | yes |  |
| `motherName` | String | yes |  |
| `nationality` | String | yes |  |
| `netSalary` | Decimal | yes | `@db.Decimal(10, 2)` |
| `photoUrl` | String | yes |  |
| `placeOfBirth` | String | yes |  |
| `personId` | String | yes |  |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `absences` | `Absence` | many | — | — | — |
| `contracts` | `Contract` | many | — | — | — |
| `managedDepartments` | `Department` | many | — | — | `DepartmentManager` |
| `documents` | `EmployeeDocument` | many | — | — | — |
| `salaries` | `EmployeeSalary` | many | — | — | — |
| `transfersOut` | `EmployeeTransfer` | many | — | — | `TransferFrom` |
| `assignedClient` | `Client` | one? | `assignedClientId` | — | — |
| `department` | `Department` | one? | `departmentId` | — | `DepartmentEmployees` |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `user` | `User` | one? | `userId` | — | — |
| `leaveBalances` | `LeaveBalance` | many | — | — | — |
| `leaveRequests` | `LeaveRequest` | many | — | — | — |
| `requestedMissions` | `Mission` | many | — | — | — |
| `payslips` | `Payslip` | many | — | — | — |
| `person` | `Person` | one? | `personId` | — | — |
| `ipmMembers` | `Member` | many | — | — | — |

**Constraints:** `@id` on `id` · `@@unique([firmId, matricule])`

---

### `Contract` → table `contracts`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `employeeId` | String | no |  |
| `type` | ContractType | no |  |
| `startDate` | DateTime | no |  |
| `endDate` | DateTime | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |
| `alertThreshold` | Int | no | default `30` |
| `clientId` | String | yes |  |
| `isActive` | Boolean | no | default `true` |
| `isAutoRenewal` | Boolean | no | default `false` |
| `notes` | String | yes |  |
| `position` | String | yes |  |
| `renewalDate` | DateTime | yes |  |
| `salary` | Decimal | yes | `@db.Decimal(10, 2)` |
| `terminationDate` | DateTime | yes |  |
| `terminationReason` | String | yes |  |
| `trialPeriodEnd` | DateTime | yes |  |
| `workingHours` | Int | yes |  |
| `clientFirmId` | String | yes |  |
| `renewedFromId` | String | yes |  |
| `status` | ContractStatus | no | default `"ACTIVE"` |
| `isVise` | Boolean | no | default `false` |
| `contractDocumentId` | String | yes |  |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `clientFirm` | `Firm` | one? | `clientFirmId` | — | `ClientFirmContracts` |
| `client` | `Client` | one? | `clientId` | — | — |
| `contractDocument` | `EmployeeDocument` | one? | `contractDocumentId` | — | `ContractSignedDocument` |
| `employee` | `Employee` | one | `employeeId` | Cascade | — |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `renewedFrom` | `Contract` | one? | `renewedFromId` | — | `ContractRenewal` |
| `renewals` | `Contract` | many | — | — | `ContractRenewal` |

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
| `requestedBy` | String | no |  |
| `approvedBy` | String | yes |  |
| `approvedAt` | DateTime | yes |  |
| `rejectionReason` | String | yes |  |
| `notes` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |
| `newMatricule` | String | yes |  |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `approver` | `User` | one? | `approvedBy` | — | `TransferApprover` |
| `client` | `Client` | one? | `clientId` | — | — |
| `employee` | `Employee` | one | `employeeId` | — | `TransferFrom` |
| `fromFirm` | `Firm` | one | `fromFirmId` | — | `TransfersOut` |
| `requester` | `User` | one | `requestedBy` | — | `TransferRequester` |
| `toFirm` | `Firm` | one | `toFirmId` | — | `TransfersIn` |

**Constraints:** `@id` on `id`

---

### `LeaveRequest` → table `leave_requests`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `employeeId` | String | no |  |
| `startDate` | DateTime | no |  |
| `endDate` | DateTime | no |  |
| `status` | LeaveStatus | no | default `"PENDING"` |
| `reason` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |
| `isJustified` | Boolean | no | default `false` |
| `isPaid` | Boolean | no | default `true` |
| `justification` | String | yes |  |
| `leaveType` | LeaveType | no |  |
| `rejectionReason` | String | yes |  |
| `requestedAt` | DateTime | no | default `now()` |
| `reviewedAt` | DateTime | yes |  |
| `reviewedBy` | String | yes |  |
| `supportingDoc` | String | yes |  |
| `totalDays` | Decimal | no | `@db.Decimal(5, 2)` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `employee` | `Employee` | one | `employeeId` | Cascade | — |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
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
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |
| `actualAmount` | Decimal | yes | `@db.Decimal(10, 2)` |
| `approvedAt` | DateTime | yes |  |
| `approvedBy` | String | yes |  |
| `budgetAmount` | Decimal | yes | `@db.Decimal(10, 2)` |
| `completedAt` | DateTime | yes |  |
| `missionFees` | Decimal | yes | `@db.Decimal(10, 2)` |
| `rejectionReason` | String | yes |  |
| `report` | String | yes |  |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `expenses` | `MissionExpense` | many | — | — | — |
| `approver` | `User` | one? | `approvedBy` | — | — |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `requester` | `Employee` | one | `requesterId` | Cascade | — |

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
| `approver` | `User` | one? | `approvedBy` | — | — |
| `employee` | `Employee` | one | `employeeId` | Cascade | — |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `salary` | `EmployeeSalary` | one | `salaryId` | Cascade | — |

**Constraints:** `@id` on `id` · `@@unique([employeeId, period])`

---

### `Client` → table `clients`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `name` | String | no |  |
| `contactName` | String | yes |  |
| `taxNumber` | String | yes |  |
| `address` | String | yes |  |
| `tags` | String[] | no |  |
| `status` | ClientStatus | no | default `"PROSPECT"` |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |
| `contactEmail` | String | yes |  |
| `contactPhone` | String | yes |  |
| `contractEndDate` | DateTime | yes |  |
| `contractStartDate` | DateTime | yes |  |
| `industry` | String | yes |  |
| `notes` | String | yes |  |
| `photoUrl` | String | yes |  |
| `organizationId` | String | yes |  |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firmAssignments` | `ClientFirmAssignment` | many | — | — | — |
| `quarterlyReports` | `ClientQuarterlyReport` | many | — | — | — |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `contracts` | `Contract` | many | — | — | — |
| `transfers` | `EmployeeTransfer` | many | — | — | — |
| `assignedEmployees` | `Employee` | many | — | — | — |
| `userAssignments` | `UserClientAssignment` | many | — | — | — |
| `organization` | `Organization` | one? | `organizationId` | — | — |

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
| `client` | `Client` | one | `clientId` | Cascade | — |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `user` | `User` | one | `userId` | Cascade | — |

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
| `client` | `Client` | one | `clientId` | Cascade | — |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `generator` | `User` | one | `generatedBy` | — | — |

**Constraints:** `@id` on `id` · `@@unique([clientId, quarter])`

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
| `expiryDate` | DateTime | yes |  |
| `isVerified` | Boolean | no | default `false` |
| `verifiedBy` | String | yes |  |
| `verifiedAt` | DateTime | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |
| `metadata` | Json | yes |  |
| `tags` | String[] | no | default `undefined()` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `signedContracts` | `Contract` | many | — | — | `ContractSignedDocument` |
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
| `actor` | `User` | one | `actorId` | — | — |
| `firm` | `Firm` | one? | `firmId` | Cascade | — |

**Constraints:** `@id` on `id`

---

### `Person` → table `persons`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `holdingId` | String | no |  |
| `firstName` | String | no |  |
| `lastName` | String | no |  |
| `birthDate` | DateTime | yes |  |
| `birthPlace` | String | yes |  |
| `gender` | Gender | yes |  |
| `nationalId` | String | yes |  |
| `passportNo` | String | yes |  |
| `phone` | String | yes |  |
| `email` | String | yes |  |
| `address` | String | yes |  |
| `photoUrl` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `holding` | `Holding` | one | `holdingId` | Cascade | — |
| `employees` | `Employee` | many | — | — | — |
| `members` | `Member` | many | — | — | — |
| `dependents` | `Dependent` | many | — | — | — |

**Constraints:** `@id` on `id` · `@@unique([holdingId, nationalId])`

---

### `Organization` → table `organizations`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `holdingId` | String | no |  |
| `name` | String | no |  |
| `ninea` | String | yes |  |
| `sector` | String | yes |  |
| `address` | String | yes |  |
| `phone` | String | yes |  |
| `email` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `holding` | `Holding` | one | `holdingId` | Cascade | — |
| `clients` | `Client` | many | — | — | — |
| `employers` | `IpmEmployer` | many | — | — | — |
| `providers` | `IpmProvider` | many | — | — | — |

**Constraints:** `@id` on `id` · `@@unique([holdingId, ninea])`

---

### `IpmServiceCategory` → table `ipm_service_categories`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `code` | String | no |  |
| `label` | String | no |  |
| `sortOrder` | Int | no | default `0` |
| `active` | Boolean | no | default `true` |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |
| `currentBalance` | Decimal | no | default `0`, `@db.Decimal(14, 2)` |
| `balanceAsOf` | DateTime | yes |  |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `serviceTypes` | `IpmServiceType` | many | — | — | — |
| `planRates` | `IpmPlanRate` | many | — | — | — |
| `employerRates` | `IpmEmployerRate` | many | — | — | — |
| `vouchers` | `IpmVoucher` | many | — | — | — |
| `consumptions` | `IpmConsumption` | many | — | — | — |
| `ledgerEntries` | `IpmLedgerEntry` | many | — | — | — |
| `invoiceLines` | `IpmEmployerInvoiceLine` | many | — | — | — |
| `ipmReimbursements` | `IpmReimbursement` | many | — | — | — |
| `memberCeilings` | `IpmMemberCeiling` | many | — | — | — |

**Constraints:** `@id` on `id` · `@@unique([firmId, code])`

---

### `IpmServiceType` → table `ipm_service_types`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `categoryId` | String | no |  |
| `code` | String | no |  |
| `label` | String | no |  |
| `accountCode` | String | yes |  |
| `legacyCode` | String | yes |  |
| `active` | Boolean | no | default `true` |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `category` | `IpmServiceCategory` | one | `categoryId` | — | — |
| `medicalActs` | `IpmMedicalAct` | many | — | — | — |
| `vouchers` | `IpmVoucher` | many | — | — | — |
| `portalBookings` | `IpmPortalBooking` | many | — | — | — |

**Constraints:** `@id` on `id` · `@@unique([firmId, code])`

---

### `IpmProviderSpecialty` → table `ipm_provider_specialties`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `code` | String | no |  |
| `label` | String | no |  |
| `accountCode` | String | yes |  |
| `legacyCode` | String | yes |  |
| `active` | Boolean | no | default `true` |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `providers` | `IpmProvider` | many | — | — | — |
| `portalBookings` | `IpmPortalBooking` | many | — | — | — |

**Constraints:** `@id` on `id` · `@@unique([firmId, code])`

---

### `IpmMedicalAct` → table `ipm_medical_acts`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `serviceTypeId` | String | no |  |
| `code` | String | no |  |
| `label` | String | no |  |
| `coefficient` | Decimal | yes | `@db.Decimal(8, 2)` |
| `tariff` | Decimal | yes | `@db.Decimal(12, 2)` |
| `active` | Boolean | no | default `true` |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `serviceType` | `IpmServiceType` | one | `serviceTypeId` | — | — |
| `voucherLines` | `IpmVoucherLine` | many | — | — | — |

**Constraints:** `@id` on `id` · `@@unique([firmId, code])`

---

### `IpmPlan` → table `ipm_plans`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `code` | String | no |  |
| `name` | String | no |  |
| `monthlyPrice` | Decimal | no | `@db.Decimal(12, 2)` |
| `validFrom` | DateTime | no |  |
| `validTo` | DateTime | yes |  |
| `active` | Boolean | no | default `true` |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `rates` | `IpmPlanRate` | many | — | — | — |
| `employers` | `IpmEmployer` | many | — | — | — |
| `contributions` | `IpmMemberContribution` | many | — | — | — |

**Constraints:** `@id` on `id` · `@@unique([firmId, code, validFrom])`

---

### `IpmPlanRate` → table `ipm_plan_rates`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `planId` | String | no |  |
| `categoryId` | String | no |  |
| `beneficiaryType` | IpmBeneficiaryType | no | default `"ALL"` |
| `rate` | Decimal | no | `@db.Decimal(5, 4)` |
| `ceilingPerAct` | Decimal | yes | `@db.Decimal(12, 2)` |
| `ceilingMonthly` | Decimal | yes | `@db.Decimal(12, 2)` |
| `ceilingAnnual` | Decimal | yes | `@db.Decimal(12, 2)` |
| `waitingPeriodDays` | Int | no | default `0` |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `plan` | `IpmPlan` | one | `planId` | Cascade | — |
| `category` | `IpmServiceCategory` | one | `categoryId` | — | — |

**Constraints:** `@id` on `id` · `@@unique([planId, categoryId, beneficiaryType])`

---

### `IpmEmployerRate` → table `ipm_employer_rates`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `employerId` | String | no |  |
| `categoryId` | String | no |  |
| `beneficiaryType` | IpmBeneficiaryType | no | default `"ALL"` |
| `rate` | Decimal | no | `@db.Decimal(5, 4)` |
| `ceilingPerAct` | Decimal | yes | `@db.Decimal(12, 2)` |
| `ceilingMonthly` | Decimal | yes | `@db.Decimal(12, 2)` |
| `ceilingAnnual` | Decimal | yes | `@db.Decimal(12, 2)` |
| `waitingPeriodDays` | Int | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `employer` | `IpmEmployer` | one | `employerId` | Cascade | — |
| `category` | `IpmServiceCategory` | one | `categoryId` | — | — |

**Constraints:** `@id` on `id` · `@@unique([employerId, categoryId, beneficiaryType])`

---

### `IpmEmployer` → table `ipm_employers`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `organizationId` | String | no |  |
| `legacyCode` | String | yes |  |
| `legacyEmployerCode` | String | yes |  |
| `matriculePrefix` | String | yes |  |
| `planId` | String | yes |  |
| `accountCode` | String | yes |  |
| `affiliationDate` | DateTime | no |  |
| `terminationDate` | DateTime | yes |  |
| `status` | IpmEmployerStatus | no | default `"ACTIVE"` |
| `ageMajority` | Int | no | default `21` |
| `ageRetirement` | Int | no | default `60` |
| `contributionEmployerAmount` | Decimal | yes | `@db.Decimal(12, 2)` |
| `contributionEmployeeAmount` | Decimal | yes | `@db.Decimal(12, 2)` |
| `contributionRate` | Decimal | yes | `@db.Decimal(5, 4)` |
| `reminderDelayDays` | Int | no | default `15` |
| `suspensionDelayDays` | Int | no | default `90` |
| `consumptionCeiling` | Decimal | yes | `@db.Decimal(14, 2)` |
| `debtCeiling` | Decimal | yes | `@db.Decimal(14, 2)` |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `organization` | `Organization` | one | `organizationId` | — | — |
| `plan` | `IpmPlan` | one? | `planId` | — | — |
| `members` | `Member` | many | — | — | — |
| `rates` | `IpmEmployerRate` | many | — | — | — |
| `invoices` | `IpmEmployerInvoice` | many | — | — | — |

**Constraints:** `@id` on `id` · `@@unique([firmId, organizationId])` · `@@unique([firmId, legacyEmployerCode])` · `@@unique([firmId, legacyCode])`

---

### `Member` → table `ipm_members`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `personId` | String | no |  |
| `employerId` | String | no |  |
| `employeeId` | String | yes |  |
| `matricule` | String | no |  |
| `legacyCode` | String | yes |  |
| `jobTitle` | String | yes |  |
| `affiliationDate` | DateTime | no |  |
| `terminationDate` | DateTime | yes |  |
| `status` | IpmMemberStatus | no | default `"PENDING"` |
| `currentBalance` | Decimal | no | default `0`, `@db.Decimal(14, 2)` |
| `balanceAsOf` | DateTime | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `person` | `Person` | one | `personId` | — | — |
| `employer` | `IpmEmployer` | one | `employerId` | — | — |
| `employee` | `Employee` | one? | `employeeId` | — | — |
| `dependents` | `Dependent` | many | — | — | — |
| `contributions` | `IpmMemberContribution` | many | — | — | — |
| `card` | `IpmMemberCard` | one? | — | — | — |
| `vouchers` | `IpmVoucher` | many | — | — | — |
| `consumptions` | `IpmConsumption` | many | — | — | — |
| `ledgerEntries` | `IpmLedgerEntry` | many | — | — | — |
| `invoiceLines` | `IpmEmployerInvoiceLine` | many | — | — | — |
| `reimbursements` | `IpmReimbursement` | many | — | — | — |
| `portalAccount` | `PortalAccount` | one? | — | — | — |
| `ceilings` | `IpmMemberCeiling` | many | — | — | — |

**Constraints:** `@id` on `id` · `@@unique([firmId, matricule])` · `@@unique([firmId, legacyCode])`

---

### `Dependent` → table `ipm_dependents`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `memberId` | String | no |  |
| `personId` | String | no |  |
| `matricule` | String | no |  |
| `legacyCode` | String | yes |  |
| `relation` | IpmDependentRelation | no |  |
| `rank` | Int | no |  |
| `marriageDate` | DateTime | yes |  |
| `coverageStart` | DateTime | no |  |
| `coverageEnd` | DateTime | yes |  |
| `status` | IpmDependentStatus | no | default `"ACTIVE"` |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `member` | `Member` | one | `memberId` | Cascade | — |
| `person` | `Person` | one | `personId` | — | — |
| `vouchers` | `IpmVoucher` | many | — | — | — |
| `ipmReimbursements` | `IpmReimbursement` | many | — | — | — |

**Constraints:** `@id` on `id` · `@@unique([firmId, matricule])` · `@@unique([memberId, rank])`

---

### `IpmMemberContribution` → table `ipm_member_contributions`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `memberId` | String | no |  |
| `planId` | String | yes |  |
| `monthlyAmount` | Decimal | no | `@db.Decimal(12, 2)` |
| `employerAmount` | Decimal | yes | `@db.Decimal(12, 2)` |
| `employeeAmount` | Decimal | yes | `@db.Decimal(12, 2)` |
| `validFrom` | DateTime | no |  |
| `validTo` | DateTime | yes |  |
| `reason` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `createdById` | String | yes |  |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `member` | `Member` | one | `memberId` | Cascade | — |
| `plan` | `IpmPlan` | one? | `planId` | — | — |
| `createdBy` | `User` | one? | `createdById` | — | `IpmContributionAuthor` |

**Constraints:** `@id` on `id`

---

### `IpmMemberCard` → table `ipm_member_cards`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `memberId` | String | no | unique |
| `version` | Int | no | default `1` |
| `inputsHash` | String | no |  |
| `ppi` | Int | no | default `300` |
| `generatedAt` | DateTime | no | default `now()` |
| `generatedById` | String | yes |  |
| `revokedAt` | DateTime | yes |  |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `member` | `Member` | one | `memberId` | Cascade | — |
| `generatedBy` | `User` | one? | `generatedById` | — | `IpmCardAuthor` |

**Constraints:** `@id` on `id` · `@@unique([memberId])` · `@unique` on `memberId`

---

### `IpmProvider` → table `ipm_providers`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `organizationId` | String | yes |  |
| `legacyCode` | String | yes |  |
| `name` | String | no |  |
| `specialtyId` | String | yes |  |
| `address` | String | yes |  |
| `phone` | String | yes |  |
| `email` | String | yes |  |
| `accountCode` | String | yes |  |
| `accredited` | Boolean | no | default `false` |
| `status` | IpmProviderStatus | no | default `"ACTIVE"` |
| `paymentTermDays` | Int | no | default `60` |
| `bankName` | String | yes |  |
| `bankAccount` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `organization` | `Organization` | one? | `organizationId` | — | — |
| `specialty` | `IpmProviderSpecialty` | one? | `specialtyId` | — | — |
| `branches` | `IpmProviderBranch` | many | — | — | — |
| `agreements` | `IpmAgreement` | many | — | — | — |
| `vouchers` | `IpmVoucher` | many | — | — | — |
| `invoices` | `IpmProviderInvoice` | many | — | — | — |

**Constraints:** `@id` on `id` · `@@unique([firmId, legacyCode])`

---

### `IpmProviderBranch` → table `ipm_provider_branches`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `providerId` | String | no |  |
| `name` | String | no |  |
| `address` | String | yes |  |
| `phone` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `provider` | `IpmProvider` | one | `providerId` | Cascade | — |

**Constraints:** `@id` on `id`

---

### `IpmAgreement` → table `ipm_agreements`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `providerId` | String | no |  |
| `reference` | String | no |  |
| `startDate` | DateTime | no |  |
| `endDate` | DateTime | yes |  |
| `negotiatedRate` | Decimal | yes | `@db.Decimal(5, 4)` |
| `terms` | String | yes |  |
| `status` | IpmAgreementStatus | no | default `"DRAFT"` |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `provider` | `IpmProvider` | one | `providerId` | Cascade | — |

**Constraints:** `@id` on `id` · `@@unique([firmId, reference])`

---

### `IpmVoucher` → table `ipm_vouchers`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `number` | String | no |  |
| `type` | IpmVoucherType | no |  |
| `memberId` | String | no |  |
| `dependentId` | String | yes |  |
| `beneficiaryType` | IpmBeneficiaryType | no |  |
| `beneficiaryName` | String | no |  |
| `providerId` | String | no |  |
| `serviceTypeId` | String | no |  |
| `categoryId` | String | no |  |
| `issueDate` | DateTime | no |  |
| `expiryDate` | DateTime | no |  |
| `status` | IpmVoucherStatus | no | default `"ISSUED"` |
| `totalAmount` | Decimal | no | default `0`, `@db.Decimal(12, 2)` |
| `insurerShare` | Decimal | no | default `0`, `@db.Decimal(12, 2)` |
| `memberShare` | Decimal | no | default `0`, `@db.Decimal(12, 2)` |
| `appliedRate` | Decimal | no | `@db.Decimal(5, 4)` |
| `rateSource` | String | no |  |
| `qrToken` | String | no |  |
| `issuedById` | String | yes |  |
| `settledAt` | DateTime | yes |  |
| `settledById` | String | yes |  |
| `cancelledAt` | DateTime | yes |  |
| `cancelReason` | String | yes |  |
| `providerInvoiceId` | String | yes |  |
| `origin` | IpmVoucherOrigin | no | default `"BACKOFFICE"` |
| `issuedByPortalAccountId` | String | yes |  |
| `entryMode` | IpmVoucherEntryMode | yes |  |
| `receiptUrl` | String | yes |  |
| `receiptHash` | String | yes |  |
| `ocrTotal` | Decimal | yes | `@db.Decimal(12, 2)` |
| `reviewFlags` | IpmReviewFlag[] | no |  |
| `reviewedById` | String | yes |  |
| `reviewedAt` | DateTime | yes |  |
| `reviewReason` | String | yes |  |
| `clientRequestId` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `issuedByPortalAccount` | `PortalAccount` | one? | `issuedByPortalAccountId` | — | — |
| `reviewedBy` | `User` | one? | `reviewedById` | — | `IpmVoucherReviewer` |
| `notifications` | `PortalNotification` | many | — | — | — |
| `member` | `Member` | one | `memberId` | — | — |
| `dependent` | `Dependent` | one? | `dependentId` | — | — |
| `provider` | `IpmProvider` | one | `providerId` | — | — |
| `serviceType` | `IpmServiceType` | one | `serviceTypeId` | — | — |
| `category` | `IpmServiceCategory` | one | `categoryId` | — | — |
| `issuedBy` | `User` | one? | `issuedById` | — | `IpmVoucherIssuer` |
| `settledBy` | `User` | one? | `settledById` | — | `IpmVoucherSettler` |
| `lines` | `IpmVoucherLine` | many | — | — | — |
| `consumption` | `IpmConsumption` | many | — | — | — |
| `invoiceLines` | `IpmProviderInvoiceLine` | many | — | — | — |

**Constraints:** `@id` on `id` · `@@unique([firmId, number])` · `@@unique([firmId, clientRequestId])`

---

### `IpmVoucherLine` → table `ipm_voucher_lines`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `voucherId` | String | no |  |
| `medicalActId` | String | yes |  |
| `label` | String | no |  |
| `quantity` | Decimal | no | default `1`, `@db.Decimal(8, 2)` |
| `unitPrice` | Decimal | no | `@db.Decimal(12, 2)` |
| `amount` | Decimal | no | `@db.Decimal(12, 2)` |
| `createdAt` | DateTime | no | default `now()` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `voucher` | `IpmVoucher` | one | `voucherId` | Cascade | — |
| `medicalAct` | `IpmMedicalAct` | one? | `medicalActId` | — | — |

**Constraints:** `@id` on `id`

---

### `IpmConsumption` → table `ipm_consumptions`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `beneficiaryRef` | String | no |  |
| `memberId` | String | no |  |
| `categoryId` | String | no |  |
| `periodYear` | Int | no |  |
| `periodMonth` | Int | no |  |
| `voucherId` | String | yes |  |
| `amount` | Decimal | no | `@db.Decimal(12, 2)` |
| `insurerShare` | Decimal | no | `@db.Decimal(12, 2)` |
| `createdAt` | DateTime | no | default `now()` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `member` | `Member` | one | `memberId` | Cascade | — |
| `category` | `IpmServiceCategory` | one | `categoryId` | — | — |
| `voucher` | `IpmVoucher` | one? | `voucherId` | SetNull | — |

**Constraints:** `@id` on `id`

---

### `IpmSequence` → table `ipm_sequences`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `kind` | String | no |  |
| `year` | Int | no |  |
| `next` | Int | no | default `1` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |

**Constraints:** `@id` on `id` · `@@unique([firmId, kind, year])`

---

### `IpmLedgerEntry` → table `ipm_ledger_entries`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `memberId` | String | no |  |
| `periodYear` | Int | no |  |
| `periodMonth` | Int | no |  |
| `type` | IpmLedgerType | no |  |
| `sourceType` | IpmLedgerSource | no |  |
| `sourceId` | String | yes |  |
| `credit` | Decimal | no | default `0`, `@db.Decimal(14, 2)` |
| `debit` | Decimal | no | default `0`, `@db.Decimal(14, 2)` |
| `balanceAfter` | Decimal | no | `@db.Decimal(14, 2)` |
| `note` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `createdById` | String | yes |  |
| `ipmServiceCategoryId` | String | yes |  |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `member` | `Member` | one | `memberId` | Cascade | — |
| `createdBy` | `User` | one? | `createdById` | — | `IpmLedgerAuthor` |
| `ipmServiceCategory` | `IpmServiceCategory` | one? | `ipmServiceCategoryId` | — | — |

**Constraints:** `@id` on `id`

---

### `IpmEmployerInvoice` → table `ipm_employer_invoices`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `employerId` | String | no |  |
| `number` | String | no |  |
| `periodYear` | Int | no |  |
| `periodMonth` | Int | no |  |
| `issueDate` | DateTime | no |  |
| `dueDate` | DateTime | no |  |
| `memberCount` | Int | no |  |
| `employerShare` | Decimal | no | `@db.Decimal(14, 2)` |
| `employeeShare` | Decimal | no | `@db.Decimal(14, 2)` |
| `totalAmount` | Decimal | no | `@db.Decimal(14, 2)` |
| `status` | IpmEmployerInvoiceStatus | no | default `"DRAFT"` |
| `paidAmount` | Decimal | no | default `0`, `@db.Decimal(14, 2)` |
| `paidAt` | DateTime | yes |  |
| `paymentMethod` | String | yes |  |
| `paymentReference` | String | yes |  |
| `statusChangedById` | String | yes |  |
| `statusChangedAt` | DateTime | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `employer` | `IpmEmployer` | one | `employerId` | — | — |
| `statusChangedBy` | `User` | one? | `statusChangedById` | — | `IpmInvoiceStatusAuthor` |
| `lines` | `IpmEmployerInvoiceLine` | many | — | — | — |

**Constraints:** `@id` on `id` · `@@unique([employerId, periodYear, periodMonth])` · `@@unique([firmId, number])`

---

### `IpmEmployerInvoiceLine` → table `ipm_employer_invoice_lines`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `invoiceId` | String | no |  |
| `memberId` | String | no |  |
| `matricule` | String | no |  |
| `memberName` | String | no |  |
| `monthlyContribution` | Decimal | no | `@db.Decimal(12, 2)` |
| `employerShare` | Decimal | no | `@db.Decimal(12, 2)` |
| `employeeShare` | Decimal | no | `@db.Decimal(12, 2)` |
| `createdAt` | DateTime | no | default `now()` |
| `ipmServiceCategoryId` | String | yes |  |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `invoice` | `IpmEmployerInvoice` | one | `invoiceId` | Cascade | — |
| `member` | `Member` | one | `memberId` | — | — |
| `ipmServiceCategory` | `IpmServiceCategory` | one? | `ipmServiceCategoryId` | — | — |

**Constraints:** `@id` on `id`

---

### `IpmProviderInvoice` → table `ipm_provider_invoices`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `providerId` | String | no |  |
| `number` | String | no |  |
| `receivedDate` | DateTime | no |  |
| `periodFrom` | DateTime | no |  |
| `periodTo` | DateTime | no |  |
| `totalAmount` | Decimal | no | `@db.Decimal(14, 2)` |
| `matchedAmount` | Decimal | no | default `0`, `@db.Decimal(14, 2)` |
| `status` | IpmProviderInvoiceStatus | no | default `"RECEIVED"` |
| `origin` | IpmInvoiceOrigin | no | default `"RECEIVED"` |
| `checkedById` | String | yes |  |
| `checkedAt` | DateTime | yes |  |
| `rejectReason` | String | yes |  |
| `disbursementId` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `provider` | `IpmProvider` | one | `providerId` | — | — |
| `checkedBy` | `User` | one? | `checkedById` | — | `IpmProviderInvoiceChecker` |
| `disbursement` | `IpmDisbursement` | one? | `disbursementId` | — | — |
| `lines` | `IpmProviderInvoiceLine` | many | — | — | — |

**Constraints:** `@id` on `id` · `@@unique([firmId, providerId, number])`

---

### `IpmProviderInvoiceLine` → table `ipm_provider_invoice_lines`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `invoiceId` | String | no |  |
| `voucherId` | String | yes |  |
| `voucherNumber` | String | no |  |
| `serviceDate` | DateTime | no |  |
| `beneficiaryName` | String | no |  |
| `memberMatricule` | String | no |  |
| `categoryLabel` | String | no |  |
| `totalAmount` | Decimal | no | `@db.Decimal(12, 2)` |
| `insurerShare` | Decimal | no | `@db.Decimal(12, 2)` |
| `memberShare` | Decimal | no | `@db.Decimal(12, 2)` |
| `createdAt` | DateTime | no | default `now()` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `invoice` | `IpmProviderInvoice` | one | `invoiceId` | Cascade | — |
| `voucher` | `IpmVoucher` | one? | `voucherId` | SetNull | — |

**Constraints:** `@id` on `id`

---

### `IpmReimbursement` → table `ipm_reimbursements`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `memberId` | String | no |  |
| `dependentId` | String | yes |  |
| `number` | String | no |  |
| `submittedDate` | DateTime | no |  |
| `categoryId` | String | no |  |
| `totalAmount` | Decimal | no | `@db.Decimal(12, 2)` |
| `insurerShare` | Decimal | no | `@db.Decimal(12, 2)` |
| `appliedRate` | Decimal | no | `@db.Decimal(5, 4)` |
| `status` | IpmReimbursementStatus | no | default `"SUBMITTED"` |
| `reviewedById` | String | yes |  |
| `reviewedAt` | DateTime | yes |  |
| `rejectReason` | String | yes |  |
| `disbursementId` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `member` | `Member` | one | `memberId` | — | — |
| `dependent` | `Dependent` | one? | `dependentId` | — | — |
| `category` | `IpmServiceCategory` | one | `categoryId` | — | — |
| `reviewedBy` | `User` | one? | `reviewedById` | — | `IpmReimbursementReviewer` |
| `disbursement` | `IpmDisbursement` | one? | `disbursementId` | — | — |

**Constraints:** `@id` on `id` · `@@unique([firmId, number])`

---

### `IpmDisbursement` → table `ipm_disbursements`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `number` | String | no |  |
| `date` | DateTime | no |  |
| `journalCode` | String | no |  |
| `payeeType` | IpmPayeeType | no |  |
| `payeeId` | String | yes |  |
| `payeeName` | String | no |  |
| `amount` | Decimal | no | `@db.Decimal(14, 2)` |
| `motif` | String | no |  |
| `paymentMethod` | IpmPaymentMethod | no |  |
| `paymentReference` | String | yes |  |
| `enteredById` | String | yes |  |
| `approvedById` | String | yes |  |
| `approvedAt` | DateTime | yes |  |
| `accountingById` | String | yes |  |
| `accountingAt` | DateTime | yes |  |
| `receivedAt` | DateTime | yes |  |
| `status` | IpmDisbursementStatus | no | default `"DRAFT"` |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `enteredBy` | `User` | one? | `enteredById` | — | `IpmDisbursementAuthor` |
| `approvedBy` | `User` | one? | `approvedById` | — | `IpmDisbursementApprover` |
| `accountingBy` | `User` | one? | `accountingById` | — | `IpmDisbursementAccountant` |
| `lines` | `IpmDisbursementLine` | many | — | — | — |
| `providerInvoices` | `IpmProviderInvoice` | many | — | — | — |
| `reimbursements` | `IpmReimbursement` | many | — | — | — |

**Constraints:** `@id` on `id` · `@@unique([firmId, number])`

---

### `IpmDisbursementLine` → table `ipm_disbursement_lines`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `disbursementId` | String | no |  |
| `sourceType` | String | no |  |
| `sourceId` | String | yes |  |
| `label` | String | no |  |
| `amount` | Decimal | no | `@db.Decimal(14, 2)` |
| `createdAt` | DateTime | no | default `now()` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `disbursement` | `IpmDisbursement` | one | `disbursementId` | Cascade | — |

**Constraints:** `@id` on `id`

---

### `PortalAccount` → table `ipm_portal_accounts`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `memberId` | String | no | unique |
| `phone` | String | no |  |
| `status` | PortalAccountStatus | no | default `"INVITED"` |
| `activatedAt` | DateTime | yes |  |
| `lastLoginAt` | DateTime | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `member` | `Member` | one | `memberId` | Cascade | — |
| `vouchers` | `IpmVoucher` | many | — | — | — |
| `notifications` | `PortalNotification` | many | — | — | — |

**Constraints:** `@id` on `id` · `@@unique([firmId, phone])` · `@unique` on `memberId`

---

### `IpmPortalSettings` → table `ipm_portal_settings`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `firmId` | String | no | **PK** |
| `reviewThresholdAmount` | Decimal | no | default `100000`, `@db.Decimal(12, 2)` |
| `reviewThresholdRatio` | Decimal | no | default `0.5`, `@db.Decimal(5, 4)` |
| `unusualAmountMultiple` | Decimal | no | default `3`, `@db.Decimal(5, 2)` |
| `ocrMismatchTolerance` | Decimal | no | default `0.15`, `@db.Decimal(5, 4)` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |

**Constraints:** `@id` on `firmId`

---

### `PortalNotification` → table `ipm_portal_notifications`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `portalAccountId` | String | no |  |
| `voucherId` | String | no |  |
| `kind` | PortalNotificationKind | no |  |
| `createdAt` | DateTime | no | default `now()` |
| `readAt` | DateTime | yes |  |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `portalAccount` | `PortalAccount` | one | `portalAccountId` | Cascade | — |
| `voucher` | `IpmVoucher` | one | `voucherId` | Cascade | — |

**Constraints:** `@id` on `id`

---

### `IpmPortalBooking` → table `ipm_portal_bookings`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `type` | IpmVoucherType | no |  |
| `serviceTypeId` | String | no |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `specialties` | `IpmProviderSpecialty` | many | — | — | — |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `serviceType` | `IpmServiceType` | one | `serviceTypeId` | — | — |

**Constraints:** `@id` on `id` · `@@unique([firmId, type])`

---

### `IpmMemberCeiling` → table `ipm_member_ceilings`

| Field | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | String | no | **PK**, default `cuid()` |
| `firmId` | String | no |  |
| `memberId` | String | no |  |
| `categoryId` | String | no |  |
| `ceilingPerAct` | Decimal | yes | `@db.Decimal(12, 2)` |
| `ceilingMonthly` | Decimal | yes | `@db.Decimal(12, 2)` |
| `ceilingAnnual` | Decimal | yes | `@db.Decimal(12, 2)` |
| `reason` | String | no |  |
| `validFrom` | DateTime | no |  |
| `validTo` | DateTime | yes |  |
| `createdById` | String | yes |  |
| `createdAt` | DateTime | no | default `now()` |
| `updatedAt` | DateTime | no | `@updatedAt` |

**Relations**

| Field | Target | Card. | FK | On delete | Relation name |
| --- | --- | --- | --- | --- | --- |
| `firm` | `Firm` | one | `firmId` | Cascade | — |
| `member` | `Member` | one | `memberId` | Cascade | — |
| `category` | `IpmServiceCategory` | one | `categoryId` | — | — |
| `createdBy` | `User` | one? | `createdById` | — | `IpmMemberCeilingAuthor` |

**Constraints:** `@id` on `id`

---
