import { z } from "zod"

/**
 * Isomorphic form schemas — the client form and the server action parse with
 * the *same* object.
 *
 * The legacy app validated passwords at 6 characters in the wizard and 8 on the
 * server, so a 7-character password passed the form and then failed with a
 * generic error. One definition makes that class of bug impossible.
 */

export const PASSWORD_MIN = 8

export const passwordField = z
  .string()
  .min(PASSWORD_MIN, `Le mot de passe doit contenir au moins ${PASSWORD_MIN} caractères.`)

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis.").max(120),
  /** Uploaded URL, `""` to remove, absent to leave alone. */
  image: z.string().url("URL d'image invalide.").or(z.literal("")).nullish(),
  /**
   * Sa propre signature.
   *
   * Self-service on purpose: a signature is the one thing on this account that
   * nobody else should be setting, and it is what the visas on a bon de
   * décaissement print.
   */
  signatureUrl: z
    .string()
    .url("URL de signature invalide.")
    .or(z.literal(""))
    .nullish(),
})

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>

export const changeOwnPasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Mot de passe actuel requis."),
    newPassword: passwordField,
    confirmPassword: z.string().min(1, "Confirmation requise."),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: "Les mots de passe ne correspondent pas.",
    path: ["confirmPassword"],
  })
  .refine((values) => values.newPassword !== values.currentPassword, {
    message: "Le nouveau mot de passe doit être différent de l'actuel.",
    path: ["newPassword"],
  })

export type ChangeOwnPasswordInput = z.infer<typeof changeOwnPasswordSchema>
