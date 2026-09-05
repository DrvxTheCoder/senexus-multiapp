import { z } from "zod"

import { passwordField } from "@/lib/forms/profile-schema"

/**
 * Administration form schemas — isomorphic, parsed by both the dialog and the
 * server action.
 */

/* ==========================================================================
 * Firms
 * ========================================================================== */

/** A slug is a URL segment, so it is constrained rather than merely trimmed. */
export const slugField = z
  .string()
  .trim()
  .min(2, "L'identifiant doit contenir au moins 2 caractères.")
  .max(48)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Minuscules, chiffres et tirets uniquement."
  )

export const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * The four presets the legacy dialog offered, kept for continuity, but stored
 * as **hex** rather than as a theme slug.
 *
 * `Firm.themeColor` was overloaded in the old app: the dialog wrote slugs
 * (`blue`), the seed wrote hex (`#3b82f6`), and the firm list rendered whatever
 * it found as a CSS colour. A seeded firm therefore failed validation the first
 * time anyone edited it. Writing hex everywhere ends that, and
 * `buildFirmTheme` already reads both forms so existing rows keep working.
 */
export const THEME_PRESETS = [
  { label: "Vert Senexus", value: "#0b5d53" },
  { label: "Bleu", value: "#2563eb" },
  { label: "Vert", value: "#16a34a" },
  { label: "Ambre", value: "#d97706" },
  { label: "Ardoise", value: "#334155" },
] as const

export const firmSchema = z.object({
  name: z.string().trim().min(2, "Le nom est requis.").max(120),
  slug: slugField,
  logo: z.string().url("URL de logo invalide.").or(z.literal("")).optional(),
  themeColor: z
    .string()
    .regex(HEX_COLOR, "Couleur hexadécimale attendue, par exemple #0B5D53.")
    .or(z.literal(""))
    .optional(),
  /**
   * Prefix for generated matricules in this firm, e.g. `CI` or `SP`. Stored in
   * `FirmModule.settings` on the HR module — the schema's own JSON extension
   * point — because there is no column for it and the schema is frozen.
   */
  matriculePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{1,4}$/, "1 à 4 lettres, par exemple CI ou SP.")
    .or(z.literal(""))
    .optional(),
})

export type FirmInput = z.infer<typeof firmSchema>

export const createFirmSchema = firmSchema
export const updateFirmSchema = firmSchema.extend({ id: z.string().min(1) })

/**
 * Deleting a firm cascades through every employee, contract, document and
 * audit row it owns. Retyping the name is the confirmation — a dialog with a
 * red button is not enough friction for an irreversible cascade.
 */
export const deleteFirmSchema = z.object({
  id: z.string().min(1),
  confirmName: z.string().min(1, "Saisissez le nom de l'entreprise."),
})

/**
 * The dialog's half of the schemas above.
 *
 * A dialog collects fewer fields than its action takes — no `id`, no `userId` —
 * and the temptation is to write `actionSchema.omit({ id: true })` at the call
 * site. Two reasons not to: zod refuses `.omit()` outright on a refined object,
 * and a schema built inside a component is never exercised until someone opens
 * that dialog. Declared here, they are covered by the schema tests.
 */
export const deleteFirmFormSchema = deleteFirmSchema.omit({ id: true })

/* ==========================================================================
 * Users
 * ========================================================================== */

export const USER_ROLES = [
  "OWNER",
  "ADMIN",
  "MANAGER",
  "RESPONSABLE",
  "STAFF",
  "VIEWER",
] as const

export const userBaseSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis.").max(120),
  email: z.string().trim().toLowerCase().email("Adresse email invalide."),
  image: z.string().url().or(z.literal("")).optional(),
  // RESPONSABLE is in the database enum but was missing from every legacy form,
  // so the only way to grant it was direct SQL — even though it is the role the
  // whole client-scoped visibility model depends on.
  role: z.enum(USER_ROLES),
  firmIds: z.array(z.string()).min(1, "Au moins une entreprise est requise."),
  employeeId: z.string().optional(),
})

/**
 * The password pair, refined so a mismatch lands on the confirmation field.
 *
 * Declared separately from `resetPasswordSchema` rather than derived from it:
 * zod refuses `.omit()` on a refined object, so a dialog that only collects the
 * two passwords cannot strip the `id` off the action's schema. Both are built
 * from the same field and the same refinement instead.
 */
const PASSWORD_MISMATCH = {
  message: "Les mots de passe ne correspondent pas.",
  path: ["confirmPassword"],
}

const passwordsMatch = (values: {
  password: string
  confirmPassword: string
}) => values.password === values.confirmPassword

export const passwordPairSchema = z
  .object({
    password: passwordField,
    confirmPassword: z.string(),
  })
  .refine(passwordsMatch, PASSWORD_MISMATCH)

export const resetPasswordSchema = z
  .object({
    id: z.string().min(1),
    password: passwordField,
    confirmPassword: z.string(),
  })
  .refine(passwordsMatch, PASSWORD_MISMATCH)

export type PasswordPairInput = z.infer<typeof passwordPairSchema>

export const createUserSchema = userBaseSchema
  .extend({
    password: passwordField,
    confirmPassword: z.string(),
  })
  .refine(
    (values) => values.password === values.confirmPassword,
    PASSWORD_MISMATCH
  )

export const updateUserSchema = userBaseSchema.extend({ id: z.string().min(1) })

export const deleteUserSchema = z.object({ id: z.string().min(1) })

export type CreateUserInput = z.infer<typeof createUserSchema>
export type UpdateUserInput = z.infer<typeof updateUserSchema>

/* ==========================================================================
 * Client assignments — what makes RESPONSABLE mean anything
 * ========================================================================== */

export const clientAssignmentSchema = z.object({
  userId: z.string().min(1),
  firmId: z.string().min(1),
  clientIds: z.array(z.string()),
})

/** The dialog picks the clients; the user and the firm come from its props. */
export const clientAssignmentFormSchema = clientAssignmentSchema.omit({
  userId: true,
  firmId: true,
})

/* ==========================================================================
 * Modules
 * ========================================================================== */

export const moduleSchema = z.object({
  slug: slugField,
  name: z.string().trim().min(2, "Le nom est requis.").max(80),
  description: z.string().trim().max(280).optional(),
  // Required rather than `.default("1.0.0")`: a zod default makes the schema's
  // input and output types diverge, which react-hook-form's resolver refuses to
  // reconcile. The dialog pre-fills the field instead, which is the same thing
  // from the user's side.
  version: z
    .string()
    .trim()
    .regex(/^\d+\.\d+\.\d+$/, "Version au format 1.0.0."),
  basePath: z
    .string()
    .trim()
    .regex(/^\/[a-z0-9-]*$/, "Chemin commençant par /, par exemple /documents."),
  icon: z.string().trim().max(60).optional(),
})

export const updateModuleSchema = moduleSchema.partial().extend({
  id: z.string().min(1),
  isActive: z.boolean().optional(),
})

export const firmModuleSchema = z.object({
  firmId: z.string().min(1),
  moduleId: z.string().min(1),
  /** `null` uninstalls; a boolean installs or toggles. */
  isEnabled: z.boolean().nullable(),
})

export type ModuleInput = z.infer<typeof moduleSchema>
