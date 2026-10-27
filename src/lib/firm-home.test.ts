import { describe, expect, it } from "vitest"

import { firmHomeHref, firmHomePath, isHrFirm } from "@/lib/firm-home"

/**
 * Where "home" is. Every brand link, breadcrumb, firm switcher entry and the
 * bare `/[firmSlug]` redirect goes through this, so a wrong answer here sends
 * every member of a firm to a page that 404s or sits empty.
 */
describe("firmHomePath", () => {
  it("is the tableau de bord for an HR firm", () => {
    const firm = { slug: "acme", homeModule: null, modules: ["hr", "ipm"] }
    expect(isHrFirm(firm)).toBe(true)
    expect(firmHomePath(firm)).toBe("/dashboard")
  })

  it("is the home module's first page for a firm hors RH", () => {
    const firm = { slug: "ipm-tawfeikh", homeModule: "ipm", modules: ["ipm"] }
    expect(isHrFirm(firm)).toBe(false)
    expect(firmHomeHref(firm)).toBe("/ipm-tawfeikh/ipm")
    expect(firmHomePath({ ...firm, homeModule: "crm", modules: ["crm"] })).toBe(
      "/crm/clients"
    )
  })

  it("falls back to the first enabled module when the home one is off", () => {
    // Never to the dashboard: the firm was marked hors RH on purpose.
    expect(
      firmHomePath({ slug: "x", homeModule: "ipm", modules: ["crm"] })
    ).toBe("/crm/clients")
  })

  it("lands on the profile when a firm hors RH has no module at all", () => {
    expect(firmHomePath({ slug: "x", homeModule: "ipm", modules: [] })).toBe(
      "/settings/profile"
    )
  })
})
