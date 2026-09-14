/**
 * WOFF → TTF, for the card renderer.
 *
 * resvg reads raw SFNT (TTF/OTF) only. Handed a WOFF it neither converts nor
 * complains — it renders the card with **no text at all**, silently, which is
 * exactly the invisible failure that shows up after the cards are printed.
 *
 * ## Why Montserrat, and why these weights
 *
 * The artwork is set in Tahoma Bold and Arial Bold, neither of which is
 * redistributable or present on the container. Montserrat is the closest
 * freely-licensed match to the reference card's geometric, heavy-bold look —
 * closer than IBM Plex Sans, whose humanist letterforms read too light beside
 * the original.
 *
 * **Every text class in the artwork is `font-weight: 700`.** Shipping only 400
 * and 600 is what made the first render look thin: resvg has no 700 face to
 * pick, so it substitutes the nearest one silently. 400/700 are both packaged
 * here so the regular and bold faces each resolve exactly rather than being
 * synthesised.
 *
 * The source WOFFs come from `@fontsource/montserrat`, so the licence is
 * vendored with the repo and the build needs no network.
 *
 * WOFF1 is an SFNT whose tables are individually zlib-compressed behind a
 * 44-byte header and a directory — so unpacking it is a header rewrite and a
 * per-table inflate, which `node:zlib` already does.
 *
 * Run: node scripts/build-card-fonts.mjs
 */
import { inflateSync } from "node:zlib"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

const FONTSOURCE = "node_modules/@fontsource/montserrat/files"

const SOURCES = [
  [`${FONTSOURCE}/montserrat-latin-400-normal.woff`, "public/fonts/card/CardSans-Regular.ttf"],
  [`${FONTSOURCE}/montserrat-latin-700-normal.woff`, "public/fonts/card/CardSans-Bold.ttf"],
]

function woffToSfnt(woff) {
  if (woff.readUInt32BE(0) !== 0x774f4646) {
    throw new Error("not a WOFF file (bad magic)")
  }

  const flavor = woff.readUInt32BE(4)
  const numTables = woff.readUInt16BE(12)

  // SFNT header: flavor, numTables, then the binary-search fields.
  const entrySelector = Math.floor(Math.log2(numTables))
  const searchRange = 2 ** entrySelector * 16
  const rangeShift = numTables * 16 - searchRange

  const header = Buffer.alloc(12)
  header.writeUInt32BE(flavor, 0)
  header.writeUInt16BE(numTables, 4)
  header.writeUInt16BE(searchRange, 6)
  header.writeUInt16BE(entrySelector, 8)
  header.writeUInt16BE(rangeShift, 10)

  const directory = Buffer.alloc(numTables * 16)
  const tables = []
  // Tables start after the header and directory, each aligned to 4 bytes.
  let offset = 12 + numTables * 16

  for (let index = 0; index < numTables; index += 1) {
    const entry = 44 + index * 20
    const tag = woff.readUInt32BE(entry)
    const tableOffset = woff.readUInt32BE(entry + 4)
    const compLength = woff.readUInt32BE(entry + 8)
    const origLength = woff.readUInt32BE(entry + 12)
    const checksum = woff.readUInt32BE(entry + 16)

    const raw = woff.subarray(tableOffset, tableOffset + compLength)
    // A table is stored uncompressed when the two lengths match.
    const data = compLength === origLength ? raw : inflateSync(raw)
    if (data.length !== origLength) {
      throw new Error(
        `table ${index}: inflated to ${data.length}, expected ${origLength}`
      )
    }

    directory.writeUInt32BE(tag, index * 16)
    directory.writeUInt32BE(checksum, index * 16 + 4)
    directory.writeUInt32BE(offset, index * 16 + 8)
    directory.writeUInt32BE(origLength, index * 16 + 12)

    tables.push(data)
    offset += Math.ceil(origLength / 4) * 4
  }

  const padded = tables.map((table) => {
    const size = Math.ceil(table.length / 4) * 4
    if (size === table.length) return table
    const block = Buffer.alloc(size)
    table.copy(block)
    return block
  })

  return Buffer.concat([header, directory, ...padded])
}

mkdirSync(join(ROOT, "public/fonts/card"), { recursive: true })

for (const [from, to] of SOURCES) {
  const ttf = woffToSfnt(readFileSync(join(ROOT, from)))
  writeFileSync(join(ROOT, to), ttf)
  console.log(`${from} → ${to} (${ttf.length} bytes)`)
}
