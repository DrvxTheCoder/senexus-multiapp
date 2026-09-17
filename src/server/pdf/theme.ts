import "server-only"

import { DOC_DISPLAY, DOC_SANS } from "@/server/pdf/fonts"

/**
 * Le vocabulaire visuel des documents imprimés.
 *
 * One place for the geometry and the palette, because the four documents this
 * module produces are one family: a bon de pharmacie, une lettre de garantie,
 * une facture and un bon de décaissement have to look like they came out of
 * the same institution on the same afternoon. The reference documents did not
 * — each was drawn in a different tool, with a different rule weight and a
 * different idea of where the margin was.
 *
 * ## The measurements are in points, and they are chosen
 *
 * A PDF point is 1/72 inch, so A4 is 595.28 × 841.89. Every number below was
 * picked against what a printed form actually has to do:
 *
 *   - **0.7pt rules.** A hairline (0.25pt) disappears on a photocopy, and
 *     these documents are photocopied constantly — the copy for the provider
 *     and the copy for the participant are the whole point. 1pt is heavy
 *     enough to make a page of boxes look like a form from 1994.
 *   - **6.5pt labels, 9pt values.** A label on a form is furniture: it should
 *     be legible when looked for and invisible when not. The 2.5pt gap plus
 *     the weight change is what keeps a value readable at arm's length.
 *   - **13pt rows.** Tall enough to write in with a pen, which several of
 *     these tables exist for — the acts on a lettre de garantie are filled in
 *     by the provider, not by us.
 *
 * ## The accent
 *
 * `Firm.themeColor`, when it is a hex colour, otherwise the Senexus green. It
 * tints the band and the section bars and nothing else: a document that is
 * mostly one saturated colour is a document that costs a fortune to print and
 * is unreadable in the black-and-white copy everyone actually files.
 */

export const PAGE = {
  width: 595.28,
  height: 841.89,
  paddingX: 30,
  paddingTop: 26,
  /** Leaves room for the fixed footer without any block colliding with it. */
  paddingBottom: 46,
} as const

export const CONTENT_WIDTH = PAGE.width - PAGE.paddingX * 2

const DEFAULT_ACCENT = "#0b5d53"
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/** A hex colour mixed towards white. `amount` is how much white. */
function wash(hex: string, amount: number): string {
  const full =
    hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex
  const channel = (at: number) => {
    const value = Number.parseInt(full.slice(at, at + 2), 16)
    return Math.round(value + (255 - value) * amount)
  }
  return `rgb(${channel(1)}, ${channel(3)}, ${channel(5)})`
}

export type Palette = ReturnType<typeof palette>

export function palette(themeColor?: string | null) {
  const accent = themeColor && HEX.test(themeColor) ? themeColor : DEFAULT_ACCENT

  return {
    accent,
    /** The band behind a title or a section bar. */
    accentWash: wash(accent, 0.9),
    accentRule: wash(accent, 0.55),

    ink: "#0f172a",
    /** Labels, and anything that is furniture rather than content. */
    ink2: "#3f4a5a",
    /** Meta lines: who edited this, when, page numbers. */
    ink3: "#6b7280",

    /** Box borders. Dark, because a form is read by its boxes. */
    rule: "#1f2937",
    /** Rules inside a table, where a full-strength border would be noise. */
    hair: "#c9d0d9",

    paper: "#ffffff",
    zebra: "#f6f8fa",

    alert: "#b42318",
    alertWash: "#fef3f2",
    ok: "#0b6b4f",
  } as const
}

export const TYPE = {
  title: 13,
  number: 12.5,
  section: 8,
  label: 6.5,
  value: 9,
  valueLarge: 11,
  body: 8,
  meta: 6.8,
  cell: 8,
  legal: 7.6,
} as const

export const ROW = {
  /** Field rows inside the identity block. */
  field: 15,
  /** Table body rows. Tall enough to be written in by hand. */
  table: 13.5,
  tableHead: 15,
} as const

export const RULE = {
  box: 0.7,
  hair: 0.5,
  heavy: 1.1,
} as const

/**
 * The base styles every template starts from.
 *
 * Built per palette rather than exported as a constant because the accent
 * comes from the firm. Memoised on the accent so a run of fifty bons for one
 * firm builds this once.
 */
const cache = new Map<string, ReturnType<typeof build>>()

export function baseStyles(themeColor?: string | null) {
  const colors = palette(themeColor)
  const existing = cache.get(colors.accent)
  if (existing) return existing
  const built = build(colors)
  cache.set(colors.accent, built)
  return built
}

function build(c: Palette) {
  return {
    colors: c,
    styles: {
      page: {
        paddingTop: PAGE.paddingTop,
        paddingBottom: PAGE.paddingBottom,
        paddingHorizontal: PAGE.paddingX,
        fontFamily: DOC_SANS,
        fontSize: TYPE.body,
        color: c.ink,
        backgroundColor: c.paper,
      },

      /* Text roles ------------------------------------------------------- */

      label: {
        fontFamily: DOC_SANS,
        fontSize: TYPE.label,
        fontWeight: 600,
        letterSpacing: 0.4,
        color: c.ink2,
        textTransform: "uppercase" as const,
      },
      value: { fontSize: TYPE.value, fontWeight: 500 },
      valueStrong: { fontSize: TYPE.value, fontWeight: 700 },
      meta: { fontSize: TYPE.meta, color: c.ink3 },
      legal: { fontSize: TYPE.legal, lineHeight: 1.45 },
      display: {
        fontFamily: DOC_DISPLAY,
        fontWeight: 700,
        letterSpacing: 0.3,
      },

      /* Structure -------------------------------------------------------- */

      box: {
        borderWidth: RULE.box,
        borderColor: c.rule,
        borderStyle: "solid" as const,
      },
      row: { flexDirection: "row" as const, alignItems: "center" as const },

      /* The tinted band under the title, and the section bars ------------- */

      band: {
        backgroundColor: c.accentWash,
        borderWidth: RULE.box,
        borderColor: c.accentRule,
        borderStyle: "solid" as const,
        paddingVertical: 4,
        paddingHorizontal: 8,
      },
      sectionBar: {
        alignSelf: "center" as const,
        backgroundColor: c.accentWash,
        borderWidth: RULE.hair,
        borderColor: c.accentRule,
        borderStyle: "solid" as const,
        paddingVertical: 2.5,
        paddingHorizontal: 14,
      },
      sectionLabel: {
        fontSize: TYPE.section,
        fontWeight: 700,
        letterSpacing: 1.1,
        color: c.accent,
        textTransform: "uppercase" as const,
      },

      /* Tables ------------------------------------------------------------ */

      tableHead: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        height: ROW.tableHead,
        backgroundColor: c.zebra,
        borderBottomWidth: RULE.box,
        borderBottomColor: c.rule,
        borderBottomStyle: "solid" as const,
      },
      tableHeadCell: {
        fontSize: TYPE.label,
        fontWeight: 700,
        letterSpacing: 0.4,
        color: c.ink2,
        textTransform: "uppercase" as const,
        paddingHorizontal: 5,
      },
      tableRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        minHeight: ROW.table,
        borderBottomWidth: RULE.hair,
        borderBottomColor: c.hair,
        borderBottomStyle: "solid" as const,
      },
      cell: { fontSize: TYPE.cell, paddingHorizontal: 5, paddingVertical: 2.5 },
      num: {
        fontSize: TYPE.cell,
        paddingHorizontal: 5,
        paddingVertical: 2.5,
        textAlign: "right" as const,
      },
    },
  }
}

/* ==========================================================================
 * Formatting
 * ========================================================================== */

/**
 * `1 234 567`, grouped with a **no-break space**.
 *
 * Not a plain space: a viewer is free to break `1 234` across a column edge,
 * and an amount split over two lines on a payment instrument is a figure
 * somebody will misread.
 *
 * And **not** U+202F, the narrow no-break space, which is what
 * `Intl.NumberFormat("fr-FR")` returns and what this used to use. It is the
 * typographically correct character for French and it is **not in the latin
 * subset** these fonts are built from — so fontkit drew `.notdef` for it,
 * which in IBM Plex Sans is a vertical bar. Every amount on every document
 * printed as `27|500 FCFA`.
 *
 * That is the failure mode worth remembering: a missing glyph does not throw,
 * it prints. `font-coverage.test.ts` now asserts that everything these
 * formatters emit actually exists in every face, so the next such choice fails
 * in CI instead of on paper.
 */
const GROUP_SPACE = " "

export function money(value: number): string {
  const rounded = Math.round(value)
  const sign = rounded < 0 ? "-" : ""
  return (
    sign +
    Math.abs(rounded)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SPACE)
  )
}

/** The same, with the currency the documents are denominated in. */
export function fcfa(value: number): string {
  return `${money(value)} FCFA`
}

/** `17/07/2026` — the form every one of these documents uses. */
export function shortDate(value: Date | null | undefined): string {
  if (!value) return "—"
  const day = String(value.getDate()).padStart(2, "0")
  const month = String(value.getMonth() + 1).padStart(2, "0")
  return `${day}/${month}/${value.getFullYear()}`
}

/** `09/09/2026 à 12:02` — for the "édité le" line. */
export function stamp(value: Date): string {
  const hours = String(value.getHours()).padStart(2, "0")
  const minutes = String(value.getMinutes()).padStart(2, "0")
  return `${shortDate(value)} à ${hours}:${minutes}`
}

/** A percentage from the stored fraction: `0.8` → `80 %`. */
export function percent(fraction: number): string {
  const value = fraction * 100
  const shown = Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2)
  // French puts a space before the sign, and it must not break away from the
  // number — same character, same reason, as the grouping above.
  return `${shown}${GROUP_SPACE}%`
}
