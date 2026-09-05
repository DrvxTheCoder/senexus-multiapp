"use server"

import { compare, hash } from "bcryptjs"

import {
  changeOwnPasswordSchema,
  updateProfileSchema,
} from "@/lib/forms/profile-schema"
import { ActionError, sessionAction } from "@/server/actions/define-action"

/**
 * A user acting on their own account.
 *
 * The legacy application had **no self-service anything**: no profile page, no
 * way to change your own password. The only route was an admin opening the
 * users table and resetting it — and that endpoint had no ownership or role
 * check at all, so any signed-in user could reset anyone's password.
 */

/** bcrypt cost 10, matching every existing hash in the database. */
const BCRYPT_COST = 10

export const updateProfile = sessionAction({
  input: updateProfileSchema,
  revalidate: "/",
  handler: async ({ input, userId, tx, audit }) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        name: input.name,
        ...(input.image !== undefined ? { image: input.image || null } : {}),
      },
    })

    await audit({
      action: "UPDATE",
      entity: "USER",
      entityId: userId,
      metadata: { self: true, fields: ["name", "image"] },
    })
  },
})

export const changeOwnPassword = sessionAction({
  input: changeOwnPasswordSchema,
  handler: async ({ input, userId, tx, audit }) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    })

    if (!user?.passwordHash) {
      throw new ActionError(
        "Ce compte n'utilise pas de mot de passe. Contactez un administrateur."
      )
    }

    // Proving knowledge of the current password is what makes this safe to
    // expose to the account holder: a hijacked session cannot silently change
    // the password and lock the owner out.
    const valid = await compare(input.currentPassword, user.passwordHash)
    if (!valid) {
      throw new ActionError("Mot de passe actuel incorrect.", {
        currentPassword: ["Mot de passe actuel incorrect."],
      })
    }

    await tx.user.update({
      where: { id: userId },
      data: { passwordHash: await hash(input.newPassword, BCRYPT_COST) },
    })

    // The new password is never logged, only the fact of the change.
    await audit({
      action: "UPDATE",
      entity: "USER",
      entityId: userId,
      metadata: { action: "password_change", self: true },
    })
  },
})
