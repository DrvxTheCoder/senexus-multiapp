/**
 * Montant en toutes lettres — plan §4.10.
 *
 * A bon de décaissement carries the amount in words, and the plan flags the
 * two agreement rules that are easy to get wrong:
 *
 *   - **cent** takes an *s* when multiplied and final: `deux cents`, but
 *     `deux cent trente`;
 *   - **vingt** takes an *s* only in `quatre-vingts`, and loses it the moment
 *     anything follows: `quatre-vingt-un`, `quatre-vingt-dix`.
 *
 * `mille` is invariable — always. That is the rule people most often "fix"
 * into a bug.
 *
 * Generated on demand, never stored: an amount and its words must not be able
 * to disagree, and the only way to guarantee that is to have one of them be a
 * function of the other.
 *
 * Standard French (not Belgian or Swiss): septante and nonante do not appear.
 */

const UNITS = [
  "zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit",
  "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize",
]

const TENS: Record<number, string> = {
  2: "vingt",
  3: "trente",
  4: "quarante",
  5: "cinquante",
  6: "soixante",
}

/** 0–99. The irregular decades are 70, 80 and 90. */
function underHundred(value: number): string {
  if (value < 17) return UNITS[value]

  if (value < 20) return `dix-${UNITS[value - 10]}`

  if (value < 70) {
    const tens = Math.floor(value / 10)
    const unit = value % 10
    if (unit === 0) return TENS[tens]
    // 21, 31, 41, 51, 61 take "et un"; 22 and the rest take a hyphen.
    if (unit === 1) return `${TENS[tens]} et un`
    return `${TENS[tens]}-${UNITS[unit]}`
  }

  if (value < 80) {
    // 70–79 is "soixante" plus 10–19: soixante-dix, soixante et onze.
    const rest = value - 60
    if (rest === 11) return "soixante et onze"
    return `soixante-${underHundred(rest)}`
  }

  if (value < 100) {
    const rest = value - 80
    // `quatre-vingts` only when nothing follows.
    if (rest === 0) return "quatre-vingts"
    return `quatre-vingt-${underHundred(rest)}`
  }

  return String(value)
}

/** 0–999. */
function underThousand(value: number): string {
  if (value < 100) return underHundred(value)

  const hundreds = Math.floor(value / 100)
  const rest = value % 100

  if (hundreds === 1) {
    return rest === 0 ? "cent" : `cent ${underHundred(rest)}`
  }

  // `cent` takes an s when multiplied *and* final.
  const prefix = rest === 0 ? `${UNITS[hundreds]} cents` : `${UNITS[hundreds]} cent`
  return rest === 0 ? prefix : `${prefix} ${underHundred(rest)}`
}

const SCALES: { value: number; singular: string; plural: string }[] = [
  { value: 1_000_000_000, singular: "milliard", plural: "milliards" },
  { value: 1_000_000, singular: "million", plural: "millions" },
  // `mille` is invariable. Always.
  { value: 1_000, singular: "mille", plural: "mille" },
]

export function numberToFrenchWords(value: number): string {
  if (!Number.isFinite(value)) throw new Error("Montant invalide.")
  if (!Number.isInteger(value)) {
    // FCFA has no subunit, so a fractional amount is a bug upstream rather
    // than something to round away silently here.
    throw new Error("Le montant doit être un nombre entier de francs.")
  }
  if (value < 0) return `moins ${numberToFrenchWords(-value)}`
  if (value === 0) return "zéro"

  const parts: string[] = []
  let remainder = value

  for (const scale of SCALES) {
    const count = Math.floor(remainder / scale.value)
    if (count === 0) continue
    remainder %= scale.value

    if (scale.value === 1_000 && count === 1) {
      // "mille", never "un mille".
      parts.push("mille")
    } else {
      parts.push(
        `${underThousand(count)} ${count > 1 ? scale.plural : scale.singular}`
      )
    }
  }

  if (remainder > 0) parts.push(underThousand(remainder))

  return parts.join(" ")
}

/**
 * The line a bon de décaissement prints.
 *
 * Capitalised and suffixed with the currency, which is how the paper document
 * reads.
 */
export function amountInWords(value: number, currency = "francs CFA"): string {
  const words = numberToFrenchWords(value)
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} ${currency}`
}
