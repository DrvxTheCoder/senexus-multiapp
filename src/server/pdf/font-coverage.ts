import { readFileSync } from "node:fs"

/**
 * Quels caractères une police sait réellement dessiner.
 *
 * This exists because of a bug that reached paper. The amount formatter
 * grouped thousands with U+202F — the narrow no-break space, which is the
 * typographically correct character for French and is what
 * `Intl.NumberFormat("fr-FR")` returns. It is **not** in the latin subset the
 * document fonts are built from, so fontkit drew `.notdef` for it, and in IBM
 * Plex Sans `.notdef` is a vertical bar. Every amount on every bon, facture
 * and bon de décaissement printed as `27|500 FCFA`.
 *
 * Nothing failed. No exception, no warning, no log line — the document
 * rendered, and the defect was only visible by looking at it. That is the
 * whole argument for this module: a glyph the font does not have is a silent
 * error, and the only way to catch one is to ask the font.
 *
 * Deliberately a hand-rolled `cmap` reader rather than pulling in fontkit's
 * public API: this has to work on the *file on disk*, before `Font.register`
 * has been anywhere near it, and it needs no shaping, no metrics and no
 * layout — only the question "is there a glyph for this code point".
 */

/**
 * The code points a font maps to a glyph, read out of its `cmap` table.
 *
 * Reads a format 4 subtable (the Unicode BMP mapping every one of these
 * latin-subset faces uses) and format 12 where present. Anything outside the
 * BMP is not something these documents print.
 */
export function supportedCodePoints(fontPath: string): Set<number> {
  const font = readFileSync(fontPath)
  const covered = new Set<number>()

  const tableCount = font.readUInt16BE(4)
  let cmapOffset: number | null = null
  for (let index = 0; index < tableCount; index += 1) {
    const entry = 12 + index * 16
    if (font.toString("latin1", entry, entry + 4) === "cmap") {
      cmapOffset = font.readUInt32BE(entry + 8)
    }
  }
  if (cmapOffset === null) return covered

  const subtableCount = font.readUInt16BE(cmapOffset + 2)
  const subtables: number[] = []
  for (let index = 0; index < subtableCount; index += 1) {
    const entry = cmapOffset + 4 + index * 8
    const platform = font.readUInt16BE(entry)
    const encoding = font.readUInt16BE(entry + 2)
    // Windows BMP / Windows full / Unicode. Mac Roman is skipped: it maps a
    // different set and would report coverage the renderer will not use.
    const unicode =
      (platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0
    if (unicode) subtables.push(cmapOffset + font.readUInt32BE(entry + 4))
  }

  for (const subtable of subtables) {
    const format = font.readUInt16BE(subtable)

    if (format === 4) {
      const segmentsX2 = font.readUInt16BE(subtable + 6)
      const endCodes = subtable + 14
      const startCodes = endCodes + segmentsX2 + 2
      for (let segment = 0; segment < segmentsX2 / 2; segment += 1) {
        const end = font.readUInt16BE(endCodes + segment * 2)
        const start = font.readUInt16BE(startCodes + segment * 2)
        // 0xFFFF terminates the last segment and is not a real character.
        for (let code = start; code <= end && code !== 0xffff; code += 1) {
          covered.add(code)
        }
      }
    }

    if (format === 12) {
      const groups = font.readUInt32BE(subtable + 12)
      for (let group = 0; group < groups; group += 1) {
        const entry = subtable + 16 + group * 12
        const start = font.readUInt32BE(entry)
        const end = font.readUInt32BE(entry + 4)
        for (let code = start; code <= end; code += 1) covered.add(code)
      }
    }
  }

  return covered
}

/**
 * The code points in `text` that `fontPath` cannot draw.
 *
 * Combining marks and the characters a renderer never sees — the ASCII
 * controls — are not reported: `\n` is a layout instruction, not a glyph.
 */
export function unsupportedIn(text: string, covered: Set<number>): string[] {
  const missing = new Set<string>()
  for (const character of text) {
    const code = character.codePointAt(0)!
    if (code < 0x20) continue
    if (!covered.has(code)) missing.add(character)
  }
  return [...missing]
}

/** Every face the documents are set in. Kept beside the registration list. */
export const DOCUMENT_FACES = [
  "DocSans-Regular",
  "DocSans-Medium",
  "DocSans-SemiBold",
  "DocSans-Bold",
  "DocSans-Italic",
  "DocDisplay-Bold",
] as const
