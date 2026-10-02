import type { IpmReviewFlag } from "@prisma/client"

/**
 * Revue des bons émis depuis le portail.
 *
 * Copied from ipm-portal `src/domain/portal/review.ts`, which runs the same
 * function over its own data for the preview the participant sees. Keep the
 * two in step.
 *
 * The rule agreed with the IPM: below the threshold a bon is issued at once —
 * the participant is at the counter and cannot wait — and anything odd about
 * it is flagged for the gestionnaire to look at later. Above the threshold it
 * waits for her (PENDING_REVIEW), and its amount is reserved against the
 * ceiling meanwhile so that several pending bons cannot add up past it.
 *
 * Pure, like the issuance checks: the caller loads the facts, this decides.
 */

/** `IpmPortalSettings`, with its Decimals already turned into numbers. */
export type PortalReviewSettings = {
  /** Above this total, the bon waits for validation. FCFA. */
  reviewThresholdAmount: number
  /** …or above this fraction of the category's monthly ceiling, whichever is lower. */
  reviewThresholdRatio: number
  /** "Unusual" = more than this multiple of the family's category median. */
  unusualAmountMultiple: number
  /** Gap between entered and read total that raises OCR_MISMATCH. Fraction. */
  ocrMismatchTolerance: number
}

/** The defaults of the `IpmPortalSettings` columns, for a firm with no row. */
export const DEFAULT_PORTAL_REVIEW_SETTINGS: PortalReviewSettings = {
  reviewThresholdAmount: 100_000,
  reviewThresholdRatio: 0.5,
  unusualAmountMultiple: 3,
  ocrMismatchTolerance: 0.15,
}

type Numeric = number | string | { toString(): string }

/** The boundary: a Prisma row (Decimal columns) to plain numbers. */
export function toReviewSettings(
  row: Record<keyof PortalReviewSettings, Numeric> | null
): PortalReviewSettings {
  if (!row) return DEFAULT_PORTAL_REVIEW_SETTINGS
  return {
    reviewThresholdAmount: Number(row.reviewThresholdAmount),
    reviewThresholdRatio: Number(row.reviewThresholdRatio),
    unusualAmountMultiple: Number(row.unusualAmountMultiple),
    ocrMismatchTolerance: Number(row.ocrMismatchTolerance),
  }
}

export type ReviewFacts = {
  totalAmount: number
  /** The category's monthly ceiling from the barème, when there is one. */
  ceilingMonthly: number | null
  settings: PortalReviewSettings
  /** Totals of earlier bons in the same category for the same family. */
  previousTotals: number[]
  /** Same beneficiary, same provider, same calendar day, still live. */
  sameDayDuplicate: boolean
  /** dHash of this receipt and of every earlier receipt. */
  receiptHash: string | null
  previousReceiptHashes: string[]
  /** Total read off the receipt, when it was scanned. */
  ocrTotal: number | null
}

export type ReviewDecision = {
  hold: boolean
  flags: IpmReviewFlag[]
  /** The threshold that applied — shown to the participant when held. */
  threshold: number
}

export function reviewThreshold(
  settings: PortalReviewSettings,
  ceilingMonthly: number | null
): number {
  const byRatio =
    ceilingMonthly === null
      ? Number.POSITIVE_INFINITY
      : ceilingMonthly * settings.reviewThresholdRatio
  return Math.min(settings.reviewThresholdAmount, byRatio)
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Bits that differ between two 64-bit hex hashes. */
export function hamming(a: string, b: string): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY
  let distance = 0
  for (let i = 0; i < a.length; i += 1) {
    let x = Number.parseInt(a[i], 16) ^ Number.parseInt(b[i], 16)
    while (x) {
      distance += x & 1
      x >>= 1
    }
  }
  return distance
}

/** Two photos of the same paper differ by a few bits; different tickets by ~30. */
export const SAME_RECEIPT_MAX_DISTANCE = 6

/** Below three earlier bons there is no "usual" to compare against. */
const MIN_HISTORY_FOR_UNUSUAL = 3

export function decideReview(facts: ReviewFacts): ReviewDecision {
  const flags: IpmReviewFlag[] = []
  const threshold = reviewThreshold(facts.settings, facts.ceilingMonthly)

  const hold = facts.totalAmount > threshold
  if (hold) flags.push("ABOVE_THRESHOLD")

  if (facts.previousTotals.length >= MIN_HISTORY_FOR_UNUSUAL) {
    const usual = median(facts.previousTotals)
    if (
      usual !== null &&
      facts.totalAmount > usual * facts.settings.unusualAmountMultiple
    ) {
      flags.push("AMOUNT_UNUSUAL")
    }
  }

  if (facts.sameDayDuplicate) flags.push("SAME_DAY_DUPLICATE")

  if (
    facts.receiptHash &&
    facts.previousReceiptHashes.some(
      (previous) =>
        hamming(previous, facts.receiptHash!) <= SAME_RECEIPT_MAX_DISTANCE
    )
  ) {
    flags.push("RECEIPT_REUSED")
  }

  if (facts.ocrTotal !== null && facts.ocrTotal > 0) {
    const gap = Math.abs(facts.totalAmount - facts.ocrTotal) / facts.ocrTotal
    if (gap > facts.settings.ocrMismatchTolerance) flags.push("OCR_MISMATCH")
  }

  return { hold, flags, threshold }
}

export const FLAG_LABELS: Record<IpmReviewFlag, string> = {
  ABOVE_THRESHOLD: "Montant au-dessus du seuil de validation",
  AMOUNT_UNUSUAL: "Montant inhabituel pour cette catégorie",
  SAME_DAY_DUPLICATE: "Autre bon le même jour, même prestataire",
  RECEIPT_REUSED: "Reçu déjà utilisé pour un autre bon",
  OCR_MISMATCH: "Montant différent de celui lu sur le reçu",
  // Not in the portal's copy: added with this schema, see IpmReviewFlag.
  ISSUANCE_WARNING: "Avertissement à l'émission (cotisations en retard ou convention échue)",
}
