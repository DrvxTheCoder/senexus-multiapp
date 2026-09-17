import { describe, expect, it } from "vitest"

import { fcfa, money, percent, shortDate, stamp } from "@/server/pdf/theme"
import { safeFilename } from "@/server/pdf/render"

/**
 * The formatters that decide what a printed document actually says.
 *
 * None of this is cosmetic. A figure grouped with the wrong character, a date
 * in the wrong order or a filename that truncates at an accent are all things
 * that reach a prestataire on paper, where they cannot be corrected by a
 * redeploy.
 */

/**
 * U+00A0, the no-break space `money` groups digits with.
 *
 * **Not** U+202F, which is the typographically correct narrow one for French
 * and is absent from the latin subset these fonts are built from — fontkit
 * drew `.notdef` for it, so every amount printed as `27|500 FCFA`.
 * `font-coverage.test.ts` is what now stops that recurring; this constant is
 * spelled out so the expectation reads as a decision rather than a literal
 * nobody can see.
 */
const NBSP = " "

describe("money", () => {
  it("groups thousands with a no-break space", () => {
    // Not a plain space: a viewer is free to break `1 234` across a column
    // edge, and an amount split over two lines is one somebody will misread.
    expect(money(1234567)).toBe(`1${NBSP}234${NBSP}567`)
    expect(money(1000)).toBe(`1${NBSP}000`)
  })

  it("leaves anything under a thousand alone", () => {
    expect(money(0)).toBe("0")
    expect(money(999)).toBe("999")
  })

  it("rounds to whole francs, because FCFA has no subunit", () => {
    expect(money(1234.4)).toBe(`1${NBSP}234`)
    expect(money(1234.6)).toBe(`1${NBSP}235`)
  })

  it("keeps the sign outside the grouping", () => {
    // `-1 234`, never `-1 -234`: the separator pass must not see the minus.
    expect(money(-1234)).toBe(`-1${NBSP}234`)
    expect(money(-999)).toBe("-999")
  })

  it("carries the currency when asked", () => {
    expect(fcfa(47500)).toBe(`47${NBSP}500 FCFA`)
  })
})

describe("shortDate", () => {
  it("writes day/month/year, zero-padded", () => {
    expect(shortDate(new Date(2026, 6, 9))).toBe("09/07/2026")
    expect(shortDate(new Date(2026, 11, 31))).toBe("31/12/2026")
  })

  it("prints an em dash for an absent date rather than a blank box", () => {
    // A form with an empty box reads as "not filled in yet"; a dash reads as
    // "there is nothing to put here", which is the truth being stated.
    expect(shortDate(null)).toBe("—")
    expect(shortDate(undefined)).toBe("—")
  })

  it("stamps a time alongside the date", () => {
    expect(stamp(new Date(2026, 8, 9, 12, 2))).toBe("09/09/2026 à 12:02")
    expect(stamp(new Date(2026, 8, 9, 9, 5))).toBe("09/09/2026 à 09:05")
  })
})

describe("percent", () => {
  it("reads the stored fraction, not a percentage", () => {
    // `appliedRate` is a fraction on the row — 0.8, never 80 — and printing it
    // raw would put "0,8 %" on a bon that covers four fifths of the bill.
    expect(percent(0.8)).toBe(`80${NBSP}%`)
    expect(percent(1)).toBe(`100${NBSP}%`)
  })

  it("keeps the decimals a taux actually carries", () => {
    expect(percent(0.855)).toBe(`85.50${NBSP}%`)
  })
})

describe("safeFilename", () => {
  it("folds the accents a provider's name is full of", () => {
    // `Content-Disposition` is a header: a raw `é` variously truncates the
    // name or breaks the parse, depending on the client.
    expect(safeFilename("Clinique de l'Océan.pdf")).toBe(
      "Clinique-de-l-Ocean.pdf"
    )
  })

  it("keeps a plain reference untouched", () => {
    expect(safeFilename("BPI005428.pdf")).toBe("BPI005428.pdf")
    expect(safeFilename("facture-FACT-2026-00012.pdf")).toBe(
      "facture-FACT-2026-00012.pdf"
    )
  })

  it("never returns an empty name", () => {
    expect(safeFilename("……")).toBe("document")
    expect(safeFilename("")).toBe("document")
  })

  it("does not leave a header-breaking character behind", () => {
    for (const value of [
      'Pharmacie "Albis"; rm -rf',
      "dossier/patient\\2026.pdf",
      "n°42 — été",
    ]) {
      expect(safeFilename(value)).toMatch(/^[A-Za-z0-9._-]+$/)
    }
  })
})
