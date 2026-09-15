import { describe, expect, it } from "vitest"
import sharp from "sharp"

import { ARTBOARD, QR, type CardData } from "@/server/cards/card-core"
import {
  faceSvg,
  PRINT_WIDTH,
  qrFits,
  qrMatrix,
  renderCardPng,
} from "@/server/cards/render-card"
import {
  firmCode,
  issueToken,
} from "@/server/domain/ipm/verification-token"

/**
 * The QR, end to end — token to printed pixels.
 *
 * This file exists because of a bug it would have caught on the first run.
 * The verification URL was 86 characters, which needs a 37-module symbol; the
 * box held 29; `qrFits` therefore returned false for every card ever
 * rendered, the route logged a warning nobody read, and `renderFront`
 * substituted an empty string into the `{{QR}}` slot. Every card printed with
 * a blank space where the code should be, and every test still passed —
 * because every test fed the renderer a synthetic matrix rather than a real
 * URL, and asserted about geometry rather than about output.
 *
 * So the assertions here are deliberately end-to-end: a real signed token, the
 * real origin, and the actual rasterised PNG read back pixel by pixel. A unit
 * test of `qrRects` cannot fail the way this shipped.
 */

const SECRET = "a-test-secret-that-is-not-the-real-one"

/** The longest realistic URL: production origin, an ayant droit's matricule. */
function verificationUrl(matricule = "01716-02"): string {
  const token = issueToken(
    { kind: "member", firmCode: firmCode("firm_1"), matricule },
    SECRET
  )
  return `https://vercel.senexus.app/v/${token}`
}

function card(url: string): CardData {
  return {
    matricule: "01716",
    firstName: "Awa",
    lastName: "Diop",
    birthDate: "1979-03-20",
    birthPlace: "TIVAOUNE",
    photo: null,
    coverage: [{ label: "Soins", rate: 0.8 }],
    dependents: [],
    verificationUrl: url,
  }
}

describe("the verification URL fits the card", () => {
  it("fits, for a participant and for an ayant droit", () => {
    // The regression. Both of these were false.
    expect(qrFits(verificationUrl("01716"))).toBe(true)
    expect(qrFits(verificationUrl("01716-02"))).toBe(true)
  })

  it("fits with an employer prefix on the matricule", () => {
    expect(qrFits(verificationUrl("CI01716-02"))).toBe(true)
  })

  it("leaves the symbol inside the box", () => {
    expect(qrMatrix(verificationUrl()).length).toBeLessThanOrEqual(QR.modules)
  })

  it("still refuses a URL that genuinely cannot fit", () => {
    // The guard must keep working — an unscannable QR on an identity document
    // is worse than none, because it looks like it works.
    expect(qrFits(`https://vercel.senexus.app/v/${"x".repeat(120)}`)).toBe(false)
  })
})

describe("the QR reaches the SVG", () => {
  it("is drawn, not silently omitted", () => {
    const svg = faceSvg("recto", card(verificationUrl()))
    expect(svg).toContain("shape-rendering")
    expect(svg).toContain(QR.colour)
    // The slot must be filled, not left literal.
    expect(svg).not.toContain("{{QR}}")
  })

  it("is absent when there is no URL, rather than half-drawn", () => {
    const svg = faceSvg("recto", { ...card(""), verificationUrl: null })
    expect(svg).not.toContain("shape-rendering")
  })
})

describe("the QR survives rasterisation", () => {
  it("reads back from the printed pixels as the symbol that went in", async () => {
    const url = verificationUrl()
    const expected = qrMatrix(url)

    const png = await renderCardPng("recto", card(url), { width: PRINT_WIDTH })
    const { data, info } = await sharp(png)
      .raw()
      .toBuffer({ resolveWithObject: true })

    const scale = info.width / ARTBOARD.width
    // Same centring `qrRects` applies, so the sample lands on the module.
    const offset = ((QR.modules - expected.length) / 2) * QR.module

    const sample = (row: number, column: number): boolean => {
      const x = Math.round(
        (QR.originX + offset + (column + 0.5) * QR.module) * scale
      )
      const y = Math.round(
        (QR.originY + offset + (row + 0.5) * QR.module) * scale
      )
      // Teal is #028f9d, the ground is white: the red channel separates them
      // without any tolerance games.
      return data[(y * info.width + x) * info.channels]! < 128
    }

    const read = expected.map((line, row) =>
      line.map((_, column) => sample(row, column))
    )

    expect(read).toEqual(expected)
  })

  it("prints modules large enough to scan", () => {
    // 0.46 mm at the assumed 54 mm trim. This is the number that decides
    // whether a card works at a pharmacy counter, and the temptation when a
    // payload grows is to shrink it rather than shorten the payload.
    const mmPerUnit = 54 / ARTBOARD.width
    expect(QR.module * mmPerUnit).toBeGreaterThan(0.4)
  })

  it("keeps the block clear of the lines above and below it", () => {
    // The box was grown into existing whitespace; these are the neighbours it
    // was grown against. Matricule baseline 170.53, coverage baseline 226.69.
    const top = QR.originY
    const bottom = QR.originY + QR.modules * QR.module
    expect(top).toBeGreaterThan(170.53 + 5 * 0.21) // descenders of the 5px line
    expect(bottom).toBeLessThan(226.69 - 4 * 0.75) // ascenders of the 4px line
  })
})
