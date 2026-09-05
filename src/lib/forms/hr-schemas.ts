import { z } from "zod"

/**
 * HR form schemas — isomorphic, parsed by both the dialog and the server
 * action, so the two cannot disagree about what is required.
 *
 * Dates travel as `YYYY-MM-DD` strings, which is what `<input type="date">`
 * produces and what a CSV import normalises to. They are turned into `Date` at
 * the edge of the action, at **noon UTC**, so a value never slips to the
 * previous day when the server and the browser sit in different offsets —
 * Dakar is UTC+0 but the deployment need not be.
 */

/* ==========================================================================
 * Shared fields
 * ========================================================================== */

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export const dateField = z
  .string()
  .trim()
  .regex(ISO_DATE, "Date attendue au format AAAA-MM-JJ.")

/** An optional date: absent, or a real one. An empty string means absent. */
export const optionalDateField = dateField.or(z.literal("")).optional()

/**
 * Turns a form date into a `Date` at noon UTC.
 *
 * Midnight is the tempting choice and the wrong one: a `DATE`-like value
 * rendered in a timezone behind UTC shows the day before. Noon has eleven
 * hours of slack in each direction.
 */
export function toDate(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`)
}

export function toOptionalDate(value: string | null | undefined): Date | null {
  return value ? toDate(value) : null
}

/** Formats a `Date` back into the string an `<input type="date">` expects. */
export function toDateInput(value: Date | null | undefined): string {
  if (!value) return ""
  return value.toISOString().slice(0, 10)
}

/**
 * FCFA has no subunit (Q11), so an amount is a whole number of francs. The
 * column is `Decimal(10,2)` and stays that way — the schema is frozen — but
 * nothing this application writes ever carries centimes.
 */
export const amountField = z
  .union([z.number(), z.string()])
  .transform((value) =>
    typeof value === "number" ? value : value.trim().replace(/\s/g, "")
  )
  .refine((value) => value === "" || /^\d+$/.test(String(value)), {
    message: "Montant en francs, sans décimales.",
  })
  .transform((value) => (value === "" ? null : Number(value)))
  .refine((value) => value === null || value <= 99_999_999, {
    message: "Montant trop élevé.",
  })

const optionalText = (max = 200) =>
  z.string().trim().max(max).or(z.literal("")).optional()

const firmScoped = { firmSlug: z.string().min(1) }

/* ==========================================================================
 * Employees
 * ========================================================================== */

export const EMPLOYEE_STATUSES = [
  "ACTIVE",
  "ON_LEAVE",
  "INACTIVE",
  "SUSPENDED",
  "TERMINATED",
] as const

export const GENDERS = ["MALE", "FEMALE", "OTHER"] as const

export const CONTRACT_TYPES = [
  "CDI",
  "CDD",
  "INTERIM",
  "STAGE",
  "PRESTATION",
] as const

/** Step 1 of the wizard: who the person is. */
export const employeePersonalSchema = z.object({
  firstName: z.string().trim().min(1, "Le prénom est requis.").max(80),
  lastName: z.string().trim().min(1, "Le nom est requis.").max(80),
  dateOfBirth: optionalDateField,
  placeOfBirth: optionalText(120),
  gender: z.enum(GENDERS).or(z.literal("")).optional(),
  maritalStatus: optionalText(40),
  nationality: optionalText(60),
  cni: optionalText(40),
  fatherName: optionalText(120),
  motherName: optionalText(120),
  phone: optionalText(40),
  email: z.string().trim().toLowerCase().email().or(z.literal("")).optional(),
  address: optionalText(240),
  photoUrl: z.string().url().or(z.literal("")).optional(),
})

/** Step 2: what they do here. */
export const employeeProfessionalSchema = z.object({
  hireDate: dateField,
  jobTitle: optionalText(120),
  category: optionalText(60),
  departmentId: z.string().or(z.literal("")).optional(),
  assignedClientId: z.string().or(z.literal("")).optional(),
  status: z.enum(EMPLOYEE_STATUSES),
  netSalary: amountField.optional(),
  contractEndDate: optionalDateField,
  /**
   * The matricule is generated per firm and is not asked for. It is accepted
   * only from the CSV import, where existing numbers must be preserved.
   */
  matricule: z
    .string()
    .trim()
    .toUpperCase()
    .max(20)
    .or(z.literal(""))
    .optional(),
})

export const createEmployeeSchema = z
  .object({
    ...firmScoped,
    ...employeePersonalSchema.shape,
    ...employeeProfessionalSchema.shape,
    /**
     * Creating an employee creates their first contract in the same
     * transaction — the legacy rule, kept. This is the only field of that
     * contract the wizard asks for; everything else is derived.
     */
    contractType: z.enum(CONTRACT_TYPES),
  })
  .refine(
    (values) =>
      !values.contractEndDate || values.contractEndDate >= values.hireDate,
    {
      message: "La fin de contrat ne peut pas précéder l'embauche.",
      path: ["contractEndDate"],
    }
  )

export const updateEmployeeSchema = z.object({
  ...firmScoped,
  id: z.string().min(1),
  ...employeePersonalSchema.shape,
  ...employeeProfessionalSchema.shape,
  /**
   * Editing an employee can desynchronise the active contract — the legacy app
   * did it silently. This says explicitly whether the contract follows.
   */
  syncActiveContract: z.boolean().optional(),
})

export const deleteEmployeeSchema = z.object({
  ...firmScoped,
  id: z.string().min(1),
  confirmMatricule: z.string().trim().min(1, "Saisissez le matricule."),
})

export type EmployeeInput = z.infer<typeof createEmployeeSchema>
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>

/* ==========================================================================
 * Contracts
 * ========================================================================== */

const contractBaseSchema = z.object({
  employeeId: z.string().min(1, "Sélectionnez un employé."),
  type: z.enum(CONTRACT_TYPES),
  startDate: dateField,
  endDate: optionalDateField,
  clientId: z.string().or(z.literal("")).optional(),
  position: optionalText(120),
  salary: amountField.optional(),
  workingHours: z
    .union([z.number(), z.string()])
    .transform((value) => (value === "" || value === null ? null : Number(value)))
    .refine((value) => value === null || (value >= 1 && value <= 80), {
      message: "Entre 1 et 80 heures.",
    })
    .optional(),
  trialPeriodEnd: optionalDateField,
  alertThreshold: z.coerce.number().int().min(0).max(365),
  isAutoRenewal: z.boolean(),
  isVise: z.boolean(),
  notes: optionalText(500),
})

/**
 * The two order checks live here rather than inside the object so that the
 * firm-scoped variants below can extend the shape: zod refuses `.extend()` on
 * a refined schema, the same rule that broke `resetPasswordSchema.omit()`.
 */
const orderChecks = <T extends z.ZodType<{
  startDate: string
  endDate?: string
  trialPeriodEnd?: string
}>>(schema: T) =>
  schema
    .refine((values) => !values.endDate || values.endDate >= values.startDate, {
      message: "La fin ne peut pas précéder le début.",
      path: ["endDate"],
    })
    .refine(
      (values) =>
        !values.trialPeriodEnd || values.trialPeriodEnd >= values.startDate,
      {
        message: "La période d'essai ne peut pas précéder le début.",
        path: ["trialPeriodEnd"],
      }
    )

export const contractFormSchema = orderChecks(contractBaseSchema)

export const createContractSchema = orderChecks(
  contractBaseSchema.extend(firmScoped)
)

export const updateContractSchema = orderChecks(
  contractBaseSchema.extend({ ...firmScoped, id: z.string().min(1) })
)

export const terminateContractSchema = z.object({
  ...firmScoped,
  id: z.string().min(1),
  terminationDate: dateField,
  terminationReason: z
    .string()
    .trim()
    .min(3, "Indiquez le motif de la résiliation.")
    .max(300),
})

export const renewContractSchema = z.object({
  ...firmScoped,
  id: z.string().min(1),
  durationDays: z.coerce
    .number()
    .int()
    .min(1, "Au moins un jour.")
    .max(1095, "Trois ans au plus."),
})

export const stampVisaSchema = z.object({
  ...firmScoped,
  ids: z.array(z.string()).min(1, "Sélectionnez au moins un contrat."),
  isVise: z.boolean(),
})

export type ContractFormInput = z.infer<typeof contractFormSchema>

/* ==========================================================================
 * Documents
 * ========================================================================== */

export const DOCUMENT_TYPES = [
  "CV",
  "ID_CARD",
  "PASSPORT",
  "CONTRACT",
  "PAYSLIP",
  "CERTIFICATE",
  "DIPLOMA",
  "MEDICAL_CERTIFICATE",
  "LEGAL_DOCUMENT",
  "MISSION_REPORT",
  "EXPENSE_RECEIPT",
  "OTHER",
] as const

/** 2 MB per file and 100 MB per employee, as the legacy uploader enforced. */
export const DOCUMENT_MAX_BYTES = 2 * 1024 * 1024
export const EMPLOYEE_QUOTA_BYTES = 100 * 1024 * 1024

export const uploadDocumentSchema = z.object({
  ...firmScoped,
  employeeId: z.string().min(1),
  documentType: z.enum(DOCUMENT_TYPES),
  description: optionalText(240),
  expiryDate: optionalDateField,
  file: z
    .instanceof(File, { message: "Sélectionnez un fichier." })
    .refine((file) => file.size > 0, "Le fichier est vide.")
    .refine(
      (file) => file.size <= DOCUMENT_MAX_BYTES,
      `Fichier trop volumineux (2 Mo maximum).`
    ),
})

export const documentIdSchema = z.object({
  ...firmScoped,
  id: z.string().min(1),
})

export const verifyDocumentSchema = z.object({
  ...firmScoped,
  id: z.string().min(1),
  isVerified: z.boolean(),
})

/* ==========================================================================
 * Leaves
 * ========================================================================== */

export const LEAVE_TYPES = [
  "ANNUAL",
  "SICK",
  "MATERNITY",
  "PATERNITY",
  "UNPAID",
  "SPECIAL",
  "COMPENSATORY",
] as const

/** The statutory annual entitlement the legacy app assumed. */
export const DEFAULT_ANNUAL_DAYS = 20

export const requestLeaveSchema = z
  .object({
    ...firmScoped,
    employeeId: z.string().min(1, "Sélectionnez un employé."),
    leaveType: z.enum(LEAVE_TYPES),
    startDate: dateField,
    endDate: dateField,
    isPaid: z.boolean(),
    reason: optionalText(300),
  })
  .refine((values) => values.endDate >= values.startDate, {
    message: "La fin ne peut pas précéder le début.",
    path: ["endDate"],
  })

export const approveLeaveSchema = z.object({
  ...firmScoped,
  id: z.string().min(1),
})

export const rejectLeaveSchema = z.object({
  ...firmScoped,
  id: z.string().min(1),
  rejectionReason: z
    .string()
    .trim()
    .min(3, "Indiquez le motif du refus.")
    .max(300),
})

export const rolloverLeaveSchema = z.object({
  ...firmScoped,
  year: z.coerce.number().int().min(2000).max(2100),
  /** Days a balance may carry into the next year. */
  maxCarryOver: z.coerce.number().int().min(0).max(60),
})

/* ==========================================================================
 * Clients
 * ========================================================================== */

export const CLIENT_STATUSES = ["ACTIVE", "PROSPECT", "INACTIVE", "ARCHIVED"] as const

export const clientFormSchema = z.object({
  name: z.string().trim().min(2, "Le nom est requis.").max(160),
  status: z.enum(CLIENT_STATUSES),
  contactName: optionalText(120),
  contactEmail: z.string().trim().toLowerCase().email().or(z.literal("")).optional(),
  contactPhone: optionalText(40),
  taxNumber: optionalText(40),
  industry: optionalText(80),
  address: optionalText(240),
  contractStartDate: optionalDateField,
  contractEndDate: optionalDateField,
  notes: optionalText(500),
})

export const createClientSchema = z.object({
  ...firmScoped,
  ...clientFormSchema.shape,
})

export const updateClientSchema = z.object({
  ...firmScoped,
  id: z.string().min(1),
  ...clientFormSchema.shape,
})

/**
 * Clients are archived, never deleted: contracts and employees reference them,
 * and a deletion would either fail on the foreign key or take history with it.
 */
export const archiveClientSchema = z.object({
  ...firmScoped,
  id: z.string().min(1),
})

export type ClientFormInput = z.infer<typeof clientFormSchema>

/* ==========================================================================
 * Transfers
 * ========================================================================== */

export const requestTransferSchema = z
  .object({
    ...firmScoped,
    employeeId: z.string().min(1, "Sélectionnez un employé."),
    toFirmId: z.string().min(1, "Sélectionnez l'entreprise de destination."),
    transferDate: dateField,
    effectiveDate: dateField,
    reason: z.string().trim().min(3, "Indiquez le motif.").max(400),
    clientId: z.string().or(z.literal("")).optional(),
    /**
     * The legacy dialog had this checkbox and never sent it, so completion
     * moved the employee and left them with no contract at all.
     */
    createDestinationContract: z.boolean(),
    contractType: z.enum(CONTRACT_TYPES),
    notes: optionalText(400),
  })
  .refine((values) => values.effectiveDate >= values.transferDate, {
    message: "La prise d'effet ne peut pas précéder la demande.",
    path: ["effectiveDate"],
  })

export const bulkTransferSchema = z
  .object({
    ...firmScoped,
    employeeIds: z.array(z.string()).min(1, "Sélectionnez au moins un employé."),
    toFirmId: z.string().min(1),
    transferDate: dateField,
    effectiveDate: dateField,
    reason: z.string().trim().min(3, "Indiquez le motif.").max(400),
    clientId: z.string().or(z.literal("")).optional(),
    createDestinationContract: z.boolean(),
    contractType: z.enum(CONTRACT_TYPES),
  })
  .refine((values) => values.effectiveDate >= values.transferDate, {
    message: "La prise d'effet ne peut pas précéder la demande.",
    path: ["effectiveDate"],
  })

export const transferIdSchema = z.object({
  ...firmScoped,
  id: z.string().min(1),
})

export const rejectTransferSchema = z.object({
  ...firmScoped,
  id: z.string().min(1),
  rejectionReason: z
    .string()
    .trim()
    .min(3, "Indiquez le motif du refus.")
    .max(300),
})

/* ==========================================================================
 * CSV import
 * ========================================================================== */

export const importEmployeesSchema = z.object({
  ...firmScoped,
  file: z
    .instanceof(File, { message: "Sélectionnez un fichier CSV." })
    .refine((file) => file.size > 0, "Le fichier est vide.")
    .refine((file) => file.size <= 5 * 1024 * 1024, "5 Mo maximum."),
  /** Ambiguous dates such as 03/04/2024 are read day-first by default. */
  dayFirst: z.boolean(),
  /** Rows matching an existing employee on enough fields are skipped. */
  skipDuplicates: z.boolean(),
  contractType: z.enum(CONTRACT_TYPES),
})
