/**
 * Référentiel des catégories de soins — plan §4.4.
 *
 * The five categories are seeded as rows, not as an enum (§11 Q3): adding
 * MATERNITE when accouchement turns out to be priced separately must be an
 * administrator's edit, not a migration. These constants are the *initial*
 * content and the import's mapping, not a closed set — nothing here prevents a
 * sixth category existing, and every lookup below tolerates one.
 */

export const CATEGORY_CODES = [
  "CONSULTATION",
  "SOINS",
  "PHARMACIE",
  "OPTIQUE",
  "HOSPITALISATION",
] as const

export type CategoryCode = (typeof CATEGORY_CODES)[number]

export const CATEGORY_LABELS: Record<CategoryCode, string> = {
  CONSULTATION: "Consultation",
  SOINS: "Soins",
  PHARMACIE: "Pharmacie",
  OPTIQUE: "Optique",
  HOSPITALISATION: "Hospitalisation",
}

/**
 * How the 49 WebLamps prestation codes divide across the categories.
 *
 * The split follows the legacy document types — BPI→pharmacie, BCI→optique,
 * LHI→hospitalisation, LGI→soins — which is why SOINS is the default rather
 * than an explicit list: it is what every unclassified code was already being
 * treated as.
 *
 * Code 25 does not exist in the export, and 39/40 share the label NES-GE-CRP.
 * The import is deliberately tolerant of both rather than refusing the file.
 */
const EXPLICIT_CODES: Partial<Record<CategoryCode, readonly number[]>> = {
  CONSULTATION: [0, 43],
  PHARMACIE: [6, 22],
  OPTIQUE: [4, 13],
  HOSPITALISATION: [3, 8, 16, 24, 31, 33, 48],
}

/** Codes absent from the legacy export. Reported by the import, not imported. */
export const MISSING_SERVICE_CODES: readonly number[] = [25]

/** Codes that share a label with another. Imported; the clash is reported. */
export const DUPLICATE_LABEL_CODES: readonly number[] = [39, 40]

/**
 * The category a legacy prestation code belongs to.
 *
 * SOINS is the documented default, so an unrecognised code lands there rather
 * than failing the import — but `isExplicitlyCategorised` lets the import
 * report how many rows took the default instead of hiding it in a total.
 */
export function categoryForServiceCode(code: number): CategoryCode {
  for (const category of CATEGORY_CODES) {
    if (EXPLICIT_CODES[category]?.includes(code)) return category
  }
  return "SOINS"
}

export function isExplicitlyCategorised(code: number): boolean {
  return CATEGORY_CODES.some((category) =>
    EXPLICIT_CODES[category]?.includes(code)
  )
}

/* -------------------------------------------------------------------------- */
/* Formules — the flyer                                                       */

/**
 * The four commercial formules and the rates the flyer states, as percentages.
 *
 * Only three categories appear on it. Optique and hospitalisation are **not**
 * guessed here: their barème is one of the 23 non-exportable pages the plan
 * flags for manual re-entry (§8, §10), and inventing a rate is exactly how a
 * settlement ends up defensible to nobody. A category with no rate resolves to
 * an error, which the interface shows as a gap to be filled.
 */
export const FLYER_PLANS = [
  {
    code: "TAWFEIKH",
    name: "Tawfeikh",
    monthlyPrice: 35_000,
    rates: { CONSULTATION: 100, SOINS: 90, PHARMACIE: 80 },
  },
  {
    code: "XEWEUL",
    name: "Xeweul",
    monthlyPrice: 25_000,
    rates: { CONSULTATION: 85, SOINS: 85, PHARMACIE: 80 },
  },
  {
    code: "TERANGA",
    name: "Teranga",
    monthlyPrice: 20_000,
    rates: { CONSULTATION: 80, SOINS: 80, PHARMACIE: 70 },
  },
  {
    code: "NOFLAY",
    name: "Noflay",
    monthlyPrice: 12_000,
    rates: { CONSULTATION: 50, SOINS: 50, PHARMACIE: 50 },
  },
] as const satisfies ReadonlyArray<{
  code: string
  name: string
  monthlyPrice: number
  rates: Partial<Record<CategoryCode, number>>
}>

/**
 * `delai_suspension_optique` in WebLamps. The minimum gap between two prises en
 * charge in the same category — distinct from a plafond, which caps an amount
 * rather than a frequency (§4.3).
 */
export const OPTICAL_WAITING_PERIOD_DAYS = 730
