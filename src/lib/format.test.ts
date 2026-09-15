import { describe, expect, it } from "vitest"

import { formatSeniority } from "@/lib/format"

const on = (year: number, month: number, day: number) =>
  new Date(year, month - 1, day)

const AFFILIATED = on(2013, 9, 15)

/**
 * L'ancienneté, printed under the affiliation date on the fiche participant.
 *
 * It is derived arithmetic sitting next to the date it is derived from, which
 * is exactly where a wrong figure gets noticed — so the boundaries are pinned
 * rather than eyeballed.
 */
describe("formatSeniority", () => {
  it("counts in days for the first month", () => {
    expect(formatSeniority(AFFILIATED, AFFILIATED)).toBe("0 j d'ancienneté")
    expect(formatSeniority(AFFILIATED, on(2013, 10, 15))).toBe(
      "30 j d'ancienneté"
    )
  })

  it("switches to months, not to '0 mois'", () => {
    expect(formatSeniority(AFFILIATED, on(2013, 10, 16))).toBe(
      "1 mois d'ancienneté"
    )
    expect(formatSeniority(AFFILIATED, on(2014, 8, 15))).toBe(
      "11 mois d'ancienneté"
    )
  })

  it("reads a year to the day as a year, which day arithmetic does not", () => {
    // 365 days over any month divisor floors to 11 - printed beside the very
    // date that proves otherwise.
    expect(formatSeniority(AFFILIATED, on(2014, 9, 15))).toBe(
      "1 an d'ancienneté"
    )
    expect(formatSeniority(AFFILIATED, on(2015, 9, 15))).toBe(
      "2 ans d'ancienneté"
    )
  })

  it("keeps the remaining months when there are any", () => {
    expect(formatSeniority(AFFILIATED, on(2015, 12, 20))).toBe("2 ans 3 mois")
  })

  it("does not drift over a long affiliation", () => {
    // A flat 30-day month reads "12 ans 2 mois" here.
    expect(formatSeniority(AFFILIATED, on(2025, 9, 15))).toBe(
      "12 ans d'ancienneté"
    )
  })

  it("clamps a date entered in the future rather than counting backwards", () => {
    expect(formatSeniority(on(2026, 12, 1), on(2025, 9, 15))).toBe(
      "0 j d'ancienneté"
    )
  })
})
