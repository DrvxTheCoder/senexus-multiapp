import { describe, expect, it } from "vitest"

import {
  amountInWords,
  numberToFrenchWords,
} from "@/server/domain/ipm/amount-in-words"

/**
 * The two agreement rules the plan calls out, plus the one people "fix" into
 * a bug. A bon de décaissement is a payment instrument; the words on it are
 * what a bank reads when the figures are disputed.
 */

describe("les accords — cent", () => {
  it("takes an s when multiplied and final", () => {
    expect(numberToFrenchWords(200)).toBe("deux cents")
    expect(numberToFrenchWords(300)).toBe("trois cents")
    expect(numberToFrenchWords(900)).toBe("neuf cents")
  })

  it("loses the s the moment anything follows", () => {
    // The rule the plan names explicitly.
    expect(numberToFrenchWords(230)).toBe("deux cent trente")
    expect(numberToFrenchWords(201)).toBe("deux cent un")
    expect(numberToFrenchWords(999)).toBe("neuf cent quatre-vingt-dix-neuf")
  })

  it("is never «un cent»", () => {
    expect(numberToFrenchWords(100)).toBe("cent")
    expect(numberToFrenchWords(101)).toBe("cent un")
  })
})

describe("les accords — vingt", () => {
  it("takes an s only in quatre-vingts", () => {
    expect(numberToFrenchWords(80)).toBe("quatre-vingts")
  })

  it("loses it as soon as something follows", () => {
    expect(numberToFrenchWords(81)).toBe("quatre-vingt-un")
    expect(numberToFrenchWords(90)).toBe("quatre-vingt-dix")
    expect(numberToFrenchWords(98)).toBe("quatre-vingt-dix-huit")
  })

  it("keeps plain vingt for 20", () => {
    expect(numberToFrenchWords(20)).toBe("vingt")
    expect(numberToFrenchWords(21)).toBe("vingt et un")
  })
})

describe("mille est invariable", () => {
  it("never takes an s", () => {
    // The rule most often "corrected" into a mistake.
    expect(numberToFrenchWords(2_000)).toBe("deux mille")
    expect(numberToFrenchWords(80_000)).toBe("quatre-vingts mille")
    expect(numberToFrenchWords(200_000)).toBe("deux cents mille")
  })

  it("is «mille», never «un mille»", () => {
    expect(numberToFrenchWords(1_000)).toBe("mille")
    expect(numberToFrenchWords(1_500)).toBe("mille cinq cents")
  })
})

describe("les dizaines irrégulières", () => {
  it("handles 70 to 79", () => {
    expect(numberToFrenchWords(70)).toBe("soixante-dix")
    expect(numberToFrenchWords(71)).toBe("soixante et onze")
    expect(numberToFrenchWords(75)).toBe("soixante-quinze")
    expect(numberToFrenchWords(79)).toBe("soixante-dix-neuf")
  })

  it("uses «et un» on the ones that take it", () => {
    expect(numberToFrenchWords(21)).toBe("vingt et un")
    expect(numberToFrenchWords(31)).toBe("trente et un")
    expect(numberToFrenchWords(61)).toBe("soixante et un")
    // 81 and 91 do not.
    expect(numberToFrenchWords(81)).toBe("quatre-vingt-un")
  })

  it("is standard French, not Belgian", () => {
    expect(numberToFrenchWords(70)).not.toContain("septante")
    expect(numberToFrenchWords(90)).not.toContain("nonante")
  })
})

describe("les grands nombres", () => {
  it("handles the amounts a décaissement actually carries", () => {
    expect(numberToFrenchWords(35_000)).toBe("trente-cinq mille")
    expect(numberToFrenchWords(1_250_000)).toBe(
      "un million deux cent cinquante mille"
    )
    expect(numberToFrenchWords(2_000_000)).toBe("deux millions")
  })

  it("pluralises million and milliard but not mille", () => {
    expect(numberToFrenchWords(1_000_000)).toBe("un million")
    expect(numberToFrenchWords(3_000_000)).toBe("trois millions")
    expect(numberToFrenchWords(1_000_000_000)).toBe("un milliard")
    expect(numberToFrenchWords(2_000_000_000)).toBe("deux milliards")
  })

  it("composes the scales in order", () => {
    expect(numberToFrenchWords(1_234_567)).toBe(
      "un million deux cent trente-quatre mille cinq cent soixante-sept"
    )
  })
})

describe("les cas limites", () => {
  it("handles zero", () => {
    expect(numberToFrenchWords(0)).toBe("zéro")
  })

  it("handles a negative, which a reversal can be", () => {
    expect(numberToFrenchWords(-500)).toBe("moins cinq cents")
  })

  it("refuses a fractional amount rather than rounding it away", () => {
    // FCFA has no subunit: centimes here mean a bug upstream, and silently
    // rounding would put a different number in words than in figures.
    expect(() => numberToFrenchWords(1_000.5)).toThrow()
  })

  it("refuses a non-number", () => {
    expect(() => numberToFrenchWords(Number.NaN)).toThrow()
    expect(() => numberToFrenchWords(Number.POSITIVE_INFINITY)).toThrow()
  })
})

describe("amountInWords", () => {
  it("capitalises and names the currency, as the paper document does", () => {
    expect(amountInWords(1_250_000)).toBe(
      "Un million deux cent cinquante mille francs CFA"
    )
  })

  it("is a function of the figure, so the two cannot disagree", () => {
    for (const amount of [0, 80, 200, 1_000, 35_000, 1_234_567]) {
      expect(amountInWords(amount).toLowerCase()).toContain(
        numberToFrenchWords(amount)
      )
    }
  })
})
