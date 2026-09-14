import "server-only"

import sharp from "sharp"

import type { CardData, CardDependent } from "@/server/cards/card-core"
import { DEPENDENT_CAPACITY } from "@/server/cards/card-core"
import type { CardInputs } from "@/server/domain/ipm/card"
import { RELATION_LABELS } from "@/server/domain/ipm/coverage"

/**
 * `CardInputs` → `CardData`.
 *
 * The query layer already assembles everything the card prints; this turns it
 * into what the artwork needs, which means two things the query layer has no
 * opinion about: which rates fit on the card, and turning photo URLs into data
 * URIs small enough to embed.
 */

/* ==========================================================================
 * Coverage
 * ========================================================================== */

/**
 * The artwork prints exactly two categories: "Prise en charge Soins 50%
 * Pharmacie 50%".
 *
 * Categories are configurable rows, though, and this firm has five —
 * Consultation, Soins, Pharmacie, Optique, Hospitalisation. So rather than
 * hardcode two codes, the card prints **the first two categories that resolve
 * to a real rate**, in the firm's own `sortOrder`, under their own labels.
 *
 * Two consequences, both deliberate:
 *
 *   - a category with no barème never appears, because `tryResolveRate`
 *     returned null for it and a card must not assert a rate nobody chose;
 *   - if a firm rates more than two categories, the third onward is not
 *     printed. The artwork has one fixed-width line and no room for a third,
 *     and silently shrinking the type to fit five would produce a line nobody
 *     can read at 4pt.
 */
export function printableCoverage(inputs: CardInputs) {
  return inputs.rates
    .filter(
      (entry): entry is { category: string; rate: number } => entry.rate !== null
    )
    .slice(0, 2)
    .map((entry) => ({ label: entry.category, rate: entry.rate }))
}

/* ==========================================================================
 * Photos
 * ========================================================================== */

/**
 * Fetches a photo and returns it as a data URI, downscaled.
 *
 * resvg fetches nothing at render time: a relative or remote href renders as
 * nothing at all, silently, so every image has to be inlined before it reaches
 * the renderer.
 *
 * Downscaling is not an optimisation here. A card embeds up to ten photographs
 * and a phone camera file is several megabytes; inlined as base64 that is a
 * ~35 MB SVG string per card, which is how bulk generation runs a VPS out of
 * memory. 400 px covers the largest box on the card at print resolution.
 *
 * A failure returns null rather than throwing. A missing photo is a valid
 * state that the renderer draws a silhouette for, and one unreachable file
 * must not take down a batch of twenty cards.
 */
export async function photoDataUri(url: string | null): Promise<string | null> {
  if (!url) return null

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5_000),
      headers: process.env.ZIPLINE_TOKEN
        ? { Authorization: process.env.ZIPLINE_TOKEN }
        : {},
    })
    if (!response.ok) return null

    const type = response.headers.get("content-type") ?? ""
    if (!type.startsWith("image/")) return null

    const jpeg = await sharp(Buffer.from(await response.arrayBuffer()))
      .rotate()
      .resize(400, 400, { fit: "cover", position: "attention" })
      .jpeg({ quality: 80 })
      .toBuffer()

    return `data:image/jpeg;base64,${jpeg.toString("base64")}`
  } catch {
    return null
  }
}

/* ==========================================================================
 * Assembly
 * ========================================================================== */

/**
 * The ayants droit that reach the back, in a deterministic order.
 *
 * The query layer orders by `rank` — the register's own ordering, which an
 * administrator controls. That is kept as the primary key so the same family
 * always prints the same way, with name as a tiebreak so two dependants
 * sharing a rank cannot swap places between two renders of the same card.
 *
 * Ordering matters more than it looks: without it, reprinting a card after an
 * unrelated edit can shuffle the grid, and a participant cannot tell whether
 * their new card is correct.
 */
function orderedDependents(inputs: CardInputs) {
  return inputs.dependents
    .map((dependent, rank) => ({ dependent, rank }))
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        `${left.dependent.lastName} ${left.dependent.firstName}`.localeCompare(
          `${right.dependent.lastName} ${right.dependent.firstName}`,
          "fr"
        )
    )
    .map((entry) => entry.dependent)
}

export type BuildOptions = {
  /** Absolute URL the QR resolves to. Must be short — see qrMatrix. */
  verificationUrl?: string | null
  /** Skip photo fetching. The preview uses this to stay instant. */
  withPhotos?: boolean
}

/**
 * Everything the templates need for one participant.
 *
 * Photos are fetched concurrently: ten sequential round trips to the file host
 * would dominate the render, and a batch of twenty cards would be unusable.
 */
export async function buildCardData(
  inputs: CardInputs,
  options: BuildOptions = {}
): Promise<CardData> {
  const withPhotos = options.withPhotos ?? true
  const shown = orderedDependents(inputs).slice(0, DEPENDENT_CAPACITY)

  const [holderPhoto, dependentPhotos] = withPhotos
    ? await Promise.all([
        photoDataUri(inputs.photoUrl),
        Promise.all(shown.map((entry) => photoDataUri(entry.photoUrl))),
      ])
    : [null, shown.map(() => null)]

  const dependents: CardDependent[] = shown.map((entry, index) => ({
    firstName: entry.firstName,
    lastName: entry.lastName,
    relationLabel:
      RELATION_LABELS[entry.relation as keyof typeof RELATION_LABELS] ??
      entry.relation,
    photo: dependentPhotos[index] ?? null,
  }))

  return {
    matricule: inputs.matricule,
    firstName: inputs.firstName,
    lastName: inputs.lastName,
    birthDate: inputs.birthDate,
    birthPlace: inputs.birthPlace,
    photo: holderPhoto,
    coverage: printableCoverage(inputs),
    dependents,
    verificationUrl: options.verificationUrl ?? null,
  }
}
