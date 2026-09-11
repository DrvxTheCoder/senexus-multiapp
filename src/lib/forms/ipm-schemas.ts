import { z } from "zod"

import {
  amountField,
  dateField,
  optionalDateField,
} from "@/lib/forms/hr-schemas"

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
 * A taux, entered as a percentage and stored as a fraction.
 *
 * The conversion happens here rather than in the action, so every caller —
 * form, import, seed check — converts identically. A value above 100 is
 * refused: the institution cannot cover more than the bill.
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
    gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
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
    gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
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
    gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
  }),
})

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
  /** Absent means "keep the formule's" — see resolveRate. */
  waitingPeriodDays: z.coerce.number().int().min(0).max(3650).optional(),
})

export const removeEmployerRateSchema = z.object({
  ...firmScoped,
  rateId: z.string().min(1),
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
