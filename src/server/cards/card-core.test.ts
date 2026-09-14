import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  ARTBOARD,
  birthLine,
  clamp,
  coverageLine,
  DEPENDENT_BOXES,
  DEPENDENT_CAPACITY,
  emWidth,
  fitFontSize,
  holderName,
  QR,
  qrRects,
  renderBack,
  renderFront,
  xml,
  type CardData,
} from "@/server/cards/card-core"

const templates = {
  front: readFileSync(join(process.cwd(), "src/server/cards/templates/card-front.svg"), "utf8"),
  back: readFileSync(join(process.cwd(), "src/server/cards/templates/card-back.svg"), "utf8"),
}

function dependent(firstName: string, lastName = "DIOP") {
  return { firstName, lastName, relationLabel: "Enfant", photo: null }
}

const FULL: CardData = {
  matricule: "2960",
  firstName: "Awa",
  lastName: "Diop",
  birthDate: "1979-03-20",
  birthPlace: "TIVAOUNE",
  photo: "data:image/jpeg;base64,AAAA",
  coverage: [
    { label: "Soins", rate: 0.5 },
    { label: "Pharmacie", rate: 0.8 },
  ],
  dependents: [dependent("Fatou"), dependent("Moussa"), dependent("Aïda")],
  verificationUrl: null,
}

const EMPTY: CardData = {
  matricule: "1",
  firstName: "Ousmane",
  lastName: "Ba",
  birthDate: null,
  birthPlace: null,
  photo: null,
  coverage: [],
  dependents: [],
  verificationUrl: null,
}

/** A square matrix of the given size, alternating, for geometry assertions. */
function matrix(size: number): boolean[][] {
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) => (row + column) % 2 === 0)
  )
}

describe("the templates", () => {
  it("keep the artwork's artboard on both faces", () => {
    for (const svg of Object.values(templates)) {
      expect(svg).toContain(`viewBox="0 0 ${ARTBOARD.width} ${ARTBOARD.height}"`)
    }
  })

  it("carry no Tahoma or Arial, which are not on the container", () => {
    for (const svg of Object.values(templates)) {
      expect(svg).not.toMatch(/Tahoma|Arial/)
    }
  })
})

describe("renderFront / renderBack — no slot survives", () => {
  it("fills every slot for a fully populated card", () => {
    expect(renderFront(templates.front, FULL, matrix(29))).not.toContain("{{")
    expect(renderBack(templates.back, FULL)).not.toContain("{{")
  })

  it("fills every slot with no dependants, no photo and no dates", () => {
    expect(renderFront(templates.front, EMPTY, null)).not.toContain("{{")
    expect(renderBack(templates.back, EMPTY)).not.toContain("{{")
  })

  it("escapes a name that would otherwise break the XML", () => {
    const svg = renderFront(
      templates.front,
      { ...FULL, lastName: "Diop & <Fils>" },
      null
    )
    expect(svg).toContain("DIOP &amp; &lt;FILS&gt;")
    expect(svg).not.toContain("<Fils>")
  })
})

describe("text fitting", () => {
  it("leaves a name that already fits at the artwork's own size", () => {
    expect(fitFontSize("DIOP Awa", 115, 11)).toBe(11)
  })

  it("shrinks a 32-character name to fit its box", () => {
    const name = "A".repeat(32)
    const size = fitFontSize(name, 115, 11)
    expect(size).toBeLessThan(11)
    expect(emWidth(name) * size).toBeLessThanOrEqual(115)
  })

  it("never grows a short name beyond the artwork's size", () => {
    expect(fitFontSize("Ba", 115, 11)).toBe(11)
  })

  it("emits the fitted size as an inline style, which beats the class rule", () => {
    // The template carries `.cls-5 { font-size: 11px }`, and in SVG a class
    // rule overrides a presentation attribute — so a `font-size="..."`
    // attribute here is silently ignored and every name prints at 11px.
    const svg = renderFront(
      templates.front,
      { ...FULL, firstName: "Mouhamadou Moustapha", lastName: "Cissé Ndiaye" },
      null
    )
    expect(svg).toMatch(/style="font-size:[\d.]+px"/)
    expect(svg).not.toMatch(/font-size="\{\{/)
  })

  it("keeps a long name inside the artboard", () => {
    const name = holderName("Mouhamadou Moustapha", "Cissé Ndiaye")
    const size = fitFontSize(name, 114, 11)
    // 41.91 is where the name starts; the artboard is 161.57 wide.
    expect(41.91 + emWidth(name) * size).toBeLessThanOrEqual(ARTBOARD.width)
  })

  it("never shrinks past the floor, even for an absurd string", () => {
    expect(fitFontSize("Z".repeat(500), 115, 11, 5)).toBe(5)
  })

  it("clamps a long caption rather than letting it spill", () => {
    // The ellipsis is one character, so the result is at most maxChars.
    expect(clamp("Mouhamadou Moustapha Diagne", 22).length).toBeLessThanOrEqual(22)
    expect(clamp("Mouhamadou Moustapha Diagne", 22)).toMatch(/…$/)
    expect(clamp("Fatou", 22)).toBe("Fatou")
  })
})

describe("lines", () => {
  it("builds the birth line the artwork shows", () => {
    expect(birthLine("1979-03-20", "TIVAOUNE")).toBe("né le 20/03/1979 à TIVAOUNE")
  })

  it("omits each half independently rather than printing «né le à»", () => {
    expect(birthLine("1979-03-20", null)).toBe("né le 20/03/1979")
    expect(birthLine(null, "DAKAR")).toBe("à DAKAR")
    expect(birthLine(null, null)).toBe("")
  })

  it("builds the coverage line from the categories that have a rate", () => {
    expect(
      coverageLine([
        { label: "Soins", rate: 0.5 },
        { label: "Pharmacie", rate: 0.5 },
      ])
    ).toBe("Prise en charge Soins 50% Pharmacie 50%")
  })

  it("prints nothing at all when no category has a barème", () => {
    expect(coverageLine([])).toBe("")
  })

  it("upper-cases the surname the way the artwork sets it", () => {
    expect(holderName("Awa", "Diop")).toBe("DIOP Awa")
  })
})

describe("the ayant-droit grid", () => {
  it("has the artwork's nine boxes", () => {
    expect(DEPENDENT_CAPACITY).toBe(9)
    expect(DEPENDENT_BOXES).toHaveLength(9)
  })

  it("orders the boxes left to right, top to bottom", () => {
    // The order is what decides where the fourth ayant droit lands. The
    // artwork's own document order is not reading order, and transcribing it
    // verbatim put the fourth dependant in the middle of the second row with
    // the first cell left empty.
    const rows = [53.94, 105.64, 157.18]
    DEPENDENT_BOXES.forEach((box, index) => {
      expect(box.y).toBeCloseTo(rows[Math.floor(index / 3)]!, 0)
      expect(box.x).toBeCloseTo([15.93, 61.49, 107.05][index % 3]!, 1)
    })
  })

  it("fills the boxes in order, so the fourth dependant starts the second row", () => {
    const svg = renderBack(templates.back, {
      ...FULL,
      dependents: Array.from({ length: 4 }, (_, index) => dependent(`D${index}`)),
    })
    const fourth = DEPENDENT_BOXES[3]!
    const caption = svg.match(/<text[^>]*>D3 DIOP<\/text>/)?.[0]
    expect(caption).toBeDefined()
    expect(caption).toContain(`y="${fourth.ty}"`)
  })

  it("renders three filled boxes and six empty outlined ones", () => {
    const svg = renderBack(templates.back, FULL)

    // Every box keeps its stroke, filled or not.
    expect(svg.match(/stroke="#028f9d"/g) ?? []).toHaveLength(9)
    // Three captions, one per dependant.
    expect(svg).toContain("Fatou DIOP")
    expect(svg).toContain("Moussa DIOP")
    expect(svg).toContain("Aïda DIOP")
  })

  it("clips a dependant photo to the box's rounded rectangle, not a circle", () => {
    // The artwork draws these as rounded squares. A circular mask inside a
    // square frame leaves four empty corners and reads as a defect.
    const svg = renderBack(templates.back, {
      ...FULL,
      dependents: [
        { ...dependent("Fatou"), photo: "data:image/jpeg;base64,AAAA" },
      ],
    })
    const clip = svg.match(/<clipPath id="dep-clip-0">(.*?)<\/clipPath>/)?.[1]
    expect(clip).toBeDefined()
    expect(clip).toMatch(/^<rect /)
    expect(clip).toMatch(/rx="[\d.]+"/)
    expect(clip).not.toContain("<circle")
  })

  it("puts no placeholder text in an empty box", () => {
    const svg = renderBack(templates.back, EMPTY)
    expect(svg).not.toContain("Prénom Nom")
    expect(svg.match(/stroke="#028f9d"/g) ?? []).toHaveLength(9)
  })

  it("shows the first nine and silently drops the rest, which the card cannot hold", () => {
    const many = {
      ...FULL,
      dependents: Array.from({ length: 12 }, (_, index) => dependent(`D${index}`)),
    }
    const svg = renderBack(templates.back, many)
    expect(svg).toContain("D0 DIOP")
    expect(svg).toContain("D8 DIOP")
    expect(svg).not.toContain("D9 DIOP")
  })
})

describe("the QR block", () => {
  it("draws on the artwork's own origin and pitch", () => {
    const svg = qrRects(matrix(29))
    // Coordinates are written to three decimals.
    expect(svg).toContain(`x="${QR.originX.toFixed(3)}"`)
    expect(svg).toContain(`y="${QR.originY.toFixed(3)}"`)
    expect(svg).toContain(`width="${QR.module.toFixed(4)}"`)
  })

  it("refuses a symbol denser than the box can print", () => {
    // 37 modules is what a signed verification token needs — it does not scan
    // at 14 mm, so it must fail rather than print.
    expect(() => qrRects(matrix(37))).toThrow(/29/)
  })

  it("accepts a symbol at exactly the artwork's capacity", () => {
    expect(() => qrRects(matrix(29))).not.toThrow()
  })

  it("centres a smaller symbol inside the box", () => {
    expect(() => qrRects(matrix(25))).not.toThrow()
  })

  it("is absent, not blank, when there is no verification URL", () => {
    const svg = renderFront(templates.front, FULL, null)
    expect(svg).not.toContain("shape-rendering")
  })
})

describe("xml escaping", () => {
  it("escapes the five characters that matter", () => {
    expect(xml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;")
  })
})

describe("snapshot", () => {
  it("front is stable for a fixed card", () => {
    expect(renderFront(templates.front, FULL, matrix(29))).toMatchSnapshot()
  })

  it("back is stable for a fixed card", () => {
    expect(renderBack(templates.back, FULL)).toMatchSnapshot()
  })
})
