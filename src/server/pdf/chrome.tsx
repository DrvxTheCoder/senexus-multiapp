import "server-only"

import * as React from "react"
import { Image, Text, View } from "@react-pdf/renderer"

import type { FittedImage } from "@/server/pdf/images"
import {
  CONTENT_WIDTH,
  ROW,
  RULE,
  TYPE,
  baseStyles,
  stamp as formatStamp,
  type Palette,
} from "@/server/pdf/theme"

/**
 * Le mobilier commun des documents.
 *
 * Every document this module prints is the same object: an en-tête, a titled
 * band, one or two blocks of labelled boxes, a table, a total, and a row of
 * signatures. Written once here, so that a bon de pharmacie and a bon de
 * décaissement cannot drift into being two different institutions' paper —
 * which is precisely what happened to the documents this replaces, where the
 * rule weights, the margins and even the date format differ page to page.
 *
 * ## What is deliberately different from the reference documents
 *
 * The originals were the brief, not the specification. Four things are changed
 * on purpose, and each is a defect in the original rather than a preference:
 *
 *   1. **The copy destination is stated once, in the footer**, instead of
 *      floating in a small box that lands somewhere different on each page —
 *      mid-form on one, over the signature line on another. It is a filing
 *      instruction; it belongs with the page furniture.
 *   2. **Empty is empty.** The originals print `0 Catégorie` and, on one page,
 *      a bare `26` where a template slot went unfilled. Nothing here prints a
 *      placeholder as if it were a value: a missing field shows an em dash,
 *      and a section with nothing in it is not drawn at all.
 *   3. **Dates are unambiguous and consistent.** The originals mix
 *      `21-Aug-2026` with `17/07/2026` on the same page, in a French document.
 *      One format throughout, and the expiry is printed as a date rather than
 *      left as "valable un mois" for the reader to compute.
 *   4. **Every page says which of how many it is**, and carries the document's
 *      number. A three-copy document that comes apart in a filing cabinet can
 *      be put back together.
 */

/* ==========================================================================
 * En-tête
 * ========================================================================== */

export type DocumentMeta = {
  /** `Créé le` — when the underlying record came into being. */
  createdAt: Date | null
  createdBy: string | null
  /** `Édité le` — when this particular sheet was generated. */
  printedAt: Date
  printedBy: string | null
}

/**
 * The letterhead, or the firm's name set in type when there is none.
 *
 * The fallback matters more than it looks: a firm that has not uploaded an
 * en-tête still needs a document that identifies who issued it, and an
 * unbranded sheet of paper with a signature on it is worse than a plain one
 * with a name at the top.
 */
export function Letterhead({
  letterhead,
  firmName,
  meta,
  palette,
}: {
  letterhead: FittedImage | null
  firmName: string
  meta: DocumentMeta
  palette: Palette
}) {
  // Bounded on both axes: an operator uploads whatever their designer sent,
  // and a 3000 px tall banner must not push the whole form off the page.
  const maxWidth = 250
  const maxHeight = 58
  const width = letterhead
    ? Math.min(maxWidth, maxHeight / letterhead.ratio)
    : 0

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        marginBottom: 10,
      }}
    >
      <View style={{ maxWidth }}>
        {letterhead ? (
          <Image src={letterhead.src} style={{ width, maxHeight }} />
        ) : (
          <View
            style={{
              borderWidth: RULE.box,
              borderColor: palette.rule,
              borderStyle: "solid",
              paddingVertical: 8,
              paddingHorizontal: 12,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.4 }}>
              {firmName.toUpperCase()}
            </Text>
          </View>
        )}
      </View>

      <View style={{ alignItems: "flex-end" }}>
        {meta.createdAt ? (
          <MetaLine
            palette={palette}
            label="Créé le"
            value={formatStamp(meta.createdAt)}
            by={meta.createdBy}
          />
        ) : null}
        <MetaLine
          palette={palette}
          label="Édité le"
          value={formatStamp(meta.printedAt)}
          by={meta.printedBy}
        />
      </View>
    </View>
  )
}

function MetaLine({
  label,
  value,
  by,
  palette,
}: {
  label: string
  value: string
  by: string | null
  palette: Palette
}) {
  return (
    <View style={{ alignItems: "flex-end", marginBottom: 2 }}>
      <Text style={{ fontSize: TYPE.meta, color: palette.ink3 }}>
        {label} : <Text style={{ fontWeight: 600 }}>{value}</Text>
      </Text>
      {by ? (
        <Text style={{ fontSize: TYPE.meta, color: palette.ink3 }}>
          par : {by}
        </Text>
      ) : null}
    </View>
  )
}

/* ==========================================================================
 * Titre
 * ========================================================================== */

export type CopyKind = "ORIGINAL" | "PROVIDER" | "MEMBER" | "ACCOUNTING"

export const COPY_BADGE: Record<CopyKind, string> = {
  ORIGINAL: "Original",
  PROVIDER: "Copie",
  MEMBER: "Copie",
  ACCOUNTING: "Copie",
}

export const COPY_DESTINATION: Record<CopyKind, string> = {
  ORIGINAL: "Original à joindre à la facture",
  PROVIDER: "Exemplaire destiné au fournisseur",
  MEMBER: "Exemplaire destiné au participant",
  ACCOUNTING: "Exemplaire destiné à la comptabilité",
}

export function TitleRow({
  copy,
  title,
  number,
  palette,
}: {
  copy: CopyKind | null
  title: string
  number: string
  palette: Palette
}) {
  const { styles } = baseStyles(palette.accent)

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 6,
      }}
    >
      {copy ? (
        <View
          style={{
            borderWidth: RULE.box,
            borderColor: palette.rule,
            borderStyle: "solid",
            paddingVertical: 3,
            paddingHorizontal: 12,
          }}
        >
          <Text
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              fontStyle: "italic",
              letterSpacing: 0.3,
            }}
          >
            {COPY_BADGE[copy]}
          </Text>
        </View>
      ) : (
        <View />
      )}

      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text
          style={{
            ...styles.display,
            fontSize: TYPE.title,
            marginRight: 8,
            textTransform: "uppercase",
          }}
        >
          {title} n°
        </Text>
        <View
          style={{
            backgroundColor: palette.accentWash,
            borderWidth: RULE.box,
            borderColor: palette.accentRule,
            borderStyle: "solid",
            paddingVertical: 3,
            paddingHorizontal: 10,
          }}
        >
          <Text
            style={{
              fontSize: TYPE.number,
              fontWeight: 700,
              letterSpacing: 0.6,
              color: palette.accent,
            }}
          >
            {number}
          </Text>
        </View>
      </View>
    </View>
  )
}

/** The "valable pour…" strip under the title. Several lines, centred. */
export function Band({
  lines,
  palette,
}: {
  lines: string[]
  palette: Palette
}) {
  const { styles } = baseStyles(palette.accent)
  return (
    <View style={{ ...styles.band, marginBottom: 9 }}>
      {lines.map((line, index) => (
        <Text
          key={index}
          style={{
            fontSize: TYPE.legal,
            fontWeight: index === 0 ? 700 : 500,
            textAlign: "center",
            letterSpacing: 0.2,
          }}
        >
          {line}
        </Text>
      ))}
    </View>
  )
}

export function SectionBar({
  children,
  palette,
  marginTop = 9,
}: {
  children: string
  palette: Palette
  marginTop?: number
}) {
  const { styles } = baseStyles(palette.accent)
  return (
    <View style={{ ...styles.sectionBar, marginTop, marginBottom: 5 }}>
      <Text style={styles.sectionLabel}>{children}</Text>
    </View>
  )
}

/* ==========================================================================
 * Champs
 * ========================================================================== */

/** The bordered block a group of labelled rows sits in. */
export function FieldGroup({
  children,
  palette,
  marginBottom = 8,
}: {
  children: React.ReactNode
  palette: Palette
  marginBottom?: number
}) {
  return (
    <View
      style={{
        borderWidth: RULE.box,
        borderColor: palette.rule,
        borderStyle: "solid",
        padding: 7,
        marginBottom,
      }}
    >
      {children}
    </View>
  )
}

const LABEL_WIDTH = 74

/**
 * One labelled row: the label right-aligned in its column, then boxes.
 *
 * The label column is a fixed width so that four rows of different labels line
 * their boxes up — the reference documents let each row find its own left
 * edge, which is why their forms look hand-assembled.
 */
export function FieldLine({
  label,
  children,
  palette,
  marginBottom = 4,
}: {
  label: string
  children: React.ReactNode
  palette: Palette
  marginBottom?: number
}) {
  const { styles } = baseStyles(palette.accent)
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginBottom }}>
      <Text
        style={{
          ...styles.label,
          width: LABEL_WIDTH,
          textAlign: "right",
          paddingRight: 6,
        }}
      >
        {label} :
      </Text>
      {children}
    </View>
  )
}

/**
 * A value in a box.
 *
 * `tone` is the difference between a fact about the document and a fact about
 * the person: the employer and the provider are set in the accent wash on the
 * originals too, and it is the one piece of their styling worth keeping —
 * it makes the counterparty findable at a glance on a page of black boxes.
 */
export function Boxed({
  children,
  palette,
  flex,
  width,
  tone = "plain",
  align = "left",
  strong,
  size,
}: {
  children: React.ReactNode
  palette: Palette
  flex?: number
  width?: number
  tone?: "plain" | "accent" | "muted"
  align?: "left" | "center" | "right"
  strong?: boolean
  size?: number
}) {
  const empty = children === null || children === undefined || children === ""

  return (
    <View
      style={{
        ...(flex !== undefined ? { flex } : {}),
        ...(width !== undefined ? { width } : {}),
        height: ROW.field,
        justifyContent: "center",
        paddingHorizontal: 5,
        marginRight: 4,
        borderWidth: RULE.box,
        borderColor: palette.rule,
        borderStyle: "solid",
        backgroundColor:
          tone === "accent" ? palette.accentWash : palette.paper,
      }}
    >
      <Text
        style={{
          fontSize: size ?? (tone === "accent" ? 10 : TYPE.value),
          fontWeight: strong || tone === "accent" ? 700 : 500,
          textAlign: align,
          color: tone === "muted" ? palette.ink3 : palette.ink,
        }}
      >
        {empty ? "—" : children}
      </Text>
    </View>
  )
}

/** A bare label sitting between two boxes, e.g. `Âge :`. */
export function InlineLabel({
  children,
  palette,
}: {
  children: string
  palette: Palette
}) {
  const { styles } = baseStyles(palette.accent)
  return (
    <Text style={{ ...styles.label, marginRight: 4 }}>{children}</Text>
  )
}

/* ==========================================================================
 * Tableaux
 * ========================================================================== */

export type Column = {
  key: string
  header: string
  /** Share of the table width. Columns are laid out by flex, not by points. */
  flex: number
  align?: "left" | "center" | "right"
}

export function TableHeader({
  columns,
  palette,
}: {
  columns: Column[]
  palette: Palette
}) {
  const { styles } = baseStyles(palette.accent)
  return (
    <View style={styles.tableHead}>
      {columns.map((column) => (
        <Text
          key={column.key}
          style={{
            ...styles.tableHeadCell,
            flex: column.flex,
            textAlign: column.align ?? "left",
          }}
        >
          {column.header}
        </Text>
      ))}
    </View>
  )
}

export function TableRow({
  columns,
  cells,
  palette,
  zebra,
  strong,
}: {
  columns: Column[]
  cells: (string | number | null)[]
  palette: Palette
  zebra?: boolean
  strong?: boolean
}) {
  const { styles } = baseStyles(palette.accent)
  return (
    <View
      style={{
        ...styles.tableRow,
        ...(zebra ? { backgroundColor: palette.zebra } : {}),
      }}
      wrap={false}
    >
      {columns.map((column, index) => (
        <Text
          key={column.key}
          style={{
            ...(column.align === "right" ? styles.num : styles.cell),
            flex: column.flex,
            ...(column.align === "center" ? { textAlign: "center" } : {}),
            ...(strong ? { fontWeight: 700 } : {}),
          }}
        >
          {cells[index] ?? ""}
        </Text>
      ))}
    </View>
  )
}

/**
 * Ruled rows with nothing in them.
 *
 * Not padding. A lettre de garantie is handed to a clinic that writes the acts
 * onto it in ink, so the blank rows *are* the document — printing four of them
 * and stopping would mean the clinic writes off the bottom of the form.
 */
export function BlankRows({
  columns,
  count,
  palette,
}: {
  columns: Column[]
  count: number
  palette: Palette
}) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <TableRow
          key={`blank-${index}`}
          columns={columns}
          cells={columns.map(() => "")}
          palette={palette}
        />
      ))}
    </>
  )
}

/** The bordered frame a table sits in. */
export function TableFrame({
  children,
  palette,
  marginBottom = 8,
}: {
  children: React.ReactNode
  palette: Palette
  marginBottom?: number
}) {
  return (
    <View
      style={{
        borderWidth: RULE.box,
        borderColor: palette.rule,
        borderStyle: "solid",
        marginBottom,
      }}
    >
      {children}
    </View>
  )
}

/** A right-aligned stack of `LABEL : [ value ]` rows under a table. */
export function TotalsBlock({
  rows,
  palette,
  width = 230,
}: {
  rows: { label: string; value: string; strong?: boolean }[]
  palette: Palette
  width?: number
}) {
  const { styles } = baseStyles(palette.accent)
  return (
    <View style={{ alignSelf: "flex-end", width }}>
      {rows.map((row) => (
        <View
          key={row.label}
          style={{ flexDirection: "row", alignItems: "center", marginBottom: 3 }}
        >
          <Text
            style={{
              ...styles.label,
              flex: 1,
              textAlign: "right",
              paddingRight: 6,
              ...(row.strong ? { fontSize: 7.4, color: palette.ink } : {}),
            }}
          >
            {row.label} :
          </Text>
          <View
            style={{
              width: 96,
              height: ROW.field,
              justifyContent: "center",
              paddingHorizontal: 5,
              borderWidth: row.strong ? RULE.heavy : RULE.box,
              borderColor: palette.rule,
              borderStyle: "solid",
              backgroundColor: row.strong ? palette.accentWash : palette.paper,
            }}
          >
            <Text
              style={{
                fontSize: row.strong ? 9.5 : TYPE.value,
                fontWeight: row.strong ? 700 : 500,
                textAlign: "right",
              }}
            >
              {row.value}
            </Text>
          </View>
        </View>
      ))}
    </View>
  )
}

/* ==========================================================================
 * Signatures
 * ========================================================================== */

export type Visa = {
  /** `VISA DIRECTION`, `Le PARTICIPANT`, `L'IPM`… */
  title: string
  /** Who signed. Absent while the visa is still outstanding. */
  name?: string | null
  /** When. Printed under the name, because a visa is an act with a date. */
  at?: Date | null
  /** The scanned signature, when the signatory has uploaded one. */
  signature?: FittedImage | null
  /** The firm's cachet, on the institution's own visa only. */
  stamp?: FittedImage | null
  /** Shown in place of a name while the box is waiting to be signed by hand. */
  hint?: string
}

/**
 * Une rangée de visas.
 *
 * The box is always drawn, signed or not. That is the point of a visa row: an
 * unsigned box is a statement that this document is not yet approved, and it
 * is what somebody at a desk is looking for. Printing only the visas that
 * exist would make an unapproved bon look finished.
 *
 * A signature image is printed **at its natural aspect ratio inside a fixed
 * height**, never stretched: a signature squeezed to fit a box is not that
 * person's signature any more.
 */
export function VisaRow({
  visas,
  palette,
  height = 62,
}: {
  visas: Visa[]
  palette: Palette
  height?: number
}) {
  const { styles } = baseStyles(palette.accent)
  const inkHeight = height - 26

  return (
    <View style={{ flexDirection: "row", marginTop: 10 }} wrap={false}>
      {visas.map((visa, index) => (
        <View
          key={visa.title}
          style={{
            flex: 1,
            marginRight: index === visas.length - 1 ? 0 : 7,
            borderWidth: RULE.box,
            borderColor: palette.rule,
            borderStyle: "solid",
          }}
        >
          <View
            style={{
              backgroundColor: palette.zebra,
              borderBottomWidth: RULE.hair,
              borderBottomColor: palette.hair,
              borderBottomStyle: "solid",
              paddingVertical: 2.5,
              paddingHorizontal: 5,
            }}
          >
            <Text style={{ ...styles.label, textAlign: "center" }}>
              {visa.title}
            </Text>
          </View>

          <View
            style={{
              height,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 4,
            }}
          >
            {/* The ink: signature and cachet share the line, because that is
                how they land on paper — the cachet overlapping the name, the
                signature beside it. */}
            <View
              style={{
                height: inkHeight,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {visa.stamp ? (
                <Image
                  src={visa.stamp.src}
                  style={{
                    height: inkHeight,
                    width: inkHeight / visa.stamp.ratio,
                    marginRight: visa.signature ? 4 : 0,
                  }}
                />
              ) : null}
              {visa.signature ? (
                <Image
                  src={visa.signature.src}
                  style={{
                    height: inkHeight,
                    width: inkHeight / visa.signature.ratio,
                  }}
                />
              ) : null}
            </View>

            {visa.name ? (
              <Text
                style={{
                  fontSize: 7.4,
                  fontWeight: 600,
                  textAlign: "center",
                  marginTop: 2,
                }}
              >
                {visa.name}
              </Text>
            ) : visa.hint ? (
              <Text
                style={{
                  fontSize: TYPE.meta,
                  color: palette.ink3,
                  textAlign: "center",
                  marginTop: 2,
                }}
              >
                {visa.hint}
              </Text>
            ) : null}

            {visa.at ? (
              <Text
                style={{
                  fontSize: TYPE.meta,
                  color: palette.ink3,
                  textAlign: "center",
                }}
              >
                {formatStamp(visa.at)}
              </Text>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  )
}

/* ==========================================================================
 * Pied de page
 * ========================================================================== */

/**
 * Le pied de page, fixe.
 *
 * `fixed` puts it on every page of the section, which is what makes a
 * multi-page facture legible once it is unstapled: the number and the copy's
 * destination are on every sheet, not only the first.
 */
export function Footer({
  destination,
  reference,
  palette,
}: {
  destination: string | null
  reference: string
  palette: Palette
}) {
  return (
    <View
      fixed
      style={{
        position: "absolute",
        bottom: 18,
        left: 30,
        right: 30,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        borderTopWidth: RULE.hair,
        borderTopColor: palette.hair,
        borderTopStyle: "solid",
        paddingTop: 4,
      }}
    >
      <Text style={{ fontSize: TYPE.meta, color: palette.ink3 }}>
        {destination ?? ""}
      </Text>
      <Text style={{ fontSize: TYPE.meta, color: palette.ink3 }}>
        {reference}
      </Text>
      <Text
        style={{ fontSize: TYPE.meta, color: palette.ink3 }}
        render={({ pageNumber, totalPages }) =>
          `Page ${pageNumber} / ${totalPages}`
        }
      />
    </View>
  )
}

/** The QR and its one line of explanation, bottom-right of a bon. */
export function VerificationMark({
  src,
  palette,
  size = 56,
}: {
  src: string
  palette: Palette
  size?: number
}) {
  return (
    <View style={{ alignItems: "center", width: size + 24 }}>
      <Image src={src} style={{ width: size, height: size }} />
      <Text
        style={{
          fontSize: 5.8,
          color: palette.ink3,
          textAlign: "center",
          marginTop: 2,
        }}
      >
        Scannez pour vérifier la couverture
      </Text>
    </View>
  )
}

/** A short notice in the alert tint — a cancelled bon, an unapproved invoice. */
export function Notice({
  children,
  palette,
  tone = "alert",
}: {
  children: string
  palette: Palette
  tone?: "alert" | "muted"
}) {
  return (
    <View
      style={{
        backgroundColor: tone === "alert" ? palette.alertWash : palette.zebra,
        borderWidth: RULE.hair,
        borderColor: tone === "alert" ? palette.alert : palette.hair,
        borderStyle: "solid",
        paddingVertical: 4,
        paddingHorizontal: 8,
        marginBottom: 8,
      }}
    >
      <Text
        style={{
          fontSize: TYPE.legal,
          fontWeight: 600,
          color: tone === "alert" ? palette.alert : palette.ink2,
        }}
      >
        {children}
      </Text>
    </View>
  )
}

/** Width available inside the page margins — templates size columns off it. */
export const INNER_WIDTH = CONTENT_WIDTH
