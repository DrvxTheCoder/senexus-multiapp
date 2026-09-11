import { describe, expect, it } from "vitest"

import {
  balanceAt,
  balanceOf,
  consumptionDebit,
  DEFAULT_BALANCE_MODE,
  DEFAULT_CONSUMPTION_BASIS,
  findIncoherences,
  openingState,
  reaffiliationEntries,
  withRunningBalance,
  type LedgerEntry,
} from "@/server/domain/ipm/ledger"

function entry(overrides: Partial<LedgerEntry> & { id: string }): LedgerEntry {
  return {
    periodYear: 2026,
    periodMonth: 1,
    type: "CONTRIBUTION",
    credit: 0,
    debit: 0,
    createdAt: new Date(2026, 0, 1),
    ...overrides,
  }
}

describe("balanceOf", () => {
  it("is credits minus debits", () => {
    expect(
      balanceOf([
        entry({ id: "a", credit: 20_000 }),
        entry({ id: "b", debit: 8_000, type: "CONSUMPTION" }),
      ])
    ).toBe(12_000)
  })

  it("is positive when a participant contributes more than they consume", () => {
    // The sign convention every statement depends on. Inverting it inverts
    // every figure on the direction's report.
    expect(balanceOf([entry({ id: "a", credit: 35_000 })])).toBeGreaterThan(0)
    expect(
      balanceOf([entry({ id: "a", debit: 35_000, type: "CONSUMPTION" })])
    ).toBeLessThan(0)
  })

  it("is zero for an empty register", () => {
    expect(balanceOf([])).toBe(0)
  })
})

describe("balanceAt", () => {
  const history = [
    entry({ id: "jan", periodMonth: 1, credit: 20_000 }),
    entry({ id: "feb", periodMonth: 2, debit: 5_000, type: "CONSUMPTION" }),
    entry({ id: "mar", periodMonth: 3, credit: 20_000 }),
  ]

  it("stops at the end of the month asked for", () => {
    expect(balanceAt(history, 2026, 1)).toBe(20_000)
    expect(balanceAt(history, 2026, 2)).toBe(15_000)
    expect(balanceAt(history, 2026, 3)).toBe(35_000)
  })

  it("counts every earlier year in full", () => {
    const withPrior = [
      entry({ id: "prior", periodYear: 2025, periodMonth: 12, credit: 10_000 }),
      ...history,
    ]
    expect(balanceAt(withPrior, 2026, 1)).toBe(30_000)
  })

  it("is zero before the register opens", () => {
    expect(balanceAt(history, 2025, 6)).toBe(0)
  })
})

describe("withRunningBalance", () => {
  it("orders by period then insertion", () => {
    const rebuilt = withRunningBalance([
      entry({ id: "mar", periodMonth: 3, credit: 1_000 }),
      entry({ id: "jan", periodMonth: 1, credit: 2_000 }),
      entry({ id: "feb", periodMonth: 2, debit: 500, type: "CONSUMPTION" }),
    ])
    expect(rebuilt.map((row) => row.id)).toEqual(["jan", "feb", "mar"])
    expect(rebuilt.map((row) => row.balanceAfter)).toEqual([2_000, 1_500, 2_500])
  })

  it("ends at the same figure as balanceOf", () => {
    const entries = [
      entry({ id: "a", credit: 20_000 }),
      entry({ id: "b", periodMonth: 2, debit: 7_500, type: "CONSUMPTION" }),
      entry({ id: "c", periodMonth: 3, credit: 20_000 }),
    ]
    const rebuilt = withRunningBalance(entries)
    expect(rebuilt.at(-1)?.balanceAfter).toBe(balanceOf(entries))
  })
})

describe("§11 Q9 — what a prise en charge debits", () => {
  it("debits the IPM share by default, not the whole voucher", () => {
    // The ticket modérateur is the member's own money and never passed through
    // the institution; debiting the total overstates what it carries.
    expect(DEFAULT_CONSUMPTION_BASIS).toBe("INSURER_SHARE")
    expect(consumptionDebit(DEFAULT_CONSUMPTION_BASIS, 10_000, 8_000)).toBe(8_000)
  })

  it("can be switched to the total, because the plan asks for the choice", () => {
    expect(consumptionDebit("TOTAL_AMOUNT", 10_000, 8_000)).toBe(10_000)
  })
})

describe("§11 Q10 — annual or perpetual", () => {
  it("defaults to perpetual", () => {
    expect(DEFAULT_BALANCE_MODE).toBe("PERPETUAL")
  })
})

describe("§11 Q11 — the opening balance", () => {
  it("reports a register that was never opened", () => {
    // §9: a balance computed after the switchover without a solde initial is
    // wrong. Flagging beats inventing.
    expect(openingState([entry({ id: "a", credit: 20_000 })])).toEqual({
      status: "MISSING",
    })
  })

  it("reads the opening figure when one was set", () => {
    expect(
      openingState([
        entry({ id: "open", type: "OPENING", credit: 45_000 }),
        entry({ id: "a", credit: 20_000 }),
      ])
    ).toEqual({ status: "SET", amount: 45_000 })
  })

  it("reads a negative opening", () => {
    expect(
      openingState([entry({ id: "open", type: "OPENING", debit: 12_000 })])
    ).toEqual({ status: "SET", amount: -12_000 })
  })

  it("treats an opening of zero as set, not missing", () => {
    // "Opened at zero" is a decision somebody made; "never opened" is not.
    expect(openingState([entry({ id: "open", type: "OPENING" })])).toEqual({
      status: "SET",
      amount: 0,
    })
  })
})

describe("findIncoherences", () => {
  const clean = withRunningBalance([
    entry({ id: "open", type: "OPENING", credit: 10_000 }),
    entry({ id: "a", periodMonth: 2, credit: 20_000 }),
    entry({ id: "b", periodMonth: 3, debit: 5_000, type: "CONSUMPTION" }),
  ])

  it("finds nothing in a coherent register", () => {
    expect(findIncoherences(clean, 25_000)).toEqual([])
  })

  it("reports a stale cache", () => {
    const problems = findIncoherences(clean, 99_999)
    expect(problems).toContainEqual({
      kind: "CACHE_STALE",
      cached: 99_999,
      computed: 25_000,
    })
  })

  it("does not report a cache that was never set", () => {
    expect(findIncoherences(clean, null)).toEqual([])
  })

  it("reports a running balance that drifted", () => {
    const drifted = clean.map((row) =>
      row.id === "a" ? { ...row, balanceAfter: 12_345 } : row
    )
    expect(
      findIncoherences(drifted, balanceOf(drifted)).some(
        (problem) => problem.kind === "RUNNING_BALANCE"
      )
    ).toBe(true)
  })

  it("reports two opening entries", () => {
    const doubled = withRunningBalance([
      entry({ id: "open1", type: "OPENING", credit: 10_000 }),
      entry({ id: "open2", type: "OPENING", credit: 5_000, periodMonth: 2 }),
    ])
    expect(findIncoherences(doubled, balanceOf(doubled))).toContainEqual({
      kind: "MULTIPLE_OPENINGS",
      count: 2,
    })
  })

  it("reports an entry carrying both a credit and a debit", () => {
    const both = withRunningBalance([
      entry({ id: "x", credit: 1_000, debit: 400 }),
    ])
    expect(
      findIncoherences(both, balanceOf(both)).some(
        (problem) => problem.kind === "BOTH_SIDES"
      )
    ).toBe(true)
  })
})

describe("§11 Q13 — réaffiliation", () => {
  const ON = new Date(2026, 8, 11)

  it("closes a positive balance and reopens at zero", () => {
    const entries = reaffiliationEntries(61_500, ON)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ type: "REVERSAL", debit: 61_500, credit: 0 })
    expect(entries[1]).toMatchObject({ type: "OPENING", credit: 0, debit: 0 })
    expect(balanceOf(
      entries.map((row, index) =>
        entry({ id: String(index), credit: row.credit, debit: row.debit })
      )
    )).toBe(-61_500)
  })

  it("closes a negative balance the other way", () => {
    const entries = reaffiliationEntries(-8_000, ON)
    expect(entries[0]).toMatchObject({ type: "REVERSAL", credit: 8_000, debit: 0 })
  })

  it("opens without a reversal when the balance was already zero", () => {
    const entries = reaffiliationEntries(0, ON)
    expect(entries).toHaveLength(1)
    expect(entries[0].type).toBe("OPENING")
  })

  it("never deletes anything — the reset is two entries", () => {
    // The old register stays readable, and the reset is something somebody
    // did on a date rather than a hole in the history.
    for (const balance of [61_500, -8_000, 0]) {
      for (const row of reaffiliationEntries(balance, ON)) {
        expect(["REVERSAL", "OPENING"]).toContain(row.type)
        expect(row.note.length).toBeGreaterThan(0)
      }
    }
  })
})
