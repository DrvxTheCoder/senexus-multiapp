import { describe, expect, it } from "vitest"

import {
  PASSWORD_MIN,
  changeOwnPasswordSchema,
  updateProfileSchema,
} from "@/lib/forms/profile-schema"

/**
 * These schemas are the single definition the form and the server action both
 * parse. The legacy app validated at 6 characters in the browser and 8 on the
 * server, so a 7-character password passed the form and then failed with an
 * unexplained error — the class of bug one shared schema removes.
 */

const valid = {
  currentPassword: "ancien-mot-de-passe",
  newPassword: "nouveau-mot-de-passe",
  confirmPassword: "nouveau-mot-de-passe",
}

function errorsFor(input: Record<string, unknown>) {
  const result = changeOwnPasswordSchema.safeParse(input)
  if (result.success) return {}
  const byField: Record<string, string[]> = {}
  for (const issue of result.error.issues) {
    ;(byField[issue.path.join(".")] ??= []).push(issue.message)
  }
  return byField
}

describe("changeOwnPasswordSchema", () => {
  it("accepts a well-formed change", () => {
    expect(changeOwnPasswordSchema.safeParse(valid).success).toBe(true)
  })

  it("rejects a new password below the minimum, and says so on that field", () => {
    const errors = errorsFor({
      ...valid,
      newPassword: "a".repeat(PASSWORD_MIN - 1),
      confirmPassword: "a".repeat(PASSWORD_MIN - 1),
    })
    expect(errors.newPassword?.[0]).toContain(String(PASSWORD_MIN))
  })

  it("accepts exactly the minimum length", () => {
    const password = "a".repeat(PASSWORD_MIN)
    const result = changeOwnPasswordSchema.safeParse({
      ...valid,
      newPassword: password,
      confirmPassword: password,
    })
    expect(result.success).toBe(true)
  })

  it("reports a mismatch on the confirmation field, not the new password", () => {
    const errors = errorsFor({ ...valid, confirmPassword: "autre-chose-encore" })
    expect(errors.confirmPassword).toBeDefined()
    expect(errors.newPassword).toBeUndefined()
  })

  it("refuses a new password identical to the current one", () => {
    const errors = errorsFor({
      currentPassword: "meme-mot-de-passe",
      newPassword: "meme-mot-de-passe",
      confirmPassword: "meme-mot-de-passe",
    })
    expect(errors.newPassword).toBeDefined()
  })

  it("requires the current password, so a hijacked session cannot lock the owner out", () => {
    const errors = errorsFor({ ...valid, currentPassword: "" })
    expect(errors.currentPassword).toBeDefined()
  })
})

describe("updateProfileSchema", () => {
  it("requires a name", () => {
    expect(updateProfileSchema.safeParse({ name: "   " }).success).toBe(false)
  })

  it("trims the name", () => {
    const result = updateProfileSchema.parse({ name: "  Paul Flan  " })
    expect(result.name).toBe("Paul Flan")
  })

  it("allows an empty image, which means 'no photo'", () => {
    expect(updateProfileSchema.safeParse({ name: "Paul", image: "" }).success).toBe(
      true
    )
  })

  it("rejects a non-URL image", () => {
    expect(
      updateProfileSchema.safeParse({ name: "Paul", image: "not-a-url" }).success
    ).toBe(false)
  })
})
