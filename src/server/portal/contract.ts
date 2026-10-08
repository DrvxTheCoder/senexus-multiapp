/**
 * The contract between this application and the participant portal.
 *
 * **The portal holds an identical copy of this file** (ipm-portal
 * `src/lib/schema.ts` and the `Db` type in `src/lib/mock-data.ts`). Change
 * both or neither: nothing checks them against each other at build time, and a
 * field renamed on one side shows up as `undefined` on the other.
 *
 * Conventions, as in the portal:
 *   - `DateTime` travels as an ISO string;
 *   - `Decimal` travels as a number (FCFA has no subunit; rates stay fractions).
 *
 * Deliberate departures from the portal's prototype copy, all because the real
 * data is not shaped like the mock:
 *   - `Gender` has a third value, `OTHER`, as in the schema;
 *   - `IpmEmployer.planId` is nullable — an employer on a negotiated flat rate
 *     has no formule. Its rates come in `employerRates`, which win over
 *     `planRates` exactly as in `tryResolveRate`;
 *   - `IpmVoucher.issuedById` and `reviewedById` are always null here: they are
 *     back-office user ids, which a participant has no use for.
 *
 * And two additions the prototype did not need:
 *   - `employerRates` — the family's employer's negotiated rates;
 *   - `bookings` — what each type of bon books against, per IPM. It replaces
 *     the prototype's hard-coded `VOUCHER_TYPE_BOOKING` and
 *     `VOUCHER_TYPE_SPECIALTIES`; a type with no booking is not offered.
 *
 * Change 2026-10-03 — ceilings resolved by the server:
 *   - `ceilings` — one row per category × beneficiary type the family has,
 *     with the taux and every plafond already resolved, participant >
 *     employer > formule, field by field, and where each plafond came from.
 *     Read plafonds from here; do not re-derive them from `planRates` and
 *     `employerRates` (which stay, unchanged, for display). A null plafond
 *     means none applies. A category absent for a type is not covered.
 *
 * Change 2026-10-05 — access codes:
 *   - `POST /api/portail/access-request` (`AccessRequestRequest` →
 *     `AccessRequestResponse`), for a participant who cannot log in;
 *   - `SessionRequest.code` also accepts the access code the IPM then issues.
 *
 * Change 2026-10-05 — balance basis:
 *   - `Member.currentBalance` is debited by each bon's `totalAmount`, no longer
 *     its `insurerShare`. Plafonds are unchanged: they still cap the IPM share.
 *
 * Change 2026-10-08 — bon de pharmacie à montant différé, and the provider API:
 *   - `IpmVoucherStatus` gains `AWAITING_AMOUNT`: a pharmacy bon issued with
 *     no amount, waiting for the pharmacy to enter it. `EXPIRED` is now used:
 *     a bon nobody validated within `pharmacyValidationDays`;
 *   - `IpmVoucher.totalAmount` is **nullable** — null exactly while a pharmacy
 *     bon has no amount. New fields: `deferredAmount`, `prescriptionUrl`,
 *     `amountSource`, `validatedAt`, `adjustedByIpm`;
 *   - `prescriptionUrl` is a signed link to this API, valid ten minutes —
 *     never a storage URL. Fetch the snapshot (or the bon) again for a new one;
 *   - `IpmReviewFlag` gains `AMOUNT_ABOVE_THRESHOLD`, `CEILING_CAPPED`,
 *     `PRESCRIPTION_REUSED`; `PortalNotificationKind` gains
 *     `VOUCHER_VALIDATED`, `VOUCHER_ADJUSTED`, `VOUCHER_VOIDED`;
 *   - `IpmPortalSettings` gains `pharmacyValidationDays`,
 *     `pharmacyReviewThreshold`;
 *   - participant: `POST /api/portail/voucher/preview|issue|cancel`;
 *   - provider: `/api/portail/prestataire/*` — its own login and its own
 *     bearer token, which no participant route accepts (nor the reverse).
 *
 * Nothing in this file may import server code: it is plain types.
 */

type ISODate = string

/* ------------------------------------------------------------------------ */
/* Enums                                                                    */

export type IpmBeneficiaryType =
  | "ALL"
  | "MEMBER"
  | "SPOUSE_F"
  | "CHILD"
  | "SPOUSE_M"
  | "ASCENDANT"
  | "OTHER"

export type IpmMemberStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "TERMINATED"
export type IpmDependentStatus = "ACTIVE" | "SUSPENDED" | "TERMINATED"
export type IpmDependentRelation = "SPOUSE_F" | "CHILD" | "SPOUSE_M" | "ASCENDANT" | "OTHER"
export type IpmProviderStatus = "ACTIVE" | "SUSPENDED" | "TERMINATED"
export type IpmAgreementStatus = "DRAFT" | "ACTIVE" | "EXPIRED" | "TERMINATED"
export type Gender = "MALE" | "FEMALE" | "OTHER"

export type IpmVoucherType = "PHARMACY" | "OPTICAL" | "GUARANTEE" | "HOSPITALIZATION"

export type IpmVoucherStatus =
  /** Bon de pharmacie issued without an amount; the pharmacy enters it. */
  | "AWAITING_AMOUNT"
  | "PENDING_REVIEW"
  | "ISSUED"
  | "PRESENTED"
  | "SETTLED"
  | "INVOICED"
  | "CANCELLED"
  | "EXPIRED"
  | "REJECTED"

export type IpmVoucherOrigin = "BACKOFFICE" | "PORTAL"
export type IpmVoucherEntryMode = "SCAN" | "MANUAL"

export type IpmReviewFlag =
  | "ABOVE_THRESHOLD"
  | "AMOUNT_UNUSUAL"
  | "SAME_DAY_DUPLICATE"
  | "RECEIPT_REUSED"
  | "OCR_MISMATCH"
  /** `decideIssuance` raised a warning; the bon waits for a gestionnaire. */
  | "ISSUANCE_WARNING"
  /** Pharmacy amount above the review threshold. Counted anyway. */
  | "AMOUNT_ABOVE_THRESHOLD"
  /** The IPM share was limited by the remaining plafond. */
  | "CEILING_CAPPED"
  /** The ordonnance file is attached to another live bon. */
  | "PRESCRIPTION_REUSED"

export type PortalAccountStatus = "INVITED" | "ACTIVE" | "LOCKED"
export type PortalNotificationKind =
  | "VOUCHER_APPROVED"
  | "VOUCHER_REJECTED"
  /** A pharmacy bon received its amount. */
  | "VOUCHER_VALIDATED"
  /** The IPM changed the amount of a validated bon. */
  | "VOUCHER_ADJUSTED"
  /** The IPM voided a bon. */
  | "VOUCHER_VOIDED"

/* ------------------------------------------------------------------------ */
/* Models                                                                   */

export type Person = {
  id: string
  holdingId: string
  firstName: string
  lastName: string
  birthDate: ISODate | null
  gender: Gender | null
  phone: string | null
  email: string | null
  address: string | null
  photoUrl: string | null
}

export type IpmServiceCategory = {
  id: string
  firmId: string
  code: string
  label: string
  sortOrder: number
  active: boolean
}

export type IpmServiceType = {
  id: string
  firmId: string
  categoryId: string
  code: string
  label: string
  active: boolean
}

export type IpmProviderSpecialty = {
  id: string
  firmId: string
  code: string
  label: string
  active: boolean
}

export type IpmPlan = {
  id: string
  firmId: string
  code: string
  name: string
  monthlyPrice: number
  validFrom: ISODate
  validTo: ISODate | null
  active: boolean
}

export type IpmPlanRate = {
  id: string
  firmId: string
  planId: string
  categoryId: string
  beneficiaryType: IpmBeneficiaryType
  /** Fraction, never a percentage. */
  rate: number
  ceilingPerAct: number | null
  ceilingMonthly: number | null
  ceilingAnnual: number | null
  waitingPeriodDays: number
}

/** An employer's negotiated rate. Wins over the plan rate for its category. */
export type IpmEmployerRate = {
  id: string
  firmId: string
  employerId: string
  categoryId: string
  beneficiaryType: IpmBeneficiaryType
  /** Fraction, never a percentage. */
  rate: number
  ceilingPerAct: number | null
  ceilingMonthly: number | null
  ceilingAnnual: number | null
  /** Null means none set — treat as 0, as the server does. */
  waitingPeriodDays: number | null
}

/**
 * What a bon of one type books against on the portal: the prestation (and so
 * the category, whose rate and ceilings apply), and which provider specialties
 * may receive it. Configured per IPM; the server applies the same mapping when
 * the bon is submitted, so the portal never sends a prestation id.
 */
export type PortalBooking = {
  type: IpmVoucherType
  serviceTypeId: string
  categoryId: string
  /** Empty means any accredited provider may receive this type of bon. */
  specialtyIds: string[]
}

/** Where a resolved plafond came from. `MEMBER` is a plafond particulier. */
export type IpmCeilingSource = "MEMBER" | "EMPLOYER" | "PLAN"

/**
 * Taux and plafonds in force today for one category and one beneficiary type
 * of the family, resolved on the server with the same function issuance uses.
 */
export type ResolvedCeiling = {
  categoryId: string
  beneficiaryType: IpmBeneficiaryType
  /** Fraction, never a percentage. */
  rate: number
  ceilingPerAct: number | null
  ceilingMonthly: number | null
  ceilingAnnual: number | null
  waitingPeriodDays: number
  /** Null when no level sets that plafond. */
  source: {
    perAct: IpmCeilingSource | null
    monthly: IpmCeilingSource | null
    annual: IpmCeilingSource | null
  }
}

export type IpmEmployer = {
  id: string
  firmId: string
  /** Organization.name, flattened. */
  name: string
  /** Null for an employer on a negotiated flat rate — see the module comment. */
  planId: string | null
  reminderDelayDays: number
  suspensionDelayDays: number
  ageMajority: number
}

export type Member = {
  id: string
  firmId: string
  personId: string
  employerId: string
  matricule: string
  legacyCode: string | null
  jobTitle: string | null
  affiliationDate: ISODate
  terminationDate: ISODate | null
  status: IpmMemberStatus
  /**
   * Cotisations minus consumption, from the register. Since 2026-10-05 a bon
   * is debited at its **full amount** (`totalAmount`), not its IPM share.
   */
  currentBalance: number
}

export type Dependent = {
  id: string
  firmId: string
  memberId: string
  personId: string
  matricule: string
  relation: IpmDependentRelation
  rank: number
  coverageStart: ISODate
  coverageEnd: ISODate | null
  status: IpmDependentStatus
}

export type IpmMemberCard = {
  id: string
  firmId: string
  memberId: string
  version: number
  generatedAt: ISODate
  revokedAt: ISODate | null
}

export type IpmProvider = {
  id: string
  firmId: string
  name: string
  specialtyId: string | null
  address: string | null
  phone: string | null
  accredited: boolean
  status: IpmProviderStatus
}

export type IpmAgreement = {
  id: string
  firmId: string
  providerId: string
  reference: string
  startDate: ISODate
  endDate: ISODate | null
  status: IpmAgreementStatus
}

export type IpmVoucher = {
  id: string
  firmId: string
  number: string
  type: IpmVoucherType
  memberId: string
  dependentId: string | null
  beneficiaryType: IpmBeneficiaryType
  beneficiaryName: string
  providerId: string
  serviceTypeId: string
  categoryId: string
  issueDate: ISODate
  expiryDate: ISODate
  status: IpmVoucherStatus
  /** Null while a pharmacy bon waits for its amount (and if it never got one). */
  totalAmount: number | null
  /** Zero until a pharmacy bon is validated. */
  insurerShare: number
  memberShare: number
  appliedRate: number
  rateSource: string
  qrToken: string
  /** Always null on this API — see the module comment. */
  issuedById: string | null
  settledAt: ISODate | null
  cancelledAt: ISODate | null
  cancelReason: string | null

  origin: IpmVoucherOrigin
  issuedByPortalAccountId: string | null
  entryMode: IpmVoucherEntryMode | null
  /**
   * Zipline URL; null when the bon has no receipt — every back-office bon, and
   * a portal bon whose participant skipped the photo.
   */
  receiptUrl: string | null
  receiptHash: string | null
  ocrTotal: number | null
  reviewFlags: IpmReviewFlag[]
  /** Always null on this API — see the module comment. */
  reviewedById: string | null
  reviewedAt: ISODate | null
  /** Shown to the participant when a bon is refused. */
  reviewReason: string | null

  /** Issued without an amount (bon de pharmacie). */
  deferredAmount: boolean
  /** Signed link, valid ten minutes; null when the bon has no ordonnance. */
  prescriptionUrl: string | null
  amountSource: IpmVoucherAmountSource | null
  validatedAt: ISODate | null
  /** The amount was entered or changed by the IPM rather than the pharmacy. */
  adjustedByIpm: boolean

  createdAt: ISODate
}

export type IpmVoucherAmountSource = "PROVIDER" | "BACK_OFFICE"

export type IpmVoucherLine = {
  id: string
  firmId: string
  voucherId: string
  medicalActId: string | null
  label: string
  quantity: number
  unitPrice: number
  amount: number
}

export type IpmConsumption = {
  id: string
  firmId: string
  /** `member:<id>` or `dependent:<id>`. */
  beneficiaryRef: string
  memberId: string
  categoryId: string
  periodYear: number
  periodMonth: number
  voucherId: string | null
  amount: number
  insurerShare: number
}

export type PortalAccount = {
  id: string
  firmId: string
  memberId: string
  phone: string
  status: PortalAccountStatus
  activatedAt: ISODate | null
  lastLoginAt: ISODate | null
}

export type IpmPortalSettings = {
  firmId: string
  reviewThresholdAmount: number
  reviewThresholdRatio: number
  unusualAmountMultiple: number
  ocrMismatchTolerance: number
  /** Days a pharmacy has to validate a bon before it expires. */
  pharmacyValidationDays: number
  /** Above it a pharmacy amount is flagged (never refused). Null: no flag. */
  pharmacyReviewThreshold: number | null
}

/** Everything the portal's pages read, scoped to one family. */
export type Db = {
  firmId: string
  persons: Person[]
  categories: IpmServiceCategory[]
  serviceTypes: IpmServiceType[]
  specialties: IpmProviderSpecialty[]
  plans: IpmPlan[]
  planRates: IpmPlanRate[]
  employerRates: IpmEmployerRate[]
  employers: IpmEmployer[]
  members: Member[]
  dependents: Dependent[]
  cards: IpmMemberCard[]
  providers: IpmProvider[]
  agreements: IpmAgreement[]
  vouchers: IpmVoucher[]
  voucherLines: IpmVoucherLine[]
  consumptions: IpmConsumption[]
  portalAccounts: PortalAccount[]
  settings: IpmPortalSettings
  /** The types of bon this IPM offers on the portal, and what each books against. */
  bookings: PortalBooking[]
  /** Resolved taux and plafonds — see `ResolvedCeiling`. */
  ceilings: ResolvedCeiling[]
  /** Next number per voucher type, informational only: the server numbers bons. */
  sequences: Record<IpmVoucherType, number>
}

/* ------------------------------------------------------------------------ */
/* Requests and responses                                                   */

export type ApiError = {
  error: {
    code: string
    /** French, suitable to show the participant as is. */
    message: string
    details?: { refusals?: string[]; fields?: Record<string, string[]> }
  }
}

/**
 * POST /api/portail/session. `code` is the SMS code, or a six-digit access
 * code the IPM issued from the back office — same field, same rules.
 */
export type SessionRequest = { firmSlug: string; phone: string; code: string }
export type SessionResponse = { token: string; account: PortalAccount }

/**
 * POST /api/portail/access-request — no token. Always 202 with this body,
 * whether or not the number has an account; 429 when asked too often.
 */
export type AccessRequestRequest = { firmSlug: string; phone: string }
export type AccessRequestResponse = { requested: true }

export type DraftLine = { label: string; quantity: number; unitPrice: number }

/**
 * A bon as the participant fills it. The server decides everything else: the
 * beneficiary is the account's family, the prestation is the booking for
 * `type`, the total is the lines' sum, or `total` when no line is priced.
 */
export type VoucherDraft = {
  type: IpmVoucherType
  /** Null when the participant is the beneficiary. */
  dependentId: string | null
  providerId: string
  entryMode: IpmVoucherEntryMode
  lines: DraftLine[]
  /** Used when there are no priced lines. */
  total: number | null
  receiptHash: string | null
  ocrTotal: number | null
  /** Idempotency key: a retried submission returns the bon already written. */
  clientRequestId: string
}

/** POST /api/portail/vouchers/preview */
export type PreviewResponse = {
  allowed: boolean
  refusals: string[]
  warnings: string[]
  totalAmount: number
  split: { totalAmount: number; insurerShare: number; memberShare: number } | null
  wouldHold: boolean
  flags: IpmReviewFlag[]
  threshold: number | null
}

/** POST /api/portail/vouchers — 201 when created, 200 when already seen. */
export type CreateVoucherResponse = { voucher: IpmVoucher; lines: IpmVoucherLine[] }

/** GET /api/portail/notifications */
export type PortalNotification = {
  id: string
  kind: PortalNotificationKind
  createdAt: ISODate
  readAt: ISODate | null
  voucher: {
    id: string
    number: string
    status: IpmVoucherStatus
    reviewReason: string | null
  }
}
export type NotificationsResponse = { notifications: PortalNotification[] }

/* ------------------------------------------------------------------------ */
/* Bon de pharmacie à montant différé — participant                         */

/**
 * `beneficiaryRef` is `member:<memberId>` (the participant) or
 * `dependent:<dependentId>` (an ayant droit of the same family). `category` is
 * the bon type; only `PHARMACY` may be issued without an amount — any other
 * answers 422 `CATEGORY_NOT_DEFERRED` (use `POST /api/portail/vouchers`).
 */
export type PharmacyVoucherRequest = {
  beneficiaryRef: string
  category: IpmVoucherType
  providerId: string
}

/** POST /api/portail/voucher/preview — eligibility only, no amount, no split. */
export type PharmacyPreviewResponse = {
  allowed: boolean
  refusals: string[]
  warnings: string[]
  /** The taux that will apply, as a fraction. Null when refused for want of one. */
  rate: number | null
  /** What is left under the plafonds for the IPM share; null = no plafond. */
  remainingCeiling: number | null
  /** Days the pharmacy will have to validate. */
  validationDays: number
}

/**
 * POST /api/portail/voucher/issue — multipart: `request` (JSON
 * `PharmacyVoucherRequest & { clientRequestId?: string }`) + `prescription`
 * (JPEG, PNG, WebP or PDF, 5 Mo max). 201 when created; 200 with the same body
 * when `clientRequestId` was already used by this account.
 */
export type PharmacyIssueResponse = {
  voucherId: string
  number: string
  /** What the QR encodes; the pharmacy scans it. */
  qrToken: string
  status: "AWAITING_AMOUNT"
  /** Deadline for the pharmacy to validate. */
  expiresAt: ISODate
}

/** POST /api/portail/voucher/cancel — answers `CreateVoucherResponse`. */
export type PharmacyCancelRequest = { voucherId: string; reason?: string }

/* ------------------------------------------------------------------------ */
/* Prestataire                                                              */

/**
 * Error codes of the provider routes, beyond `INVALID_INPUT`:
 *   - 401 `INVALID_CREDENTIALS` — wrong code or password (one sentence for both)
 *   - 401 `UNAUTHENTICATED` — no token, bad token, session closed
 *   - 403 `PASSWORD_CHANGE_REQUIRED` — temporary password: change it first
 *   - 429 `ACCOUNT_LOCKED` — too many failures; `Retry-After` in seconds
 *   - 403 `WRONG_PROVIDER` — the bon is bound to another pharmacy
 *   - 404 `NOT_FOUND`
 *   - 409 `ALREADY_VALIDATED`, 409 `EXPIRED`, 409 `CANCELLED`
 *   - 422 `INVALID_AMOUNT` — not a whole, positive number of francs
 *   - 422 `NOT_DEFERRED` — not a pharmacy bon awaiting its amount
 */

/** POST /api/portail/prestataire/login */
export type ProviderLoginRequest = { code: string; password: string }
export type ProviderLoginResponse = {
  /** Bearer token for every other provider route. */
  token: string
  expiresAt: ISODate
  /** True after a creation or reset: only change-password works until then. */
  mustChangePassword: boolean
  provider: { id: string; name: string; code: string }
}

/** POST /api/portail/prestataire/change-password → `{ mustChangePassword: false }` */
export type ProviderChangePasswordRequest = { currentPassword: string; newPassword: string }

/** GET /api/portail/prestataire/voucher/lookup?token=… */
export type ProviderVoucherLookup = {
  voucherId: string
  number: string
  beneficiaryName: string
  issuedAt: ISODate
  expiresAt: ISODate
  /** `AWAITING_AMOUNT` past its deadline reads `EXPIRED`. */
  status: IpmVoucherStatus
  /** Signed link, valid ten minutes. */
  prescriptionUrl: string | null
}

export type ProviderAmountFlag = "CEILING_CAPPED" | "AMOUNT_ABOVE_THRESHOLD"

/** POST /api/portail/prestataire/voucher/validate/preview */
export type ProviderAmountPreviewRequest = { voucherId: string; amount: number }
export type ProviderAmountPreviewResponse = {
  voucherId: string
  amount: number
  ipmShare: number
  participantShare: number
  /** Fraction. */
  rate: number
  /** Null when no plafond applies. */
  remainingCeiling: number | null
  flags: ProviderAmountFlag[]
}

/**
 * POST /api/portail/prestataire/voucher/validate. `idempotencyKey`: 8–64 of
 * `[A-Za-z0-9_-]`, new per validation attempt and reused on retry. A retry with
 * the same key answers 200 with `replayed: true`.
 */
export type ProviderValidateRequest = { voucherId: string; amount: number; idempotencyKey: string }
export type ProviderValidateResponse = {
  voucherId: string
  number: string
  status: IpmVoucherStatus
  amount: number
  ipmShare: number
  participantShare: number
  flags: ProviderAmountFlag[]
  validatedAt: ISODate | null
  replayed: boolean
}

export type ProviderVoucherItem = {
  voucherId: string
  reference: string
  beneficiaryName: string
  validatedAt: ISODate
  /** Current amount — after any IPM correction. */
  amount: number
  ipmShare: number
  participantShare: number
  adjustedByIpm: boolean
}

/** GET /api/portail/prestataire/vouchers?month=YYYY-MM (default: this month) */
export type ProviderVoucherListResponse = {
  items: ProviderVoucherItem[]
  kpi: { month: string; totalAmount: number; count: number }
}

/** GET /api/portail/prestataire/vouchers/{voucherId} */
export type ProviderVoucherDetail = Omit<ProviderVoucherItem, "validatedAt" | "amount"> & {
  status: IpmVoucherStatus
  issuedAt: ISODate
  expiresAt: ISODate
  /** Null until validated. */
  validatedAt: ISODate | null
  /** Null until validated. */
  amount: number | null
  prescriptionUrl: string | null
}
