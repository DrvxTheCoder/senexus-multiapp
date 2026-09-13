import { ARTBOARD } from "@/server/cards/card-core"

/**
 * The on-screen size of a card preview.
 *
 * Isomorphic on purpose: the client components that lay out a preview need the
 * same numbers the renderer uses, and `server/cards/render-card.ts` cannot be
 * imported into a client bundle — it reaches for `node:fs`, resvg and sharp.
 * `card-core` is pure, so the aspect ratio comes from there rather than being
 * copied.
 *
 * These were hardcoded as 319 × 506 while the renderer drew ISO ID-1. The
 * artwork is not that ratio, so the numbers are derived here and the images
 * stop being stretched the moment the artboard changes.
 */
export const PREVIEW_WIDTH = 319

export const PREVIEW_HEIGHT = Math.round(
  PREVIEW_WIDTH * (ARTBOARD.height / ARTBOARD.width)
)
