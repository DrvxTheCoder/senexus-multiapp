import { describe, expect, it } from "vitest"

import {
  BLEED_MM,
  cardInputsHash,
  cardState,
  CARD_HEIGHT_MM,
  CARD_WIDTH_MM,
  geometry,
  layoutVerso,
  pixelsFor,
  PRINT_PPI,
  SCREEN_PPI,
  VERSO_CAPACITY,
  type CardInputs,
} from "@/server/domain/ipm/card"

describe("geometry", () => {
  it("matches the dimensions the plan states", () => {
    // 54 × 85.6 mm → 638 × 1011 px at 300 ppi, 319 × 506 at 150.
    expect(geometry(PRINT_PPI)).toMatchObject({ width: 638, height: 1011 })
    expect(geometry(SCREEN_PPI)).toMatchObject({ width: 319, height: 506 })
  })

  it("adds 3 mm of bleed on every side when asked", () => {
    // 638 + 2×35 = 708, 1011 + 2×35 = 1081 — the plan's 709 × 1082 rounds the
    // card itself up; what matters is that the bleed is 3 mm on each edge.
    const bled = geometry(PRINT_PPI, true)
    const plain = geometry(PRINT_PPI)
    const bleedPx = pixelsFor(BLEED_MM, PRINT_PPI)
    expect(bled.width - plain.width).toBe(bleedPx * 2)
    expect(bled.height - plain.height).toBe(bleedPx * 2)
  })

  it("has no bleed by default, because the preview would look wrong with it", () => {
    expect(geometry(PRINT_PPI).bleed).toBe(0)
  })

  it("round-trips back to the physical size", () => {
    const { width, height } = geometry(PRINT_PPI)
    expect((width / PRINT_PPI) * 25.4).toBeCloseTo(CARD_WIDTH_MM, 1)
    expect((height / PRINT_PPI) * 25.4).toBeCloseTo(CARD_HEIGHT_MM, 1)
  })
})

describe("layoutVerso — the overflow rule (Q4)", () => {
  const family = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ id: `d${index}` }))

  it("shows everyone when the family fits", () => {
    const layout = layoutVerso(family(4))
    expect(layout.shown).toHaveLength(4)
    expect(layout.overflow).toBe(0)
    expect(layout.notice).toBeNull()
  })

  it("fills the 3×3 grid exactly at nine", () => {
    const layout = layoutVerso(family(VERSO_CAPACITY))
    expect(layout.shown).toHaveLength(9)
    expect(layout.overflow).toBe(0)
    expect(layout.notice).toBeNull()
  })

  it("caps at nine and says how many are missing", () => {
    // The dataset holds families past twenty. Dropping the rest silently is
    // the one behaviour the rule exists to prevent.
    const layout = layoutVerso(family(12))
    expect(layout.shown).toHaveLength(9)
    expect(layout.overflow).toBe(3)
    expect(layout.notice).toContain("3")
  })

  it("keeps the first nine, in order", () => {
    const layout = layoutVerso(family(20))
    expect(layout.shown.map((entry) => entry.id)).toEqual([
      "d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8",
    ])
  })

  it("handles a participant with no family at all", () => {
    const layout = layoutVerso([])
    expect(layout.shown).toEqual([])
    expect(layout.notice).toBeNull()
  })

  it("says «autre» in the singular for exactly one overflow", () => {
    expect(layoutVerso(family(10)).notice).toContain("1 autre ayant droit")
  })
})

describe("cardInputsHash", () => {
  const base: CardInputs = {
    matricule: "01716",
    firstName: "Aminata",
    lastName: "Diop",
    birthDate: "1990-04-02",
    birthPlace: "Pikine",
    photoUrl: null,
    employerName: "Touba Gaz Mbao",
    planLabel: "Tawfeikh",
    rates: [
      { category: "CONSULTATION", rate: 1 },
      { category: "OPTIQUE", rate: null },
    ],
    dependents: [
      {
        matricule: "01716-01",
        firstName: "Modou",
        lastName: "Diop",
        relation: "CHILD",
        photoUrl: null,
      },
    ],
  }

  it("is stable for identical input", () => {
    expect(cardInputsHash(base)).toBe(cardInputsHash({ ...base }))
  })

  it("changes when a printed field changes", () => {
    const before = cardInputsHash(base)
    expect(cardInputsHash({ ...base, lastName: "Diouf" })).not.toBe(before)
    expect(cardInputsHash({ ...base, planLabel: "Noflay" })).not.toBe(before)
    expect(
      cardInputsHash({
        ...base,
        rates: [
          { category: "CONSULTATION", rate: 0.9 },
          { category: "OPTIQUE", rate: null },
        ],
      })
    ).not.toBe(before)
  })

  it("changes when an ayant droit is added or removed", () => {
    const before = cardInputsHash(base)
    expect(cardInputsHash({ ...base, dependents: [] })).not.toBe(before)
    expect(
      cardInputsHash({
        ...base,
        dependents: [
          ...base.dependents,
          {
            matricule: "01716-02",
            firstName: "Awa",
            lastName: "Diop",
            relation: "CHILD",
            photoUrl: null,
          },
        ],
      })
    ).not.toBe(before)
  })

  it("changes when a tenth dependent alters the overflow notice", () => {
    const nine = {
      ...base,
      dependents: Array.from({ length: 9 }, (_, index) => ({
        matricule: `01716-0${index}`,
        firstName: `P${index}`,
        lastName: "Diop",
        relation: "CHILD",
        photoUrl: null,
      })),
    }
    const ten = {
      ...nine,
      dependents: [
        ...nine.dependents,
        {
          matricule: "01716-10",
          firstName: "P9",
          lastName: "Diop",
          relation: "CHILD",
          photoUrl: null,
        },
      ],
    }
    // The tenth is not printed, but the notice under the grid is — so the
    // card genuinely differs and must not be reported as up to date.
    expect(cardInputsHash(ten)).not.toBe(cardInputsHash(nine))
  })

  it("ignores a dependent past the cap that changes nothing printed", () => {
    const twelve = {
      ...base,
      dependents: Array.from({ length: 12 }, (_, index) => ({
        matricule: `01716-${index}`,
        firstName: `P${index}`,
        lastName: "Diop",
        relation: "CHILD",
        photoUrl: null,
      })),
    }
    const renamedEleventh = {
      ...twelve,
      dependents: twelve.dependents.map((entry, index) =>
        index === 10 ? { ...entry, firstName: "Autre" } : entry
      ),
    }
    // Renaming somebody who does not appear on the card leaves the card
    // identical, so it must not be marked stale.
    expect(cardInputsHash(renamedEleventh)).toBe(cardInputsHash(twelve))
  })
})

describe("cardState", () => {
  it("is MISSING when no card was ever generated", () => {
    expect(cardState(null, "abc")).toBe("MISSING")
  })

  it("is CURRENT when the hash still matches", () => {
    expect(cardState({ inputsHash: "abc", revokedAt: null }, "abc")).toBe(
      "CURRENT"
    )
  })

  it("is STALE when the printed content has moved on", () => {
    expect(cardState({ inputsHash: "abc", revokedAt: null }, "def")).toBe(
      "STALE"
    )
  })

  it("is REVOKED regardless of the hash", () => {
    expect(
      cardState({ inputsHash: "abc", revokedAt: new Date() }, "abc")
    ).toBe("REVOKED")
  })
})
