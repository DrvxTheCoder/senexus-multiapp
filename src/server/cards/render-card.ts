import "server-only"

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import QRCode from "qrcode"
import sharp from "sharp"
import { Resvg } from "@resvg/resvg-js"

import {
  ARTBOARD_RATIO,
  CARD_FONT_FAMILY,
  QR,
  renderBack,
  renderFront,
  type CardData,
} from "@/server/cards/card-core"

/**
 * Rendu des cartes — the artwork, filled in.
 *
 * The pipeline is **SVG template → string substitution → resvg**. There is no
 * layout engine in it, and that is the point: the two files under `templates/`
 * are the production artwork, and every coordinate in them is a design
 * decision that this module has no licence to recompute. It fills slots.
 *
 * This replaced a Satori renderer that built the card from JSX-shaped objects.
 * That approach cannot express the approved artwork — the curved teal panel,
 * the clipped photo circle, the kerned legal paragraph — so the layout it drew
 * was necessarily a different card from the one the institution signed off.
 *
 * ## Colour
 *
 * resvg writes RGB, and PNG has no CMYK at all — that is the file format, not
 * a resvg limitation, so "CMYK at 300 ppi as a PNG" cannot exist. `png()`
 * returns sRGB with the density written in; `printTiff()` returns a real CMYK
 * TIFF for the printer.
 *
 * `sharp.withMetadata()` must not be used on the CMYK path: it re-tags the
 * image as sRGB and converts it back, silently undoing the conversion. The
 * density goes through `tiff({ xres, yres })`, which keeps both.
 */

/* ==========================================================================
 * Templates and fonts
 * ========================================================================== */

/**
 * Read from disk at call time, not imported.
 *
 * `readFileSync` at module scope would run during the Next.js build, where the
 * working directory is not the server's; resolving per call against
 * `process.cwd()` keeps it correct in a production build as well as in dev.
 * The result is cached, so it is one read per process either way.
 */
const templates = new Map<string, string>()

function template(name: "card-front" | "card-back"): string {
  let cached = templates.get(name)
  if (!cached) {
    cached = readFileSync(
      join(process.cwd(), "src", "server", "cards", "templates", `${name}.svg`),
      "utf8"
    )
    templates.set(name, cached)
  }
  return cached
}

/**
 * The card's typeface.
 *
 * The artwork calls Tahoma Bold and Arial Bold. Neither is redistributable,
 * neither is on the container, and resvg substitutes a face silently — which
 * shifts every metric on the card and stays invisible until the cards are
 * printed. So the card is set in Montserrat, the closest freely-licensed match
 * to the reference card's geometric bold, and `card-core` fits the
 * variable-length strings to their boxes to absorb the difference in metrics.
 *
 * Both 400 and 700 are bundled: every text class in the artwork is weight 700,
 * and with no bold face to resolve resvg quietly substitutes a lighter one.
 *
 * **These must be TTF, not the WOFF the app serves to browsers.** resvg reads
 * raw SFNT only: handed a WOFF it neither converts nor complains, and renders
 * the card with no text at all. `scripts/build-card-fonts.mjs` unpacks the
 * WOFFs into `public/fonts/card/`, and the check below turns a missing file
 * into a loud failure rather than a blank card.
 *
 * `loadSystemFonts` is off deliberately: on a machine that happens to have
 * Tahoma the card would render differently from the container, which is the
 * failure this is meant to prevent.
 */
let fontFilesCache: string[] | null = null

function fontFiles(): string[] {
  if (fontFilesCache) return fontFilesCache

  const dir = join(process.cwd(), "public", "fonts", "card")
  const files = [
    join(dir, "CardSans-Regular.ttf"),
    join(dir, "CardSans-Bold.ttf"),
  ]

  const missing = files.filter((file) => !existsSync(file))
  if (missing.length) {
    throw new Error(
      `Card fonts are missing: ${missing.join(", ")}. ` +
        `Run \`node scripts/build-card-fonts.mjs\`. Rendering without them ` +
        `produces a card with no text on it.`
    )
  }

  fontFilesCache = files
  return files
}

/* ==========================================================================
 * QR
 * ========================================================================== */

/**
 * The verification URL as a module matrix.
 *
 * The card's QR box holds 33 modules on the artwork's 1.3804 pitch — about
 * 15 mm printed, at 0.46 mm per module. `qrRects` refuses anything larger
 * rather than printing a code nobody can scan, so the URL handed in has to
 * stay short: **62 bytes at error-correction level M, origin included.**
 *
 * That is a real constraint on the caller, not a detail, and it is the reason
 * `verification-token.ts` packs its fields the way it does. A production URL
 * lands near 60 characters, which leaves very little room — so a longer
 * domain, or a matricule with a long employer prefix, can still push a card
 * over. `qrFits` is how a caller checks before rendering; the route logs and
 * omits rather than printing an unreadable symbol.
 */
export function qrMatrix(url: string): boolean[][] {
  const symbol = QRCode.create(url, { errorCorrectionLevel: "M" })
  const size = symbol.modules.size
  const data = symbol.modules.data

  const matrix: boolean[][] = []
  for (let row = 0; row < size; row += 1) {
    const line: boolean[] = []
    for (let column = 0; column < size; column += 1) {
      line.push(Boolean(data[row * size + column]))
    }
    matrix.push(line)
  }
  return matrix
}

/** True when `url` fits the artwork's box. Lets a caller check before rendering. */
export function qrFits(url: string): boolean {
  try {
    return QRCode.create(url, { errorCorrectionLevel: "M" }).modules.size <= QR.modules
  } catch {
    return false
  }
}

/* ==========================================================================
 * Faces
 * ========================================================================== */

export type CardFace = "recto" | "verso"

export type RenderOptions = {
  /** Rendered width in pixels. Height follows the artwork's aspect ratio. */
  width?: number
}

/**
 * The trim width the printed file is tagged for, in millimetres.
 *
 * **An assumption, and the only place it is made.** The artwork's 161.57 user
 * units are not millimetres, so nothing in the file says how wide the card is;
 * until the print shop confirms the trim, a density has to come from somewhere
 * or the PNG claims 72 dpi and prints at three times its size.
 *
 * 54 mm is the width of every card in this family — ID-1 and the 54 × 84 that
 * was guessed elsewhere agree on it, and they differ only in height. So it is
 * the safest of the available assumptions, and it is stated rather than buried
 * in an expression.
 */
export const ASSUMED_TRIM_WIDTH_MM = 54

/** 300 ppi at the assumed trim width: 54 mm → 638 px. */
export const PRINT_WIDTH = Math.round((ASSUMED_TRIM_WIDTH_MM / 25.4) * 300)

/** 150 ppi, for the on-screen preview. */
export const PREVIEW_WIDTH = Math.round(PRINT_WIDTH / 2)

/** The ppi a file of `width` pixels carries, at the assumed trim. */
function densityFor(width: number): number {
  return Math.round(width / (ASSUMED_TRIM_WIDTH_MM / 25.4))
}

export function faceSvg(face: CardFace, data: CardData): string {
  if (face === "verso") return renderBack(template("card-back"), data)

  const matrix =
    data.verificationUrl ? qrMatrix(data.verificationUrl) : null
  return renderFront(template("card-front"), data, matrix)
}

/* ==========================================================================
 * Output
 * ========================================================================== */

function rasterise(svg: string, width: number): Buffer {
  return new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: {
      fontFiles: fontFiles(),
      loadSystemFonts: false,
      defaultFontFamily: CARD_FONT_FAMILY,
    },
  })
    .render()
    .asPng()
}

/** Height for a given width, from the artwork's own ratio. */
export function heightFor(width: number): number {
  return Math.round(width * ARTBOARD_RATIO)
}

/** sRGB PNG with the pixel density written in. */
export async function renderCardPng(
  face: CardFace,
  data: CardData,
  options: RenderOptions = {}
): Promise<Buffer> {
  const width = options.width ?? PRINT_WIDTH
  const raw = rasterise(faceSvg(face, data), width)

  // resvg emits no pHYs chunk. Without a density the file claims 72 dpi and a
  // card is placed at roughly three times its size.
  return sharp(raw).withMetadata({ density: densityFor(width) }).png().toBuffer()
}

/**
 * A real CMYK TIFF for the printer.
 *
 * TIFF rather than PNG because PNG has no CMYK, and rather than JPEG because a
 * card is flat colour and type, where JPEG artefacts show.
 *
 * No bleed is added. The trim size is unconfirmed, so a bleed box here would
 * be a guess printed onto plastic; the file is the artboard exactly as drawn,
 * and bleed is added once the print shop states the trim.
 */
export async function renderCardPrintTiff(
  face: CardFace,
  data: CardData,
  options: RenderOptions = {}
): Promise<Buffer> {
  const width = options.width ?? PRINT_WIDTH
  const raw = rasterise(faceSvg(face, data), width)
  // TIFF resolution is per *millimetre* here, where PNG's is per inch.
  const perMm = densityFor(width) / 25.4

  return sharp(raw)
    .flatten({ background: "#ffffff" })
    .toColourspace("cmyk")
    .tiff({ compression: "lzw", xres: perMm, yres: perMm })
    .toBuffer()
}
