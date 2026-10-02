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

export type PortalAccountStatus = "INVITED" | "ACTIVE" | "LOCKED"
export type PortalNotificationKind = "VOUCHER_APPROVED" | "VOUCHER_REJECTED"

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
  totalAmount: number
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
  /** Zipline URL; null when the bon has no receipt (every back-office bon). */
  receiptUrl: string | null
  receiptHash: string | null
  ocrTotal: number | null
  reviewFlags: IpmReviewFlag[]
  /** Always null on this API — see the module comment. */
  reviewedById: string | null
  reviewedAt: ISODate | null
  /** Shown to the participant when a bon is refused. */
  reviewReason: string | null

  createdAt: ISODate
}

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

/** POST /api/portail/session */
export type SessionRequest = { firmSlug: string; phone: string; code: string }
export type SessionResponse = { token: string; account: PortalAccount }

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
