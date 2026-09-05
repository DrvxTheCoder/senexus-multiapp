import { describe, expect, it } from "vitest"

import {
  clientAssignmentFormSchema,
  createFirmSchema,
  createUserSchema,
  deleteFirmFormSchema,
  firmModuleSchema,
  moduleSchema,
  passwordPairSchema,
  resetPasswordSchema,
  slugField,
  userBaseSchema,
  USER_ROLES,
} from "@/lib/forms/admin-schemas"

/**
 * These schemas are the *only* definition of what the admin console accepts:
 * the dialog and the server action both parse against them. The tests below
 * pin the rules the legacy app got wrong by having two definitions.
 */

describe("slugField", () => {
  it("accepts a kebab-case URL segment", () => {
    expect(slugField.parse(" connect-interim ")).toBe("connect-interim")
  })

  it.each(["Connect", "connect_interim", "-ci", "ci-", "c", "connect interim"])(
    "rejects %j",
    (value) => {
      expect(slugField.safeParse(value).success).toBe(false)
    }
  )
})

describe("createFirmSchema", () => {
  const base = { name: "Connect Interim", slug: "connect-interim" }

  it("accepts a firm with no logo, theme or prefix", () => {
    expect(createFirmSchema.parse(base)).toMatchObject(base)
  })

  it("requires hex for themeColor, not a theme name", () => {
    // The legacy dialog wrote slugs ("blue") while the seed wrote hex, so a
    // seeded firm failed validation the first time anyone edited it.
    expect(createFirmSchema.safeParse({ ...base, themeColor: "blue" }).success).toBe(
      false
    )
    expect(
      createFirmSchema.safeParse({ ...base, themeColor: "#0B5D53" }).success
    ).toBe(true)
  })

  it("uppercases the matricule prefix and caps it at four letters", () => {
    expect(
      createFirmSchema.parse({ ...base, matriculePrefix: "ci" }).matriculePrefix
    ).toBe("CI")
    expect(
      createFirmSchema.safeParse({ ...base, matriculePrefix: "CI1" }).success
    ).toBe(false)
    expect(
      createFirmSchema.safeParse({ ...base, matriculePrefix: "ABCDE" }).success
    ).toBe(false)
  })

  it("treats an empty prefix as 'leave it alone'", () => {
    expect(createFirmSchema.safeParse({ ...base, matriculePrefix: "" }).success).toBe(
      true
    )
  })
})

describe("createUserSchema", () => {
  const base = {
    name: "Awa Ndiaye",
    email: " Awa.Ndiaye@Senexus.SN ",
    role: "MANAGER" as const,
    firmIds: ["firm-1"],
    password: "motdepasse1",
    confirmPassword: "motdepasse1",
  }

  it("normalises the email", () => {
    expect(createUserSchema.parse(base).email).toBe("awa.ndiaye@senexus.sn")
  })

  it("rejects a password shorter than the server minimum", () => {
    // The legacy client allowed six characters and the server rejected under
    // eight, so the form failed only after submission.
    const short = { ...base, password: "abc123", confirmPassword: "abc123" }
    expect(createUserSchema.safeParse(short).success).toBe(false)
  })

  it("reports a mismatch on the confirmation field", () => {
    const result = createUserSchema.safeParse({
      ...base,
      confirmPassword: "motdepasse2",
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["confirmPassword"])
    }
  })

  it("requires at least one firm", () => {
    expect(createUserSchema.safeParse({ ...base, firmIds: [] }).success).toBe(false)
  })

  it("offers RESPONSABLE, which no legacy form did", () => {
    expect(USER_ROLES).toContain("RESPONSABLE")
    expect(
      createUserSchema.safeParse({ ...base, role: "RESPONSABLE" }).success
    ).toBe(true)
  })

  it("rejects a role that is not in the enum", () => {
    expect(createUserSchema.safeParse({ ...base, role: "SUPERADMIN" }).success).toBe(
      false
    )
  })
})

describe("resetPasswordSchema", () => {
  it("applies the same password rule as creation", () => {
    expect(
      resetPasswordSchema.safeParse({
        id: "u1",
        password: "court",
        confirmPassword: "court",
      }).success
    ).toBe(false)
  })
})

describe("moduleSchema", () => {
  const base = { slug: "documents", name: "Documents", basePath: "/documents", version: "1.0.0" }

  it("accepts a module with a leading-slash base path", () => {
    expect(moduleSchema.parse(base)).toMatchObject(base)
  })

  it.each(["documents", "documents/", "/Documents"])(
    "rejects the base path %j",
    (basePath) => {
      expect(moduleSchema.safeParse({ ...base, basePath }).success).toBe(false)
    }
  )

  it("requires a three-part version", () => {
    expect(moduleSchema.safeParse({ ...base, version: "1.0" }).success).toBe(false)
  })
})

describe("firmModuleSchema", () => {
  it("distinguishes uninstall (null) from disable (false)", () => {
    const uninstall = firmModuleSchema.parse({
      firmId: "f1",
      moduleId: "m1",
      isEnabled: null,
    })
    expect(uninstall.isEnabled).toBeNull()

    const disable = firmModuleSchema.parse({
      firmId: "f1",
      moduleId: "m1",
      isEnabled: false,
    })
    expect(disable.isEnabled).toBe(false)
  })

  it("requires isEnabled to be present", () => {
    expect(firmModuleSchema.safeParse({ firmId: "f1", moduleId: "m1" }).success).toBe(
      false
    )
  })
})

/**
 * These are the exact schemas the dialogs parse against. They live in this
 * module rather than being derived at the call site with `.omit()`, so that a
 * broken one fails here instead of the first time someone opens the dialog —
 * which is how `resetPasswordSchema.omit({ id: true })` reached production and
 * threw "cannot be used on object schemas containing refinements".
 */
describe("dialog schemas", () => {
  it("passwordPairSchema is the reset dialog's shape, refinement intact", () => {
    expect(
      passwordPairSchema.safeParse({
        password: "motdepasse1",
        confirmPassword: "motdepasse1",
      }).success
    ).toBe(true)

    const mismatch = passwordPairSchema.safeParse({
      password: "motdepasse1",
      confirmPassword: "motdepasse2",
    })
    expect(mismatch.success).toBe(false)
    if (!mismatch.success) {
      expect(mismatch.error.issues[0]?.path).toEqual(["confirmPassword"])
    }
  })

  it("deleteFirmFormSchema asks only for the typed name", () => {
    expect(deleteFirmFormSchema.safeParse({ confirmName: "" }).success).toBe(false)
    expect(
      deleteFirmFormSchema.safeParse({ confirmName: "Connect Interim" }).success
    ).toBe(true)
  })

  it("clientAssignmentFormSchema asks only for the client ids", () => {
    expect(clientAssignmentFormSchema.safeParse({ clientIds: [] }).success).toBe(
      true
    )
    expect(clientAssignmentFormSchema.safeParse({}).success).toBe(false)
  })

  it("userBaseSchema is the edit wizard's shape — no password, no id", () => {
    const values = {
      name: "Awa Ndiaye",
      email: "awa@senexus.sn",
      role: "MANAGER" as const,
      firmIds: ["firm-1"],
    }
    expect(userBaseSchema.safeParse(values).success).toBe(true)
  })
})
