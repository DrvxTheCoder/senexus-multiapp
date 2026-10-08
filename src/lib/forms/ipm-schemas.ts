import { z } from "zod"

import {
  amountField,
  dateField,
  optionalDateField,
} from "@/lib/forms/hr-schemas"
import { memberQuerySchema } from "@/lib/queries/ipm/member-query"

/**
 * IPM form schemas — isomorphic, parsed by the dialog and by the action, so
 * the two cannot disagree about what is required.
 *
 * Dates and amounts reuse the HR helpers deliberately: `YYYY-MM-DD` strings
 * turned into `Date` at noon UTC, and whole francs. Two conventions for the
 * same thing in one application is how a date slips a day.
 */

const firmScoped = { firmSlug: z.string().min(1) }

const optionalText = (max = 200) =>
  z.string().trim().max(max).or(z.literal("")).optional()

/**
 * Sexe, which every form can legitimately leave unset.
 *
 * The empty string is accepted, not merely `undefined`: a `<select>` with no
 * selection stores `""`, and the edit dialogs seed their defaults from a
 * record where the field is null. Without this, opening "Modifier" on anyone
 * whose sexe was never recorded made the form fail client validation on a
 * field the user had not touched, and — because `handleSubmit` does not call
 * the action when validation fails — the save button did nothing at all.
 *
 * The actions normalise `""` back to null before it reaches the enum column.
 */
const genderField = z
  .enum(["MALE", "FEMALE", "OTHER"])
  .or(z.literal(""))
  .optional()

/**
 * A taux, entered as a percentage and stored as a fraction.
 *
 * The conversion happens here rather than in the action, so every caller —
 * form, import, seed check — converts identically. A value above 100 is
 * refused: the institution cannot cover more than the bill.
 *
 * **Not idempotent**: parsed twice, 80 becomes 0.008. A form whose schema
 * holds a rateField must resolve with `zodResolver(schema, undefined,
 * { raw: true })`, so it submits the percentage typed and only the action
 * converts it.
 */
export const rateField = z
  .union([z.number(), z.string()])
  .transform((value) =>
    typeof value === "number" ? value : Number(value.trim().replace(",", "."))
  )
  .refine((value) => Number.isFinite(value), { message: "Taux invalide." })
  .refine((value) => value >= 0 && value <= 100, {
    message: "Le taux est un pourcentage entre 0 et 100.",
  })
  .transform((percent) => Math.round(percent * 100) / 10000)

export const BENEFICIARY_TYPES = [
  "ALL",
  "MEMBER",
  "SPOUSE_F",
  "SPOUSE_M",
  "CHILD",
  "ASCENDANT",
  "OTHER",
] as const

export const DEPENDENT_RELATIONS = [
  "SPOUSE_F",
  "SPOUSE_M",
  "CHILD",
  "ASCENDANT",
  "OTHER",
] as const

export const MEMBER_STATUSES = [
  "PENDING",
  "ACTIVE",
  "SUSPENDED",
  "TERMINATED",
] as const

export const EMPLOYER_STATUSES = ["ACTIVE", "SUSPENDED", "TERMINATED"] as const

/* ==========================================================================
 * Identité partagée
 * ========================================================================== */

/**
 * The person behind a participant or an ayant droit.
 *
 * `personId` reuses somebody the holding already knows — an employee being
 * affiliated, a spouse who is themselves a participant — and the name fields
 * create one. Exactly one of the two, which is what stops a second Person row
 * being created for a person who already has one.
 */
export const personInputSchema = z
  .object({
    personId: z.string().min(1).optional(),
    firstName: z.string().trim().min(1, "Prénom requis.").max(80).optional(),
    lastName: z.string().trim().min(1, "Nom requis.").max(80).optional(),
    birthDate: optionalDateField,
    birthPlace: optionalText(120),
    gender: genderField,
    nationalId: optionalText(40),
    phone: optionalText(40),
    email: z.string().trim().email("Adresse e-mail invalide.").or(z.literal("")).optional(),
    address: optionalText(200),
  })
  .refine((value) => Boolean(value.personId) || Boolean(value.firstName && value.lastName), {
    message: "Indiquez une personne existante ou saisissez un nom.",
    path: ["lastName"],
  })

/* ==========================================================================
 * Employeurs
 * ========================================================================== */

const employerFields = {
  organizationId: z.string().min(1, "Sélectionnez une société.").optional(),
  /** Creating the organization inline, for an employer outside the group. */
  organizationName: z.string().trim().min(2).max(160).optional(),
  ninea: optionalText(40),
  sector: optionalText(120),
  legacyEmployerCode: optionalText(10),
  accountCode: optionalText(20),
  planId: z.string().min(1).or(z.literal("")).optional(),
  affiliationDate: dateField,
  status: z.enum(EMPLOYER_STATUSES).default("ACTIVE"),
  ageMajority: z.coerce.number().int().min(16).max(30).default(21),
  ageRetirement: z.coerce.number().int().min(50).max(75).default(60),
  contributionEmployerAmount: amountField.optional(),
  contributionEmployeeAmount: amountField.optional(),
  reminderDelayDays: z.coerce.number().int().min(0).max(365).default(15),
  suspensionDelayDays: z.coerce.number().int().min(0).max(730).default(90),
  consumptionCeiling: amountField.optional(),
  debtCeiling: amountField.optional(),
}

export const createEmployerSchema = z
  .object({ ...firmScoped, ...employerFields })
  .refine(
    (value) => Boolean(value.organizationId) || Boolean(value.organizationName),
    {
      message: "Sélectionnez une société existante ou saisissez sa raison sociale.",
      path: ["organizationName"],
    }
  )

export const updateEmployerSchema = z.object({
  ...firmScoped,
  ...employerFields,
  employerId: z.string().min(1),
  organizationId: z.string().min(1).optional(),
  organizationName: z.string().trim().min(2).max(160).optional(),
})

/* ==========================================================================
 * Participants
 * ========================================================================== */

export const createMemberSchema = z.object({
  ...firmScoped,
  employerId: z.string().min(1, "Sélectionnez un employeur."),
  person: personInputSchema,
  /** The HR employment that drives the affiliation, when there is one (§7). */
  employeeId: z.string().min(1).or(z.literal("")).optional(),
  jobTitle: optionalText(120),
  affiliationDate: dateField,
  status: z.enum(MEMBER_STATUSES).default("ACTIVE"),
  legacyCode: optionalText(30),
  /** Opens the first cotisation period. Absent means none yet. */
  monthlyContribution: amountField.optional(),
})

export const updateMemberSchema = z.object({
  ...firmScoped,
  memberId: z.string().min(1),
  employerId: z.string().min(1),
  jobTitle: optionalText(120),
  affiliationDate: dateField,
  status: z.enum(MEMBER_STATUSES),
  terminationDate: optionalDateField,
  legacyCode: optionalText(30),
  person: z.object({
    firstName: z.string().trim().min(1, "Prénom requis.").max(80),
    lastName: z.string().trim().min(1, "Nom requis.").max(80),
    birthDate: optionalDateField,
    birthPlace: optionalText(120),
    gender: genderField,
    nationalId: optionalText(40),
    phone: optionalText(40),
    email: z.string().trim().email("Adresse e-mail invalide.").or(z.literal("")).optional(),
    address: optionalText(200),
  }),
})

/**
 * Radiation. A participant is never deleted — vouchers, cotisations and a card
 * all point at them — so `TERMINATED` plus an effective date is the end state,
 * exactly as `ARCHIVED` is for a client.
 */
export const terminateMemberSchema = z.object({
  ...firmScoped,
  memberId: z.string().min(1),
  terminationDate: dateField,
  reason: optionalText(200),
})

/* ==========================================================================
 * Ayants droit
 * ========================================================================== */

export const createDependentSchema = z.object({
  ...firmScoped,
  memberId: z.string().min(1),
  person: personInputSchema,
  relation: z.enum(DEPENDENT_RELATIONS),
  marriageDate: optionalDateField,
  coverageStart: dateField,
  coverageEnd: optionalDateField,
})

export const updateDependentSchema = z.object({
  ...firmScoped,
  dependentId: z.string().min(1),
  relation: z.enum(DEPENDENT_RELATIONS),
  marriageDate: optionalDateField,
  coverageStart: dateField,
  coverageEnd: optionalDateField,
  status: z.enum(["ACTIVE", "SUSPENDED", "TERMINATED"]),
  person: z.object({
    firstName: z.string().trim().min(1, "Prénom requis.").max(80),
    lastName: z.string().trim().min(1, "Nom requis.").max(80),
    birthDate: optionalDateField,
    gender: genderField,
  }),
})

/* ==========================================================================
 * Photos
 * ========================================================================== */

/**
 * Who the photo belongs to.
 *
 * A participant and an ayant droit are different tables with different ids, so
 * the subject is named explicitly rather than inferred from which id happens
 * to be present — an ambiguous payload is how a photo ends up on the wrong
 * person's card.
 */
export const PHOTO_SUBJECTS = ["member", "dependent"] as const

/**
 * The metadata half of a photo upload.
 *
 * The file itself travels as `FormData` and is validated server-side against
 * the storage layer's own MIME and size rules: a `File` cannot be described by
 * a Zod schema that also has to run in the browser, and a client-side size
 * check is a courtesy, never the guard.
 */
export const uploadPhotoSchema = z.object({
  ...firmScoped,
  subject: z.enum(PHOTO_SUBJECTS),
  /** The member's or the dependant's id, per `subject`. */
  subjectId: z.string().min(1),
})

/** Clearing a photo. Same addressing, no file. */
export const removePhotoSchema = uploadPhotoSchema

export type UploadPhotoInput = z.infer<typeof uploadPhotoSchema>
export type PhotoSubject = (typeof PHOTO_SUBJECTS)[number]

/* ==========================================================================
 * Cotisations
 * ========================================================================== */

/**
 * Opening a new cotisation period. There is deliberately **no** update: a
 * change closes the current row and opens another (§11 Q6), so the only
 * mutation offered is the one that preserves the history.
 */
export const openContributionSchema = z.object({
  ...firmScoped,
  memberId: z.string().min(1),
  monthlyAmount: amountField.refine((value) => value !== null && value > 0, {
    message: "Montant requis.",
  }),
  employerAmount: amountField.optional(),
  employeeAmount: amountField.optional(),
  validFrom: dateField,
  reason: optionalText(200),
})

/* ==========================================================================
 * Formules et barèmes
 * ========================================================================== */

export const createPlanSchema = z.object({
  ...firmScoped,
  code: z
    .string()
    .trim()
    .min(2)
    .max(24)
    .regex(/^[A-Z0-9_-]+$/, "Lettres majuscules, chiffres, tiret."),
  name: z.string().trim().min(2).max(80),
  monthlyPrice: amountField.refine((value) => value !== null && value > 0, {
    message: "Prix mensuel requis.",
  }),
  validFrom: dateField,
})

export const updatePlanSchema = z.object({
  ...firmScoped,
  planId: z.string().min(1),
  name: z.string().trim().min(2).max(80),
  monthlyPrice: amountField.refine((value) => value !== null && value > 0, {
    message: "Prix mensuel requis.",
  }),
  active: z.boolean().default(true),
})

export const setPlanRateSchema = z.object({
  ...firmScoped,
  planId: z.string().min(1),
  categoryId: z.string().min(1),
  beneficiaryType: z.enum(BENEFICIARY_TYPES).default("ALL"),
  rate: rateField,
  ceilingPerAct: amountField.optional(),
  ceilingMonthly: amountField.optional(),
  ceilingAnnual: amountField.optional(),
  waitingPeriodDays: z.coerce.number().int().min(0).max(3650).default(0),
})

export const removePlanRateSchema = z.object({
  ...firmScoped,
  rateId: z.string().min(1),
})

export const setEmployerRateSchema = z.object({
  ...firmScoped,
  employerId: z.string().min(1),
  categoryId: z.string().min(1),
  beneficiaryType: z.enum(BENEFICIARY_TYPES).default("ALL"),
  rate: rateField,
  ceilingPerAct: amountField.optional(),
  ceilingMonthly: amountField.optional(),
  ceilingAnnual: amountField.optional(),
  /**
   * Absent means "keep the formule's" — see resolveRate. An empty form field
   * is absent too: coerced as-is it would become an explicit 0, which lifts
   * the formule's carence instead of keeping it.
   */
  waitingPeriodDays: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.coerce.number().int().min(0).max(3650).optional()
  ),
})

export const removeEmployerRateSchema = z.object({
  ...firmScoped,
  rateId: z.string().min(1),
})

/**
 * Plafonds particuliers. Ceilings only — a participant never gets a taux of
 * their own. An empty field means "inherit", so at least one must be set.
 */
export const setMemberCeilingSchema = z
  .object({
    ...firmScoped,
    memberId: z.string().min(1),
    categoryId: z.string().min(1, "Choisissez une catégorie."),
    ceilingPerAct: amountField.optional(),
    ceilingMonthly: amountField.optional(),
    ceilingAnnual: amountField.optional(),
    reason: z.string().trim().min(5, "Indiquez le motif.").max(300),
    validFrom: dateField,
  })
  .refine(
    (value) =>
      [value.ceilingPerAct, value.ceilingMonthly, value.ceilingAnnual].some(
        (ceiling) => ceiling !== null && ceiling !== undefined
      ),
    {
      message: "Renseignez au moins un plafond.",
      path: ["ceilingMonthly"],
    }
  )

export const endMemberCeilingSchema = z.object({
  ...firmScoped,
  ceilingId: z.string().min(1),
})

/* ==========================================================================
 * Référentiel
 * ========================================================================== */

export const createCategorySchema = z.object({
  ...firmScoped,
  code: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[A-Z0-9_]+$/, "Lettres majuscules, chiffres, tiret bas."),
  label: z.string().trim().min(2).max(80),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
})

export const updateCategorySchema = z.object({
  ...firmScoped,
  categoryId: z.string().min(1),
  label: z.string().trim().min(2).max(80),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  active: z.boolean().default(true),
})

export const createServiceTypeSchema = z.object({
  ...firmScoped,
  categoryId: z.string().min(1),
  code: z.string().trim().min(1).max(16),
  label: z.string().trim().min(2).max(120),
  accountCode: optionalText(20),
})

export const createSpecialtySchema = z.object({
  ...firmScoped,
  code: z.string().trim().min(1).max(16),
  label: z.string().trim().min(2).max(120),
  accountCode: optionalText(20),
})

export type CreateEmployerInput = z.infer<typeof createEmployerSchema>
export type CreateMemberInput = z.infer<typeof createMemberSchema>
export type CreateDependentInput = z.infer<typeof createDependentSchema>
export type OpenContributionInput = z.infer<typeof openContributionSchema>

/* ==========================================================================
 * Cartes
 * ========================================================================== */

export const generateCardSchema = z.object({
  ...firmScoped,
  memberId: z.string().min(1),
})

export const revokeCardSchema = z.object({
  ...firmScoped,
  memberId: z.string().min(1),
  reason: optionalText(200),
})

/* ==========================================================================
 * Prestataires et conventions
 * ========================================================================== */

export const PROVIDER_STATUSES = ["ACTIVE", "SUSPENDED", "TERMINATED"] as const
export const AGREEMENT_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "EXPIRED",
  "TERMINATED",
] as const
export const VOUCHER_TYPES = [
  "PHARMACY",
  "OPTICAL",
  "GUARANTEE",
  "HOSPITALIZATION",
] as const

const providerFields = {
  name: z.string().trim().min(2, "Nom requis.").max(160),
  specialtyId: z.string().min(1).or(z.literal("")).optional(),
  legacyCode: optionalText(20),
  accountCode: optionalText(20),
  address: optionalText(200),
  phone: optionalText(40),
  email: z.string().trim().email("Adresse e-mail invalide.").or(z.literal("")).optional(),
  /// Agréé pour le tiers payant — distinct from being an active counterparty.
  accredited: z.coerce.boolean().default(false),
  status: z.enum(PROVIDER_STATUSES).default("ACTIVE"),
  paymentTermDays: z.coerce.number().int().min(0).max(365).default(60),
  bankName: optionalText(120),
  bankAccount: optionalText(60),
}

export const createProviderSchema = z.object({ ...firmScoped, ...providerFields })

export const updateProviderSchema = z.object({
  ...firmScoped,
  ...providerFields,
  providerId: z.string().min(1),
})

export const createAgreementSchema = z.object({
  ...firmScoped,
  providerId: z.string().min(1),
  reference: z.string().trim().min(2).max(60),
  startDate: dateField,
  endDate: optionalDateField,
  /// Remise négociée, en pourcentage. Not a prise en charge rate.
  negotiatedRate: rateField.optional(),
  terms: optionalText(2000),
  status: z.enum(AGREEMENT_STATUSES).default("ACTIVE"),
})

/* ==========================================================================
 * Bons
 * ========================================================================== */

export const voucherLineSchema = z.object({
  medicalActId: z.string().min(1).or(z.literal("")).optional(),
  label: z.string().trim().min(1, "Libellé requis.").max(160),
  quantity: z.coerce.number().min(0.01).max(9999).default(1),
  unitPrice: amountField.refine((value) => value !== null && value >= 0, {
    message: "Prix unitaire requis.",
  }),
})

/**
 * Émission d'un bon.
 *
 * The total is **not** an input: it is the sum of the lines, computed on the
 * server. Accepting a total alongside lines invites the two to disagree, and
 * the one that decides what the institution pays would be whichever the code
 * happened to read.
 */
export const issueVoucherSchema = z.object({
  ...firmScoped,
  type: z.enum(VOUCHER_TYPES),
  memberId: z.string().min(1, "Sélectionnez un participant."),
  dependentId: z.string().min(1).or(z.literal("")).optional(),
  providerId: z.string().min(1, "Sélectionnez un prestataire."),
  serviceTypeId: z.string().min(1, "Sélectionnez une prestation."),
  issueDate: dateField,
  lines: z.array(voucherLineSchema).min(1, "Au moins une ligne."),
  /// Set by the operator to proceed despite a warning. Never past a refusal.
  acknowledgeWarnings: z.coerce.boolean().default(false),
})

/** Dry run: same input, no write. Powers the pre-flight in the form. */
export const previewVoucherSchema = issueVoucherSchema

export const settleVoucherSchema = z.object({
  ...firmScoped,
  voucherId: z.string().min(1),
  settledOn: dateField,
})

export const cancelVoucherSchema = z.object({
  ...firmScoped,
  voucherId: z.string().min(1),
  reason: z.string().trim().min(3, "Motif requis.").max(200),
})

/* ==========================================================================
 * Bon de pharmacie à montant différé — actions du gestionnaire
 * ========================================================================== */

/** Whole francs: FCFA has no subunit, and the domain refuses anything else. */
const pharmacyAmount = z.coerce
  .number({ message: "Montant requis." })
  .int("Montant en francs entiers.")
  .positive("Le montant doit être supérieur à zéro.")
  .max(100_000_000, "Montant trop élevé.")

const motive = z.string().trim().min(3, "Motif requis.").max(300)

/** Enter the amount on the pharmacy's behalf, or correct a validated one. */
export const voucherAmountSchema = z.object({
  ...firmScoped,
  voucherId: z.string().min(1),
  amount: pharmacyAmount,
  reason: motive,
})

export const voucherAmountPreviewSchema = z.object({
  ...firmScoped,
  voucherId: z.string().min(1),
  amount: pharmacyAmount,
})

export const voidVoucherSchema = z.object({
  ...firmScoped,
  voucherId: z.string().min(1),
  reason: motive,
})

/* ==========================================================================
 * Accès prestataire
 * ========================================================================== */

export const providerCredentialsSchema = z.object({
  ...firmScoped,
  providerId: z.string().min(1),
  /** The code prestataire. Defaults to the provider's legacy code. */
  code: z
    .string()
    .trim()
    .min(2, "Code requis.")
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, "Lettres, chiffres, tirets uniquement."),
})

export const providerAccountSchema = z.object({
  ...firmScoped,
  providerId: z.string().min(1),
})

export const providerAccountActiveSchema = providerAccountSchema.extend({
  active: z.boolean(),
})

/* ==========================================================================
 * Validation des bons du portail
 * ========================================================================== */

export const reviewPortalVoucherSchema = z.object({
  ...firmScoped,
  voucherId: z.string().min(1),
})

export const rejectPortalVoucherSchema = z.object({
  ...firmScoped,
  voucherId: z.string().min(1),
  // Shown to the participant as is, so it has to say something.
  reason: z.string().trim().min(5, "Expliquez le refus au participant.").max(300),
})

/* ==========================================================================
 * Accès au portail
 * ========================================================================== */

/**
 * Who to open the portal to: listed ids, or everything the list currently
 * matches minus the rows unticked — the bulk bar's two kinds of selection. The
 * filters are the list's own, so the action counts what the list counted.
 */
export const grantPortalAccessSchema = z
  .object({
    ...firmScoped,
    memberIds: z.array(z.string().min(1)).max(1000).optional(),
    matching: memberQuerySchema
      .pick({ search: true, status: true, employerId: true, withDependents: true, portal: true })
      .optional(),
    excludeIds: z.array(z.string().min(1)).max(1000).default([]),
  })
  .refine((input) => Boolean(input.memberIds?.length) !== Boolean(input.matching), {
    message: "Sélection invalide.",
  })

export const portalAccountSchema = z.object({
  ...firmScoped,
  memberId: z.string().min(1),
})

/* ==========================================================================
 * Décaissements
 * ========================================================================== */

export const PROVIDER_INVOICE_DECISIONS = [
  "CHECKED",
  "APPROVED",
  "REJECTED",
] as const

export const checkProviderInvoiceSchema = z
  .object({
    ...firmScoped,
    invoiceId: z.string().min(1),
    decision: z.enum(PROVIDER_INVOICE_DECISIONS),
    rejectReason: optionalText(200),
  })
  // A rejection without a reason tells the prestataire nothing and leaves the
  // écart unexplained, so the schema refuses it rather than the handler.
  .refine(
    (value) =>
      value.decision !== "REJECTED" || Boolean(value.rejectReason?.trim()),
    { message: "Un rejet doit être motivé.", path: ["rejectReason"] }
  )

export const reviewReimbursementSchema = z
  .object({
    ...firmScoped,
    reimbursementId: z.string().min(1),
    decision: z.enum(["APPROVED", "REJECTED"]),
    rejectReason: optionalText(200),
  })
  .refine(
    (value) =>
      value.decision !== "REJECTED" || Boolean(value.rejectReason?.trim()),
    { message: "Un rejet doit être motivé.", path: ["rejectReason"] }
  )

export const visaDisbursementSchema = z.object({
  ...firmScoped,
  disbursementId: z.string().min(1),
  visa: z.enum(["DIRECTION", "COMPTABILITE", "RECEPTION"]),
})

export const JOURNAL_CODES = ["B1", "02", "OM"] as const
export const PAYMENT_METHODS = [
  "CHEQUE",
  "TRANSFER",
  "CASH",
  "ORANGE_MONEY",
] as const

/**
 * Éditer une facture prestataire à partir de la consommation.
 *
 * The other direction from `recordProviderInvoiceSchema`: instead of typing
 * what a provider claims and looking for the écart, the institution bills its
 * own figures. The period is the whole input — the lines are the bons that
 * were actually settled there and not yet invoiced, which is not something a
 * form can be trusted to restate.
 */
export const providerPeriodSchema = z
  .object({
    ...firmScoped,
    providerId: z.string().min(1, "Sélectionnez un prestataire."),
    periodFrom: dateField,
    periodTo: dateField,
  })
  .refine((value) => value.periodTo >= value.periodFrom, {
    message: "La période se termine avant de commencer.",
    path: ["periodTo"],
  })

/** Dry run: the same period, the lines it would bill, no write. */
export const previewProviderInvoiceSchema = providerPeriodSchema

export const generateProviderInvoiceSchema = providerPeriodSchema

/**
 * Transformer une facture approuvée en bon de décaissement.
 *
 * Everything the bon needs that is not already on the facture: which journal
 * the entry lands in, how it is paid, and when. The payee, the amount and the
 * motif are derived — a form that let an operator retype the amount next to an
 * invoice is a form where the two eventually disagree.
 */
export const disbursementFromInvoiceSchema = z.object({
  ...firmScoped,
  invoiceId: z.string().min(1),
  journalCode: z.enum(JOURNAL_CODES),
  date: dateField,
  paymentMethod: z.enum(PAYMENT_METHODS),
  paymentReference: optionalText(60),
})

/* ==========================================================================
 * Factures employeur
 * ========================================================================== */

export const INVOICE_STATUSES = [
  "DRAFT",
  "ISSUED",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "CANCELLED",
] as const

/**
 * Statut d'une facture employeur, et le règlement qui l'explique.
 *
 * §4.8ter: a "réglée" with no trace of who entered it has no evidential
 * value, so the figure, the mode and the référence travel with the status
 * change rather than being patched in afterwards.
 *
 * A partial payment without an amount is the one combination that means
 * nothing at all, so the schema refuses it on the field.
 */
export const setInvoiceStatusSchema = z
  .object({
    ...firmScoped,
    invoiceId: z.string().min(1),
    status: z.enum(INVOICE_STATUSES),
    paidAmount: amountField.optional(),
    paymentMethod: optionalText(40),
    paymentReference: optionalText(60),
  })
  .refine(
    (value) => value.status !== "PARTIALLY_PAID" || value.paidAmount != null,
    {
      message: "Indiquez le montant déjà réglé.",
      path: ["paidAmount"],
    }
  )
