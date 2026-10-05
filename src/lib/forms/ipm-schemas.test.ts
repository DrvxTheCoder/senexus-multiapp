import { zodResolver } from "@hookform/resolvers/zod"
import { describe, expect, it } from "vitest"

import { setPlanRateSchema } from "@/lib/forms/ipm-schemas"

const typed = {
  firmSlug: "ipm",
  planId: "plan",
  categoryId: "optique",
  beneficiaryType: "ALL",
  rate: "80",
  waitingPeriodDays: "0",
}

const options = { fields: {}, shouldUseNativeValidation: false }

const resolve = (raw: boolean) =>
  raw
    ? zodResolver(setPlanRateSchema, undefined, { raw: true })(typed as never, undefined, options)
    : zodResolver(setPlanRateSchema)(typed as never, undefined, options)

describe("rateField through a form", () => {
  it("converts a typed percentage once, on the server", async () => {
    const { values } = await resolve(true)
    // The form hands the action what was typed…
    expect((values as typeof typed).rate).toBe("80")
    // …and the action's own parse makes it a fraction.
    expect(setPlanRateSchema.parse(values).rate).toBe(0.8)
  })

  it("would convert twice if the form submitted parsed values", async () => {
    const { values } = await resolve(false)
    expect(setPlanRateSchema.parse(values).rate).toBe(0.008)
  })
})
