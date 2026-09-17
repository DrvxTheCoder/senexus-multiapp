import "server-only"

import { existsSync } from "node:fs"
import { join } from "node:path"

import { Font } from "@react-pdf/renderer"

/**
 * Les polices des documents imprimés.
 *
 * Same constraint as the card renderer, different renderer: `Font.register`
 * reads raw SFNT, so it wants the TTFs `scripts/build-fonts.mjs` unpacks out
 * of the vendored `@fontsource` WOFFs. Handed a WOFF, fontkit throws from
 * inside the layout pass — after the route has already started streaming, with
 * a stack that says nothing about fonts.
 *
 * ## Two families, deliberately
 *
 * **DocSans** (IBM Plex Sans) is the body: four weights, because a printed
 * form distinguishes a label from its value from a total by weight rather than
 * by size, and at 7.5pt in a table cell there is no size left to spend.
 *
 * **DocDisplay** (Montserrat, 700 only) is the title band and nothing else. It
 * is the card's face, so a bon and a carte read as the same institution's
 * paper — but it is a display face, and set at 8pt in a table it loses the
 * weight contrast the body face exists to provide.
 *
 * ## Why registration is lazy and once
 *
 * `Font.register` mutates a module-level store in react-pdf. Called at import
 * time it would run during the Next.js build, where `process.cwd()` is not the
 * server's — the same trap `render-card.ts` documents — and called per render
 * it would re-read six files on every download.
 */

export const DOC_SANS = "DocSans"
export const DOC_DISPLAY = "DocDisplay"

const FACES = [
  { file: "DocSans-Regular.ttf", family: DOC_SANS, fontWeight: 400 as const },
  { file: "DocSans-Medium.ttf", family: DOC_SANS, fontWeight: 500 as const },
  { file: "DocSans-SemiBold.ttf", family: DOC_SANS, fontWeight: 600 as const },
  { file: "DocSans-Bold.ttf", family: DOC_SANS, fontWeight: 700 as const },
  {
    file: "DocSans-Italic.ttf",
    family: DOC_SANS,
    fontWeight: 400 as const,
    fontStyle: "italic" as const,
  },
  { file: "DocDisplay-Bold.ttf", family: DOC_DISPLAY, fontWeight: 700 as const },
]

let registered = false

export function registerDocumentFonts(): void {
  if (registered) return

  const dir = join(process.cwd(), "public", "fonts", "pdf")
  const missing = FACES.map((face) => join(dir, face.file)).filter(
    (path) => !existsSync(path)
  )

  // Loud, and before anything renders. react-pdf's own failure for a missing
  // face is to substitute Helvetica silently, which reflows every box on a
  // form that was measured for these metrics — invisible until the document
  // is printed and the boxes no longer line up with what is written in them.
  if (missing.length) {
    throw new Error(
      `Document fonts are missing: ${missing.join(", ")}. ` +
        `Run \`node scripts/build-fonts.mjs\`.`
    )
  }

  for (const face of FACES) {
    Font.register({
      family: face.family,
      fonts: [
        {
          src: join(dir, face.file),
          fontWeight: face.fontWeight,
          ...(face.fontStyle ? { fontStyle: face.fontStyle } : {}),
        },
      ],
    })
  }

  /**
   * No hyphenation.
   *
   * react-pdf hyphenates with an English pattern set, and on French it breaks
   * in places French does not: `parti-cipant`, `ACCOU-CHEMENT`. On a document
   * that is mostly proper nouns and legal phrases in labelled boxes, that is
   * never an improvement over a slightly looser line.
   */
  Font.registerHyphenationCallback((word) => [word])

  registered = true
}
