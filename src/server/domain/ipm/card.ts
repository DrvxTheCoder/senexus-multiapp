import { createHash } from "node:crypto"

/**
 * Carte de tiers payant — geometry, the overflow rule, and staleness.
 *
 * Everything here is pure: no rendering, no database. The renderer imports it,
 * and so do the screens that need to say "this card is out of date" without
 * drawing anything.
 */

/* ==========================================================================
 * Geometry — plan §6
 * ========================================================================== */

/** ISO/IEC 7810 ID-1, portrait. */
export const CARD_WIDTH_MM = 54
export const CARD_HEIGHT_MM = 85.6
export const BLEED_MM = 3

export const PRINT_PPI = 300
export const SCREEN_PPI = 150

export function pixelsFor(mm: number, ppi: number): number {
  return Math.round((mm / 25.4) * ppi)
}

export type CardGeometry = {
  ppi: number
  width: number
  height: number
  /** Bleed in pixels, 0 when not requested. */
  bleed: number
}

/**
 * `bleed` adds 3 mm on every side, which is what a printer needs in order to
 * trim through the artwork rather than leave a white hairline. It is off by
 * default because the same renderer feeds the on-screen preview, where bleed
 * would simply make the card look wrong.
 */
export function geometry(ppi: number, withBleed = false): CardGeometry {
  const bleed = withBleed ? pixelsFor(BLEED_MM, ppi) : 0
  return {
    ppi,
    width: pixelsFor(CARD_WIDTH_MM, ppi) + bleed * 2,
    height: pixelsFor(CARD_HEIGHT_MM, ppi) + bleed * 2,
    bleed,
  }
}

/* ==========================================================================
 * Overflow — §11 Q4
 * ========================================================================== */

/**
 * At most nine ayants droit on the verso, in a 3×3 grid.
 *
 * The dataset holds families with more than twenty, so something has to give.
 * The answer was a fixed cap, and the one thing this must not do is drop the
 * rest silently: a card that shows nine of twelve and says nothing is worse
 * than one that shows nine and says there are three more, because only the
 * second tells the counter to ask.
 */
export const VERSO_GRID_COLUMNS = 3
export const VERSO_GRID_ROWS = 3
export const VERSO_CAPACITY = VERSO_GRID_COLUMNS * VERSO_GRID_ROWS

export type VersoLayout<T> = {
  shown: T[]
  /** How many did not fit. Zero when everyone did. */
  overflow: number
  /** The sentence printed under the grid, or null when nothing is hidden. */
  notice: string | null
}

export function layoutVerso<T>(dependents: readonly T[]): VersoLayout<T> {
  const shown = dependents.slice(0, VERSO_CAPACITY)
  const overflow = Math.max(0, dependents.length - VERSO_CAPACITY)

  return {
    shown,
    overflow,
    notice:
      overflow === 0
        ? null
        : `+ ${overflow} autre${overflow > 1 ? "s" : ""} ayant${overflow > 1 ? "s" : ""} droit — voir le dossier`,
  }
}

/* ==========================================================================
 * Staleness
 * ========================================================================== */

/**
 * Exactly what is printed on the card, and nothing else.
 *
 * The list is narrow on purpose. Hashing the whole member record would mark
 * every card stale whenever a phone number changed, and the counter of
 * out-of-date cards would stop meaning anything — which is the failure mode
 * that makes people ignore such counters.
 */
export type CardInputs = {
  matricule: string
  firstName: string
  lastName: string
  birthDate: string | null
  birthPlace: string | null
  photoUrl: string | null
  employerName: string
  planLabel: string
  /** Rendered rates, in the order they appear on the card. */
  rates: { category: string; rate: number | null }[]
  dependents: {
    matricule: string
    firstName: string
    lastName: string
    relation: string
    photoUrl: string | null
  }[]
}

/**
 * A stable digest of the printed content.
 *
 * Stability matters more than the algorithm: the same card must hash the same
 * across processes and deploys, so the fields are serialised in a fixed order
 * rather than through `JSON.stringify` of an object whose key order is an
 * accident of construction.
 */
export function cardInputsHash(inputs: CardInputs): string {
  const parts: string[] = [
    inputs.matricule,
    inputs.lastName,
    inputs.firstName,
    inputs.birthDate ?? "",
    inputs.birthPlace ?? "",
    inputs.photoUrl ?? "",
    inputs.employerName,
    inputs.planLabel,
    ...inputs.rates.map(
      (rate) => `${rate.category}=${rate.rate === null ? "" : rate.rate}`
    ),
    // Only the ayants droit that actually reach the card affect it. A tenth
    // dependent changes the overflow notice, so the count is hashed too.
    `n=${inputs.dependents.length}`,
    ...layoutVerso(inputs.dependents).shown.map(
      (dependent) =>
        `${dependent.matricule}|${dependent.lastName}|${dependent.firstName}|${dependent.relation}|${dependent.photoUrl ?? ""}`
    ),
  ]

  return createHash("sha256").update(parts.join("")).digest("hex").slice(0, 32)
}

export type CardState = "MISSING" | "CURRENT" | "STALE" | "REVOKED"

export const CARD_STATE_LABELS: Record<CardState, string> = {
  MISSING: "Jamais générée",
  CURRENT: "À jour",
  STALE: "À regénérer",
  REVOKED: "Révoquée",
}

export function cardState(
  card: { inputsHash: string; revokedAt: Date | null } | null,
  currentHash: string
): CardState {
  if (!card) return "MISSING"
  if (card.revokedAt) return "REVOKED"
  return card.inputsHash === currentHash ? "CURRENT" : "STALE"
}
