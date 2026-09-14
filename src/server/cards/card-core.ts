/**
 * Carte adhérent IPM Tawfeikh — the render core.
 *
 * Pure: no Node imports, no database, no filesystem. It takes the two template
 * strings as arguments and returns SVG strings, so the same algorithm can be
 * exercised from a test without a runtime around it.
 *
 * ## The rule this module exists to enforce
 *
 * The artwork is the specification. Every coordinate, path, colour and
 * font-size in `templates/*.svg` came out of Illustrator and is not ours to
 * change; this module only fills slots. The one deliberate departure is the
 * typeface, and the fitter below exists precisely because of it.
 *
 * ## Why there is a fitter at all
 *
 * The artwork calls Tahoma Bold and Arial Bold. Neither is redistributable,
 * neither is on the container, and resvg substitutes silently — a wrong face
 * shifts every metric and the failure is invisible until the cards are
 * printed. So the card is set in Montserrat, the closest freely-licensed match
 * to the reference card's geometric bold.
 *
 * That makes text *slightly* wider or narrower than the artwork assumed, and
 * an overset name would run off the artboard. Rather than let that happen, the
 * three variable-length slots are measured and shrunk to fit their box. A name
 * that fits keeps the artwork's own size; only a long one moves.
 */

/* ==========================================================================
 * The artboard
 * ========================================================================== */

/**
 * Both faces are 161.57 × 246.61 user units — a ratio of 0.655.
 *
 * **The physical trim size is unresolved.** This is not ISO ID-1 (53.98 ×
 * 85.6 mm is 0.631) and it is not the 54 × 84 mm that was guessed elsewhere
 * (0.643). Until the print shop confirms the trim, nothing here converts user
 * units to millimetres and no imposition maths is derived from them: a card
 * laid out against a guessed trim is a box of unusable plastic.
 *
 * Renders are therefore specified by pixel width, and the aspect ratio is
 * taken from the artwork itself.
 */
export const ARTBOARD = {
  width: 161.57,
  height: 246.61,
} as const

export const ARTBOARD_RATIO = ARTBOARD.height / ARTBOARD.width

/**
 * The font family the templates reference.
 *
 * Must match the family name embedded in the TTFs that
 * `scripts/build-card-fonts.mjs` produces, or resvg falls back silently.
 */
export const CARD_FONT_FAMILY = "Montserrat"

/* ==========================================================================
 * Text fitting
 * ========================================================================== */

/**
 * Per-character advance widths for Montserrat Bold, in em.
 *
 * A table rather than a real shaper because the alternative — parsing the font
 * to read its hmtx — costs a font parser on a hot path to place four strings.
 * The figures are measured off the actual bundled face by rendering each
 * character class and reading the ink extent, then rounded *up*: the failure
 * that matters is text overflowing the artboard, so erring wide shrinks a
 * borderline string rather than clipping it.
 *
 * Montserrat is appreciably wider than a humanist face at the same size —
 * capitals run 0.73em against IBM Plex's 0.68 — so these must be re-measured
 * if the card's typeface changes again.
 */
const WIDE = new Set("MW@%".split(""))
const NARROW = new Set("iIljt.,;:'|!()[]{}/\\".split(""))
const SPACE_EM = 0.29
const DIGIT_EM = 0.6

export function emWidth(text: string): number {
  let em = 0
  for (const char of text) {
    if (char === " ") em += SPACE_EM
    else if (char >= "0" && char <= "9") em += DIGIT_EM
    else if (WIDE.has(char)) em += 1.0
    else if (NARROW.has(char)) em += 0.3
    else if (char === char.toUpperCase() && char !== char.toLowerCase()) em += 0.74
    else em += 0.6
  }
  return em
}

/**
 * The largest size at or below `preferred` that keeps `text` inside `maxWidth`.
 *
 * Never returns more than the artwork's own size — a short name must not grow
 * to fill its box, because the artwork's sizes are a design decision. It only
 * ever shrinks, and never below `min`, where the text is clipped in preference
 * to becoming unreadable.
 */
export function fitFontSize(
  text: string,
  maxWidth: number,
  preferred: number,
  min = 3
): number {
  if (!text) return preferred
  const width = emWidth(text) * preferred
  if (width <= maxWidth) return preferred
  return Math.max(min, Math.floor((maxWidth / emWidth(text)) * 100) / 100)
}

/** Truncates to `maxChars`, with an ellipsis, so a caption cannot spill. */
export function clamp(text: string, maxChars: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed
  return `${trimmed.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`
}

/* ==========================================================================
 * XML
 * ========================================================================== */

/**
 * Escapes text before it is substituted into the template.
 *
 * Non-negotiable: a name containing `&` or `<` produces an SVG that resvg
 * refuses to parse, so without this a participant called "Diop & Fils" breaks
 * card generation entirely.
 */
export function xml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

/* ==========================================================================
 * Slot geometry, read off the artwork
 * ========================================================================== */

/**
 * Holder name: starts at x=41.91, set at 11px in the artwork.
 *
 * The artboard is 161.57 wide, so 119.66 units remain to the right edge; the
 * budget keeps a 5-unit margin off that edge rather than setting type flush to
 * the trim, which no printer can hold.
 */
const NAME = { x: 41.91, size: 11, maxWidth: 114 } as const

/** The photo circle on the front: cx/cy/r from the artwork's clipPath. */
const PHOTO = { cx: 80.79, cy: 75.89, r: 36.21 } as const

/**
 * The artboard's horizontal centre, which is also the photo circle's `cx`.
 *
 * Every variable line on the card is centred on this. The artwork's own `x`
 * offsets are left edges measured for the literal placeholder strings
 * ("PRENOM NOM", "2960"), so reusing them puts a real name of any other length
 * visibly off-centre — which is what the first proofs showed.
 */
const CENTRE = ARTBOARD.width / 2

/** The two runs of "Matricule : 01704", at the artwork's sizes. */
const MATRICULE = { labelSize: 5, valueSize: 5, gap: 1.6 } as const

/**
 * The QR block, read off the artwork's own rect grid: 29 columns from
 * x=60.42 to x=99.07, 29 rows from y=177.78, on a 1.3804 pitch.
 *
 * 29 modules is already close to the point where a 14 mm printed box stops
 * scanning reliably, which is why `qrMatrix` refuses a payload that needs a
 * larger symbol rather than silently printing one nobody can read.
 */
export const QR = {
  originX: 60.42,
  originY: 177.78,
  module: 1.3804,
  /** The artwork's own module count. A symbol larger than this will not fit. */
  modules: 29,
  colour: "#028f9d",
} as const

/**
 * The nine ayant-droit boxes on the back, at the artwork's coordinates, **in
 * reading order** — left to right, top to bottom.
 *
 * The order is the contract: `renderBack` fills box *n* with dependant *n*,
 * so this array is what decides where the fourth ayant droit lands. The
 * artwork's own document order is not reading order — Illustrator emits the
 * rectangles in whatever order they were drawn — and transcribing it verbatim
 * put the fourth dependant in the middle of the second row with the first
 * cell left empty, which is what the printed proof showed.
 *
 * Row 2 and row 3 differ by hundredths of a unit between columns (105.64 vs
 * 105.67) because each rectangle was placed by hand; those are the artwork's
 * own values and are kept rather than regularised.
 */
export const DEPENDENT_BOXES = [
  { x: 15.93, y: 53.94, tx: 25.63, ty: 97.84 },
  { x: 61.49, y: 54.13, tx: 71.47, ty: 98.03 },
  { x: 107.05, y: 54.13, tx: 117.03, ty: 98.03 },
  { x: 15.93, y: 105.64, tx: 25.91, ty: 149.6 },
  { x: 61.49, y: 105.67, tx: 71.19, ty: 149.57 },
  { x: 107.05, y: 105.67, tx: 116.75, ty: 149.57 },
  { x: 15.93, y: 157.18, tx: 25.91, ty: 201.14 },
  { x: 61.49, y: 157.21, tx: 71.19, ty: 201.12 },
  { x: 107.05, y: 157.21, tx: 116.75, ty: 201.12 },
] as const

const BOX = { size: 39.73, radius: 3.1, stroke: "#028f9d", strokeWidth: 0.5 } as const
const CAPTION = { size: 3.2, fill: "#0c7986", maxWidth: 34 } as const

/** How many ayants droit the back can show. */
export const DEPENDENT_CAPACITY = DEPENDENT_BOXES.length

/* ==========================================================================
 * Card data — the contract
 * ========================================================================== */

export type CardPhoto = string | null

export type CardDependent = {
  firstName: string
  lastName: string
  /** Already-localised relation label, e.g. "Épouse". */
  relationLabel: string
  photo: CardPhoto
}

export type CardCoverage = {
  /** The category label as configured, e.g. "Soins". */
  label: string
  /** Fraction 0..1, as stored. */
  rate: number
}

export type CardData = {
  matricule: string
  firstName: string
  lastName: string
  birthDate: string | null
  birthPlace: string | null
  photo: CardPhoto
  /** Up to two rated categories; the artwork has room for exactly two. */
  coverage: CardCoverage[]
  dependents: CardDependent[]
  /** Absolute URL the QR resolves to, or null to leave the block blank. */
  verificationUrl: string | null
}

/* ==========================================================================
 * Lines
 * ========================================================================== */

/** `1979-03-20` → `20/03/1979`. A card is read by people, not by a parser. */
export function frenchDate(iso: string | null): string | null {
  if (!iso) return null
  const [year, month, day] = iso.split("-")
  return year && month && day ? `${day}/${month}/${year}` : iso
}

/**
 * "né le 20/03/1979 à TIVAOUNE", degrading cleanly.
 *
 * Both halves are optional in the data, so each is omitted rather than printed
 * as an empty fragment; with neither, the line is blank instead of reading
 * "né le à".
 */
export function birthLine(date: string | null, place: string | null): string {
  const when = frenchDate(date)
  const where = place?.trim()
  if (!when && !where) return ""
  if (!when) return `à ${where}`
  if (!where) return `né le ${when}`
  return `né le ${when} à ${where}`
}

/**
 * "Prise en charge Soins 50% Pharmacie 50%".
 *
 * The artwork prints exactly two categories, but categories are configurable
 * rows and this firm has five — so the caller passes the two that resolved to
 * a real rate and their own labels are used. A category with no barème never
 * reaches here: the card must not assert a rate nobody chose.
 */
export function coverageLine(coverage: CardCoverage[]): string {
  if (!coverage.length) return ""
  const parts = coverage.map(
    (entry) => `${entry.label} ${Math.round(entry.rate * 100)}%`
  )
  return `Prise en charge ${parts.join(" ")}`
}

/** "DIOP Awa" — surname upper-cased, the way the artwork sets it. */
export function holderName(firstName: string, lastName: string): string {
  return `${lastName.toUpperCase()} ${firstName}`.trim()
}

/* ==========================================================================
 * Fragments
 * ========================================================================== */

/**
 * A head-and-shoulders silhouette, drawn to fill a circle.
 *
 * A missing photo is a valid state, not an error — most of the register has no
 * photograph yet, and refusing to print those cards would be refusing to print
 * almost all of them.
 */
export function silhouetteShapes(cx: number, cy: number, r: number): string {
  const headR = r * 0.34
  const headCy = cy - r * 0.28
  const bodyR = r * 0.62
  const bodyCy = cy + r * 0.72

  return (
    `<g fill="#c9d6d8">` +
    `<circle cx="${cx}" cy="${headCy.toFixed(2)}" r="${headR.toFixed(2)}"/>` +
    `<circle cx="${cx}" cy="${bodyCy.toFixed(2)}" r="${bodyR.toFixed(2)}"/>` +
    `</g>`
  )
}

export function silhouette(cx: number, cy: number, r: number, id?: string): string {
  const shapes = silhouetteShapes(cx, cy, r)

  // The body circle deliberately extends past the bottom of the frame — that
  // is what makes it read as shoulders rather than a snowman — so it has to
  // be clipped to the frame, or it spills across the caption beneath the box.
  if (!id) return shapes

  return (
    `<defs><clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs>` +
    `<g clip-path="url(#${id})">${shapes}</g>`
  )
}

/**
 * An image clipped to a circle, or the silhouette when there is no photo.
 *
 * The href must already be a data URI: resvg fetches nothing at render time,
 * and a relative or remote href renders as nothing at all — silently, which is
 * the whole reason photos are inlined upstream.
 */
export function circlePhoto(
  photo: CardPhoto,
  cx: number,
  cy: number,
  r: number,
  id: string
): string {
  if (!photo) return silhouette(cx, cy, r, `${id}-sil`)
  const size = r * 2
  return (
    `<defs><clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs>` +
    `<g clip-path="url(#${id})">` +
    `<image x="${cx - r}" y="${cy - r}" width="${size}" height="${size}" ` +
    `preserveAspectRatio="xMidYMid slice" xlink:href="${photo}"/>` +
    `</g>`
  )
}

/**
 * An image clipped to a rounded rectangle, or the silhouette when there is
 * none.
 *
 * This is the shape the ayant-droit boxes use. The photo is inset by half the
 * stroke so it sits *inside* the outline rather than under it, which would
 * otherwise leave the artwork's teal border half-covered on one edge.
 */
export function roundedPhoto(
  photo: CardPhoto,
  x: number,
  y: number,
  size: number,
  radius: number,
  id: string
): string {
  const inset = 0.25
  const px = x + inset
  const py = y + inset
  const ps = size - inset * 2
  const pr = Math.max(0, radius - inset)

  const frame =
    `<rect x="${px}" y="${py}" width="${ps}" height="${ps}" ` +
    `rx="${pr}" ry="${pr}"/>`

  if (!photo) {
    // The silhouette keeps the box's shape too, so an empty-but-occupied box
    // and a filled one read as the same component.
    return (
      `<defs><clipPath id="${id}">${frame}</clipPath></defs>` +
      `<g clip-path="url(#${id})">` +
      silhouetteShapes(x + size / 2, y + size / 2, size / 2) +
      `</g>`
    )
  }

  return (
    `<defs><clipPath id="${id}">${frame}</clipPath></defs>` +
    `<g clip-path="url(#${id})">` +
    `<image x="${px}" y="${py}" width="${ps}" height="${ps}" ` +
    `preserveAspectRatio="xMidYMid slice" xlink:href="${photo}"/>` +
    `</g>`
  )
}

/** One rounded box: outline always, photo and caption when occupied. */
export function dependentBox(
  box: (typeof DEPENDENT_BOXES)[number],
  dependent: CardDependent | undefined,
  index: number
): string {
  const outline =
    `<rect x="${box.x}" y="${box.y}" width="${BOX.size}" height="${BOX.size}" ` +
    `rx="${BOX.radius}" ry="${BOX.radius}" fill="none" ` +
    `stroke="${BOX.stroke}" stroke-width="${BOX.strokeWidth}" stroke-miterlimit="10"/>`

  // An empty box keeps its stroke and carries no placeholder text: the grid is
  // part of the artwork, and "Prénom Nom" printed on a real card would read as
  // a defect.
  if (!dependent) return outline

  // Only the horizontal centre is needed here — the caption is centred on it.
  // The photo derives its own centre from the box it fills.
  const cx = box.x + BOX.size / 2

  // The photo fills the box and is clipped to the box's own rounded rectangle,
  // not to a circle. The artwork draws these as rounded squares — a circular
  // mask inside a square frame leaves four empty corners and reads as a
  // mistake, which is exactly how it looked on the first printed proof.
  const photo = roundedPhoto(
    dependent.photo,
    box.x,
    box.y,
    BOX.size,
    BOX.radius,
    `dep-clip-${index}`
  )

  const name = clamp(
    `${dependent.firstName} ${dependent.lastName}`.trim(),
    22
  )
  const size = fitFontSize(name, CAPTION.maxWidth, CAPTION.size, 2.2)

  // The caption is centred on the box rather than anchored at the artwork's
  // own x: those offsets were measured for the literal string "Prénom Nom",
  // and a real name of any other length would sit off-centre under its box.
  const caption =
    `<text x="${cx.toFixed(2)}" y="${box.ty}" text-anchor="middle" ` +
    `font-family="${CARD_FONT_FAMILY}" font-weight="700" ` +
    `font-size="${size}" fill="${CAPTION.fill}" letter-spacing="-.02em">` +
    `${xml(name)}</text>`

  return outline + photo + caption
}

/* ==========================================================================
 * QR
 * ========================================================================== */

/**
 * Draws a module matrix on the artwork's grid.
 *
 * One `<rect>` per dark module, at the artwork's own origin and pitch, so the
 * generated code occupies exactly the box the design allotted it.
 */
export function qrRects(matrix: boolean[][]): string {
  const size = matrix.length
  if (size === 0) return ""
  if (size > QR.modules) {
    throw new Error(
      `QR payload needs ${size} modules but the artwork's box holds ${QR.modules}. ` +
        `Shorten the verification URL — a denser symbol will not scan at this print size.`
    )
  }

  // Centre a smaller symbol in the artwork's box rather than leaving it in the
  // corner, and keep the artwork's pitch so module size never changes.
  const offset = ((QR.modules - size) / 2) * QR.module
  const parts: string[] = []
  const side = QR.module.toFixed(4)

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      if (!matrix[row]![column]) continue
      const x = (QR.originX + offset + column * QR.module).toFixed(3)
      const y = (QR.originY + offset + row * QR.module).toFixed(3)
      parts.push(`<rect x="${x}" y="${y}" width="${side}" height="${side}"/>`)
    }
  }

  return `<g fill="${QR.colour}" shape-rendering="crispEdges">${parts.join("")}</g>`
}

/* ==========================================================================
 * Faces
 * ========================================================================== */

function fill(template: string, slots: Record<string, string>): string {
  let output = template
  for (const [key, value] of Object.entries(slots)) {
    output = output.split(`{{${key}}}`).join(value)
  }

  // A template that still carries a slot would render the literal braces onto
  // a printed card, so an unfilled one is a hard failure rather than a blemish
  // somebody notices after the batch is cut.
  const leftover = output.match(/\{\{[A-Z_0-9]+\}\}/g)
  if (leftover) {
    throw new Error(`Unfilled card slots: ${[...new Set(leftover)].join(", ")}`)
  }
  return output
}

export function renderFront(
  template: string,
  data: CardData,
  matrix: boolean[][] | null
): string {
  const name = holderName(data.firstName, data.lastName)

  // "Matricule : 01704" is one visual line made of two <text> elements, because
  // the label and the value differ in size and colour. `text-anchor` cannot
  // centre them as a pair, so their x positions are computed here: measure both
  // runs, then lay the whole line out symmetrically about the artboard centre.
  const label = "Matricule :"
  const labelWidth = emWidth(label) * MATRICULE.labelSize
  const valueWidth = emWidth(data.matricule) * MATRICULE.valueSize
  const total = labelWidth + MATRICULE.gap + valueWidth
  const labelX = CENTRE - total / 2

  return fill(template, {
    HOLDER_NAME: xml(name),
    NAME_SIZE: String(fitFontSize(name, NAME.maxWidth, NAME.size, 5)),
    BIRTH_LINE: xml(birthLine(data.birthDate, data.birthPlace)),
    MATRICULE: xml(data.matricule),
    MATRICULE_LABEL_X: labelX.toFixed(2),
    MATRICULE_X: (labelX + labelWidth + MATRICULE.gap).toFixed(2),
    COVERAGE_LINE: xml(coverageLine(data.coverage)),
    PHOTO: circlePhoto(data.photo, PHOTO.cx, PHOTO.cy, PHOTO.r, "holder-clip"),
    QR: matrix ? qrRects(matrix) : "",
  })
}

export function renderBack(template: string, data: CardData): string {
  const shown = data.dependents.slice(0, DEPENDENT_CAPACITY)

  const slots: Record<string, string> = {
    COVERAGE_LINE: xml(coverageLine(data.coverage)),
  }
  DEPENDENT_BOXES.forEach((box, index) => {
    slots[`DEP_${index}`] = dependentBox(box, shown[index], index)
  })

  return fill(template, slots)
}
