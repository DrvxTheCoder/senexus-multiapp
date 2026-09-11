import { describe, expect, it } from "vitest"

import {
  buildAlerts,
  contributionRatio,
  ratioTone,
  type AlertInputs,
} from "@/server/domain/ipm/alerts"

function inputs(overrides: Partial<AlertInputs> = {}): AlertInputs {
  return {
    firmSlug: "ipm-tawfeikh",
    membersOverDebtCeiling: { count: 0, total: 0 },
    employersOverConsumptionCeiling: { count: 0, names: [] },
    employersRatioBelowOne: { count: 0, worst: null },
    overdueInvoices: { count: 0, total: 0 },
    unopenedLedgers: 0,
    incoherentLedgers: 0,
    invoicesWithVariance: { count: 0, total: 0 },
    staleCards: 0,
    ...overrides,
  }
}

describe("buildAlerts", () => {
  it("says nothing when nothing is wrong", () => {
    expect(buildAlerts(inputs())).toEqual([])
  })

  it("raises the debt ceiling as advisory, never as a block", () => {
    // The plan is explicit: crossing a threshold alerts, it does not block.
    const [alert] = buildAlerts(
      inputs({ membersOverDebtCeiling: { count: 3, total: 450_000 } })
    )
    expect(alert.kind).toBe("DEBT_CEILING")
    expect(alert.detail).toContain("Aucun blocage automatique")
    expect(alert.severity).toBe("WARNING")
  })

  it("treats an unopened register as critical", () => {
    // Every figure downstream depends on it, so it outranks a ceiling.
    const alerts = buildAlerts(
      inputs({
        unopenedLedgers: 7,
        membersOverDebtCeiling: { count: 3, total: 450_000 },
      })
    )
    expect(alerts[0].kind).toBe("LEDGER_UNOPENED")
    expect(alerts[0].severity).toBe("CRITICAL")
  })

  it("orders critical before warning before info", () => {
    const alerts = buildAlerts(
      inputs({
        staleCards: 40,
        membersOverDebtCeiling: { count: 2, total: 1_000 },
        overdueInvoices: { count: 1, total: 500_000 },
      })
    )
    expect(alerts.map((alert) => alert.severity)).toEqual([
      "CRITICAL",
      "WARNING",
      "INFO",
    ])
  })

  it("breaks ties by how many rows are behind the alert", () => {
    const alerts = buildAlerts(
      inputs({
        overdueInvoices: { count: 2, total: 100 },
        invoicesWithVariance: { count: 9, total: 100 },
        unopenedLedgers: 5,
      })
    )
    const critical = alerts.filter((alert) => alert.severity === "CRITICAL")
    expect(critical.map((alert) => alert.count)).toEqual([9, 5, 2])
  })

  it("gives every alert somewhere to go", () => {
    const alerts = buildAlerts(
      inputs({
        membersOverDebtCeiling: { count: 1, total: 1 },
        employersOverConsumptionCeiling: { count: 1, names: ["Touba Gaz"] },
        employersRatioBelowOne: { count: 1, worst: "Sen Textile" },
        overdueInvoices: { count: 1, total: 1 },
        unopenedLedgers: 1,
        incoherentLedgers: 1,
        invoicesWithVariance: { count: 1, total: 1 },
        staleCards: 1,
      })
    )
    expect(alerts).toHaveLength(8)
    for (const alert of alerts) {
      expect(alert.href).toContain("/ipm-tawfeikh/ipm/")
      // A fact with no consequence is a number, not an alert.
      expect(alert.detail.length).toBeGreaterThan(20)
    }
  })

  it("agrees in number with itself", () => {
    const [one] = buildAlerts(inputs({ staleCards: 1 }))
    const [many] = buildAlerts(inputs({ staleCards: 4 }))
    expect(one.title).toContain("carte à regénérer")
    expect(many.title).toContain("cartes à regénérer")
  })

  it("names the worst employer rather than only counting them", () => {
    const [alert] = buildAlerts(
      inputs({ employersRatioBelowOne: { count: 3, worst: "Sen Textile" } })
    )
    expect(alert.detail).toContain("Sen Textile")
  })
})

describe("contributionRatio", () => {
  it("is cotisations over consommation", () => {
    expect(contributionRatio(120_000, 60_000)).toBe(2)
  })

  it("is null when nothing was consumed, not infinity and not zero", () => {
    // Rendering an undefined ratio as a number makes an employer with no
    // claims look like the best or the worst in the portfolio.
    expect(contributionRatio(120_000, 0)).toBeNull()
    expect(contributionRatio(0, 0)).toBeNull()
  })

  it("is below one when consumption exceeds contributions", () => {
    const ratio = contributionRatio(50_000, 100_000)
    expect(ratio).toBeLessThan(1)
  })
})

describe("ratioTone", () => {
  it("flags a deficit", () => {
    expect(ratioTone(0.8)).toBe("alert")
  })

  it("is cautious just above parity", () => {
    expect(ratioTone(1.1)).toBe("signal")
  })

  it("is healthy with margin", () => {
    expect(ratioTone(1.5)).toBe("ok")
  })

  it("does not present an unknown ratio as healthy", () => {
    expect(ratioTone(null)).toBe("signal")
  })
})
