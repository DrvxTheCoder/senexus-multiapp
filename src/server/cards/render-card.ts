import "server-only"

import { readFile } from "node:fs/promises"
import { join } from "node:path"

import QRCode from "qrcode"
import satori from "satori"
import sharp from "sharp"
import { Resvg } from "@resvg/resvg-js"

import {
  geometry,
  layoutVerso,
  PRINT_PPI,
  type CardInputs,
} from "@/server/domain/ipm/card"
import { formatRate } from "@/server/domain/ipm/rates"
import { RELATION_LABELS } from "@/server/domain/ipm/coverage"

/**
 * Rendu des cartes — plan §6.
 *
 * Satori (JSX-shaped objects → SVG), then resvg-js (SVG → PNG). No Chromium:
 * the VPS does not have one and adding a headless browser to render a
 * business card is a disproportionate dependency.
 *
 * Fonts are embedded explicitly, because Satori has no system fonts and
 * renders blank boxes rather than failing if you forget. The face is the
 * application's own IBM Plex Sans, so a printed card and the screen it was
 * generated from look like one product.
 *
 * ## Colour, and the answer to §11 Q8
 *
 * resvg writes **RGB**. PNG has no CMYK at all — it is not a resvg limitation
 * but the file format — so "CMYK at 300 ppi as a PNG" cannot exist. What this
 * module does instead:
 *
 *   - `png()` returns sRGB at the requested ppi, with the density actually
 *     written into the file. resvg emits no pHYs chunk, so without that step
 *     a printer reads 72 dpi and places a 54 mm card at 225 mm;
 *   - `printTiff()` returns a real CMYK TIFF at 300 ppi for the printer.
 *
 * `sharp.withMetadata()` must not be used on the CMYK path: it re-tags the
 * image as sRGB and converts it back, silently undoing the conversion. The
 * density goes through `tiff({ xres, yres })` instead, which keeps both.
 */

/**
 * The two faces live under `public/`, read at runtime rather than imported.
 *
 * Importing them from `node_modules/@fontsource` is the obvious move and it
 * breaks the build: the bundler tries to make a module out of every `.woff` in
 * that package — nine weights it has no loader for — and a `require.resolve`
 * is enough to trigger it. Reading a path keeps the font out of the module
 * graph entirely, and `public/` is the one directory guaranteed to be present
 * at runtime.
 */
function fontPath(weight: 400 | 600): string {
  return join(
    process.cwd(),
    "public",
    "fonts",
    `ibm-plex-sans-latin-${weight}-normal.woff`
  )
}

let fontsPromise: Promise<
  { name: string; data: Buffer; weight: 400 | 600; style: "normal" }[]
> | null = null

function fonts() {
  fontsPromise ??= Promise.all([
    readFile(fontPath(400)),
    readFile(fontPath(600)),
  ]).then(([regular, semibold]) => [
    { name: "Plex", data: regular, weight: 400 as const, style: "normal" as const },
    { name: "Plex", data: semibold, weight: 600 as const, style: "normal" as const },
  ])
  return fontsPromise
}

/* -------------------------------------------------------------------------- */
/* Layout primitives                                                          */

type Node = {
  type: string
  props: Record<string, unknown> & { children?: unknown }
}

const el = (
  type: string,
  style: Record<string, unknown>,
  children?: unknown,
  extra: Record<string, unknown> = {}
): Node => ({ type, props: { style, children, ...extra } })

const INK = "#0f1b19"
const PAPER = "#ffffff"
const BRAND = "#0b5d53"
const MUTED = "#5d6b68"

/* -------------------------------------------------------------------------- */

export type CardFace = "recto" | "verso"

export type RenderOptions = {
  ppi?: number
  bleed?: boolean
  /** Absolute URL the QR resolves to. Recto only. */
  verificationUrl?: string
}

/**
 * One face, as SVG.
 *
 * Scaling is done by deriving every size from the geometry rather than by
 * rendering at 300 ppi and downsampling — text stays crisp at 150 ppi for the
 * on-screen preview instead of going soft.
 */
async function faceSvg(
  face: CardFace,
  inputs: CardInputs,
  options: RenderOptions
): Promise<string> {
  const ppi = options.ppi ?? PRINT_PPI
  const box = geometry(ppi, options.bleed)
  const scale = ppi / PRINT_PPI
  const px = (atPrint: number) => Math.round(atPrint * scale)

  const children =
    face === "recto"
      ? await rectoChildren(inputs, px, options)
      : versoChildren(inputs, px)

  return satori(
    el(
      "div",
      {
        width: box.width,
        height: box.height,
        display: "flex",
        flexDirection: "column",
        backgroundColor: PAPER,
        color: INK,
        fontFamily: "Plex",
        // The bleed is drawn in the brand colour so the trim cuts through
        // artwork rather than through white.
        padding: box.bleed,
        // Only when there is bleed to fill. Satori parses every key it is
        // given, and a key present with `undefined` throws rather than being
        // treated as absent.
        ...(box.bleed
          ? { backgroundImage: `linear-gradient(${BRAND}, ${BRAND})` }
          : {}),
      },
      el(
        "div",
        {
          display: "flex",
          flexDirection: "column",
          width: box.width - box.bleed * 2,
          height: box.height - box.bleed * 2,
          backgroundColor: PAPER,
        },
        children
      )
    ) as unknown as React.ReactNode,
    { width: box.width, height: box.height, fonts: await fonts() }
  )
}

/** `1990-04-02` → `02/04/1990`. A card is read by people, not by a parser. */
function frenchDate(iso: string | null): string | null {
  if (!iso) return null
  const [year, month, day] = iso.split("-")
  return year && month && day ? `${day}/${month}/${year}` : iso
}

/**
 * The holder's photo, as a data URI.
 *
 * Fetched here rather than handed to Satori as a URL, for two reasons: the
 * renderer must not hang on a slow file host while somebody waits for a card,
 * and a failed fetch has to degrade to the placeholder instead of throwing.
 * A card with an empty photo frame is still a usable card; an exception is not.
 */
async function photoDataUri(url: string | null): Promise<string | null> {
  if (!url) return null
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(3_000),
      headers: process.env.ZIPLINE_TOKEN
        ? { Authorization: process.env.ZIPLINE_TOKEN }
        : {},
    })
    if (!response.ok) return null
    const type = response.headers.get("content-type") ?? "image/jpeg"
    if (!type.startsWith("image/")) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    return `data:${type};base64,${bytes.toString("base64")}`
  } catch {
    return null
  }
}

async function rectoChildren(
  inputs: CardInputs,
  px: (n: number) => number,
  options: RenderOptions
): Promise<unknown[]> {
  const qr = options.verificationUrl
    ? await QRCode.toDataURL(options.verificationUrl, {
        margin: 0,
        width: px(150),
        errorCorrectionLevel: "M",
        color: { dark: INK, light: "#ffffff" },
      })
    : null

  const printedRates = inputs.rates.filter((rate) => rate.rate !== null)
  const photo = await photoDataUri(inputs.photoUrl)

  // The photo sits between the identity block and the QR, which is the band
  // that would otherwise be empty. When there is none, the frame is drawn and
  // labelled rather than collapsed: a card with a visibly missing photo tells
  // the counter to ask for one, where a tidy layout hides the gap.
  const photoBlock = el(
    "div",
    {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: px(180),
      height: px(220),
      marginTop: px(22),
      borderRadius: px(6),
      border: `${Math.max(1, px(2))}px solid #e4e8e7`,
      backgroundColor: "#f7f9f8",
      overflow: "hidden",
    },
    photo
      ? [el("img", {}, undefined, { src: photo, width: px(180), height: px(220) })]
      : [el("div", { fontSize: px(15), color: MUTED }, "Photo à fournir")]
  )

  return [
    // Bandeau
    el(
      "div",
      {
        display: "flex",
        flexDirection: "column",
        backgroundColor: BRAND,
        color: PAPER,
        padding: `${px(26)}px ${px(28)}px`,
      },
      [
        el("div", { fontSize: px(30), fontWeight: 600, letterSpacing: px(1) }, "IPM TAWFEIKH"),
        el(
          "div",
          { fontSize: px(17), marginTop: px(4), opacity: 0.85 },
          "CARTE TIERS PAYANT"
        ),
      ]
    ),

    // Identité
    el(
      "div",
      {
        display: "flex",
        flexDirection: "column",
        padding: `${px(24)}px ${px(28)}px`,
        flexGrow: 1,
      },
      [
        el(
          "div",
          { fontSize: px(30), fontWeight: 600, lineHeight: 1.1 },
          `${inputs.lastName.toUpperCase()} ${inputs.firstName}`
        ),
        el(
          "div",
          { fontSize: px(20), marginTop: px(10), color: MUTED },
          inputs.birthDate
            ? `Né(e) le ${frenchDate(inputs.birthDate)}${inputs.birthPlace ? ` à ${inputs.birthPlace}` : ""}`
            : "Date de naissance non renseignée",
        ),
        el(
          "div",
          {
            fontSize: px(38),
            fontWeight: 600,
            marginTop: px(18),
            letterSpacing: px(2),
          },
          `N° ${inputs.matricule}`
        ),
        el(
          "div",
          { fontSize: px(19), marginTop: px(6), color: MUTED },
          inputs.employerName
        ),

        // Taux. A category with no barème is simply absent rather than
        // printed as 0 % — a card must not assert a rate nobody chose.
        el(
          "div",
          {
            display: "flex",
            flexDirection: "column",
            marginTop: px(20),
            gap: px(4),
          },
          printedRates.length
            ? printedRates.map((rate) =>
                el(
                  "div",
                  {
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: px(18),
                  },
                  [
                    el("span", { color: MUTED }, rate.category),
                    el("span", { fontWeight: 600 }, formatRate(rate.rate!)),
                  ]
                )
              )
            : [el("div", { fontSize: px(18), color: MUTED }, inputs.planLabel)]
        ),

        photoBlock,
      ]
    ),

    // QR
    el(
      "div",
      {
        display: "flex",
        alignItems: "center",
        gap: px(18),
        padding: `${px(18)}px ${px(28)}px`,
        borderTop: `${Math.max(1, px(2))}px solid #e4e8e7`,
      },
      qr
        ? [
            el("img", {}, undefined, {
              src: qr,
              width: px(120),
              height: px(120),
            }),
            el(
              "div",
              {
                display: "flex",
                flexDirection: "column",
                fontSize: px(15),
                color: MUTED,
                flexGrow: 1,
              },
              [
                el("span", { fontWeight: 600, color: INK }, "Vérifier la validité"),
                el("span", { marginTop: px(3) }, "Scannez ce code au comptoir."),
              ]
            ),
          ]
        : [el("div", { fontSize: px(15), color: MUTED }, inputs.planLabel)]
    ),
  ]
}

function versoChildren(inputs: CardInputs, px: (n: number) => number): unknown[] {
  const { shown, notice } = layoutVerso(inputs.dependents)

  return [
    el(
      "div",
      {
        display: "flex",
        flexDirection: "column",
        padding: `${px(24)}px ${px(26)}px ${px(12)}px`,
      },
      [
        el("div", { fontSize: px(22), fontWeight: 600 }, "Ayants droit"),
        el(
          "div",
          { fontSize: px(15), color: MUTED, marginTop: px(3) },
          `${inputs.lastName.toUpperCase()} ${inputs.firstName} — ${inputs.matricule}`
        ),
      ]
    ),

    el(
      "div",
      {
        display: "flex",
        flexWrap: "wrap",
        padding: `0 ${px(26)}px`,
        flexGrow: 1,
        alignContent: "flex-start",
      },
      shown.length
        ? shown.map((dependent) =>
            el(
              "div",
              {
                display: "flex",
                flexDirection: "column",
                width: "33%",
                paddingRight: px(6),
                marginBottom: px(14),
              },
              [
                el(
                  "div",
                  { fontSize: px(15), fontWeight: 600, lineHeight: 1.15 },
                  dependent.firstName
                ),
                el(
                  "div",
                  { fontSize: px(13), color: MUTED, marginTop: px(2) },
                  RELATION_LABELS[
                    dependent.relation as keyof typeof RELATION_LABELS
                  ] ?? dependent.relation
                ),
                el(
                  "div",
                  { fontSize: px(12), color: MUTED, marginTop: px(1) },
                  dependent.matricule
                ),
              ]
            )
          )
        : [
            el(
              "div",
              { fontSize: px(16), color: MUTED },
              "Aucun ayant droit enregistré."
            ),
          ]
    ),

    // The overflow notice. Printed, never omitted — a card showing nine of
    // twelve without saying so is the failure the rule exists to prevent.
    notice
      ? el(
          "div",
          {
            fontSize: px(14),
            fontWeight: 600,
            color: BRAND,
            padding: `0 ${px(26)}px ${px(10)}px`,
          },
          notice
        )
      : el("div", { display: "flex" }, ""),

    el(
      "div",
      {
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#f3f6f5",
        padding: `${px(14)}px ${px(26)}px`,
        fontSize: px(13),
        color: MUTED,
        gap: px(2),
      },
      [
        el(
          "div",
          {},
          "Cette carte est la propriété de l'IPM Tawfeikh et doit être restituée."
        ),
        el("div", { fontWeight: 600, color: INK }, "IPM Tawfeikh — Dakar"),
      ]
    ),
  ]
}

/* -------------------------------------------------------------------------- */
/* Output                                                                     */

/** sRGB PNG with the density written in, so a printer places it at 54 mm. */
export async function renderCardPng(
  face: CardFace,
  inputs: CardInputs,
  options: RenderOptions = {}
): Promise<Buffer> {
  const ppi = options.ppi ?? PRINT_PPI
  const box = geometry(ppi, options.bleed)
  const svg = await faceSvg(face, inputs, options)

  const raw = new Resvg(svg, {
    fitTo: { mode: "width", value: box.width },
  })
    .render()
    .asPng()

  // resvg emits no pHYs chunk. Without this the file claims 72 dpi and a
  // 54 mm card is placed at 225 mm.
  return sharp(raw).withMetadata({ density: ppi }).png().toBuffer()
}

/**
 * A real CMYK TIFF at 300 ppi, for the printer (§11 Q8).
 *
 * TIFF rather than PNG because PNG has no CMYK, and rather than JPEG because
 * a card is flat colour and type, where JPEG artefacts show. The density goes
 * through `xres`/`yres`: `withMetadata()` would convert the image back to
 * sRGB and quietly undo the conversion.
 */
export async function renderCardPrintTiff(
  face: CardFace,
  inputs: CardInputs,
  options: RenderOptions = {}
): Promise<Buffer> {
  const ppi = options.ppi ?? PRINT_PPI
  const box = geometry(ppi, options.bleed ?? true)
  const svg = await faceSvg(face, inputs, { ...options, bleed: options.bleed ?? true })

  const raw = new Resvg(svg, {
    fitTo: { mode: "width", value: box.width },
  })
    .render()
    .asPng()

  const perInch = ppi / 25.4

  return sharp(raw)
    .flatten({ background: "#ffffff" })
    .toColourspace("cmyk")
    .tiff({ compression: "lzw", xres: perInch, yres: perInch })
    .toBuffer()
}
