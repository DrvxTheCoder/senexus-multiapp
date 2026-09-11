import { describe, expect, it } from "vitest"

import {
  NAV_GROUPS,
  visibleNavGroups,
  visibleNavItems,
} from "@/components/shell/nav-config"

/**
 * The navigation gate (§3.4).
 *
 * `visibleNavGroups` is the only thing standing between a firm and a link to a
 * module it does not have. The route gate behind it (`requireModule`) is the
 * real authorisation boundary, but a sidebar that offers a link which always
 * 404s is a bug users report as broken access, and for IPM it would advertise
 * the existence of health data to firms that must not see it.
 *
 * These tests assert the gate in both directions: nothing gated appears
 * without its module, and nothing ungated disappears with it.
 */

const groupIds = (modules: string[]) =>
  visibleNavGroups(modules).map((group) => group.id)

const hrefs = (modules: string[]) =>
  visibleNavItems(modules).map((item) => item.href)

describe("visibleNavGroups", () => {
  it("hides every module-gated group for a firm with no modules", () => {
    expect(groupIds([])).toEqual(["workspace", "account"])
  })

  it("keeps ungated groups regardless of the module list", () => {
    for (const modules of [[], ["hr"], ["hr", "crm", "documents", "ipm"]]) {
      expect(groupIds(modules)).toContain("workspace")
      expect(groupIds(modules)).toContain("account")
    }
  })

  it("shows a gated group only when its module is enabled", () => {
    for (const group of NAV_GROUPS) {
      if (group.module === null) continue
      expect(groupIds([])).not.toContain(group.id)
      expect(groupIds([group.module])).toContain(group.id)
    }
  })
})

describe("the IPM gate", () => {
  it("offers no IPM link to the firms that run HR and CRM", () => {
    const modules = ["hr", "crm", "documents"]
    expect(groupIds(modules)).not.toContain("ipm")
    expect(hrefs(modules)).not.toContain("/ipm")
  })

  it("offers the IPM link to a firm that has the module", () => {
    expect(groupIds(["ipm"])).toContain("ipm")
    expect(hrefs(["ipm"])).toContain("/ipm")
  })

  it("gives an IPM-only firm no HR, CRM or documents entry", () => {
    // The reverse direction, and the one that matters for the seed: IPM
    // Tawfeikh has no employees and no clients, so a link to either is a link
    // to an empty page at best and a leak of the module boundary at worst.
    expect(groupIds(["ipm"])).toEqual(["workspace", "ipm", "account"])
    expect(hrefs(["ipm"]).filter((href) => href.startsWith("/hr"))).toEqual([])
    expect(hrefs(["ipm"])).not.toContain("/crm/clients")
    expect(hrefs(["ipm"])).not.toContain("/documents")
  })

  it("keeps IPM gated on a module rather than on nothing", () => {
    // Guards the one edit that would silently undo all of the above: setting
    // `module: null` on the group to make a link appear during development.
    const ipm = NAV_GROUPS.find((group) => group.id === "ipm")
    expect(ipm?.module).toBe("ipm")
  })
})

describe("visibleNavItems", () => {
  it("is the flattening of the visible groups, in order", () => {
    const modules = ["hr", "ipm"]
    expect(hrefs(modules)).toEqual(
      visibleNavGroups(modules).flatMap((group) =>
        group.items.map((item) => item.href)
      )
    )
  })

  it("never yields an item from a hidden group", () => {
    const hidden = NAV_GROUPS.filter(
      (group) => group.module !== null && group.module !== "hr"
    ).flatMap((group) => group.items.map((item) => item.href))

    for (const href of hrefs(["hr"])) {
      expect(hidden).not.toContain(href)
    }
  })
})
