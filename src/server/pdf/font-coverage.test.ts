import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  DOCUMENT_FACES,
  supportedCodePoints,
  unsupportedIn,
} from "@/server/pdf/font-coverage"
import { amountInWords } from "@/server/domain/ipm/amount-in-words"
import { fcfa, money, percent, shortDate, stamp } from "@/server/pdf/theme"

/**
 * Tout ce que les documents impriment, la police sait le dessiner.
 *
 * The regression this guards is a real one and it reached paper: amounts were
 * grouped with U+202F, which is correct French typography and is not in the
 * latin subset these fonts are built from. fontkit drew `.notdef` — a vertical
 * bar in IBM Plex Sans — so every amount on every document read `27|500 FCFA`.
 * Nothing threw, nothing logged; the only symptom was the document.
 *
 * So the assertion is made against the **font files on disk**, and the strings
 * are produced by the real formatters rather than copied, because the whole
 * class of bug is "the code emits a character nobody checked".
 */

const FONT_DIR = join(process.cwd(), "public", "fonts", "pdf")

const coverage = DOCUMENT_FACES.map((face) => ({
  face,
  covered: supportedCodePoints(join(FONT_DIR, `${face}.ttf`)),
}))

/**
 * The fixed text the chrome and the templates print.
 *
 * Only what is actually rendered — the French punctuation these documents are
 * full of. A character that appears solely in a comment is not on the page and
 * is deliberately not listed.
 */
const PRINTED_PUNCTUATION = [
  "—", // the em dash every empty field falls back to
  "·", // the separator in "Journal B1 · Comptabilisé"
  "–",
  "…",
  "°", // "n° 0042"
  "«»", // the guarantee clause quotes a prestation
  "€$", // never printed, but a stray currency must not print as a bar either
].join("")

const PRINTED_LETTERS =
  "ÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŒàâäçéèêëîïôöùûüœ" +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789" +
  "().,;:!?'\"/-+%&*#@[]{}<>=_|~^`$"

describe.each(coverage)("$face", ({ covered }) => {
  it("draws every character the amount formatter emits", () => {
    // Three digit groups, a negative, a rounded figure and the currency.
    const samples = [
      money(0),
      money(999),
      money(1234567),
      money(-1234),
      money(1234.6),
      fcfa(47500),
    ].join(" ")

    expect(unsupportedIn(samples, covered)).toEqual([])
  })

  it("draws the grouping separator itself", () => {
    // Stated on its own, because this is the exact character that failed and a
    // wider assertion would let a future change hide it in a passing sample.
    const separator = money(1000).replace(/\d/g, "")
    expect(separator).toHaveLength(1)
    expect(unsupportedIn(separator, covered)).toEqual([])
  })

  it("draws the dates and the taux", () => {
    const samples = [
      shortDate(new Date(2026, 8, 9)),
      shortDate(null),
      stamp(new Date(2026, 8, 9, 12, 2)),
      percent(0.8),
      percent(0.855),
    ].join(" ")

    expect(unsupportedIn(samples, covered)).toEqual([])
  })

  it("draws the amount in words, accents and all", () => {
    // `amountInWords` is what a bon de décaissement is arrêté at, and French
    // number words are where the accented characters actually turn up.
    const samples = [
      amountInWords(0),
      amountInWords(1),
      amountInWords(486150),
      amountInWords(298200),
      amountInWords(1_234_567_890),
    ].join(" ")

    expect(unsupportedIn(samples, covered)).toEqual([])
  })

  it("draws the fixed punctuation and the French alphabet", () => {
    expect(unsupportedIn(PRINTED_PUNCTUATION, covered)).toEqual([])
    expect(unsupportedIn(PRINTED_LETTERS, covered)).toEqual([])
  })
})

describe("the reader itself", () => {
  it("reports a character the subset genuinely lacks", () => {
    // Without this, a reader that returned "everything is covered" would make
    // every assertion above pass while proving nothing. U+202F is the one that
    // caused the bug, and it is still absent — the fix was to stop using it.
    const [{ covered }] = coverage
    expect(unsupportedIn(" ", covered)).toEqual([" "])
  })

  it("ignores control characters, which are never drawn", () => {
    const [{ covered }] = coverage
    expect(unsupportedIn("\n\t", covered)).toEqual([])
  })
})
