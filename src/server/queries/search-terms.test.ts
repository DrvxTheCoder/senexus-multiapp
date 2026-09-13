import { describe, expect, it } from "vitest"

import { likeEscape, likePattern, searchTerms } from "@/server/queries/search-terms"
import { searchWhere } from "@/server/queries/search-where"

/**
 * The bug these pin: a two-word search returned nothing, because the whole
 * string was matched against each column on its own and no single column ever
 * held both halves of a name.
 */

describe("searchTerms", () => {
  it("splits a full name into its words", () => {
    expect(searchTerms("Fatou Diop")).toEqual(["Fatou", "Diop"])
  })

  it("ignores padding and repeated whitespace", () => {
    expect(searchTerms("  Fatou   Diop \t")).toEqual(["Fatou", "Diop"])
  })

  it("treats a blank box as no search at all", () => {
    expect(searchTerms("")).toEqual([])
    expect(searchTerms("   ")).toEqual([])
  })

  it("keeps a single word intact", () => {
    expect(searchTerms("Diop")).toEqual(["Diop"])
  })

  it("caps the number of terms so a pasted paragraph cannot blow up the query", () => {
    expect(searchTerms("a b c d e f g h i j k").length).toBe(8)
  })

  it("caps the length of a single term", () => {
    expect(searchTerms("x".repeat(500))[0]).toHaveLength(100)
  })
})

describe("likeEscape", () => {
  it("escapes the wildcards, so a typed % matches a literal %", () => {
    expect(likeEscape("100%")).toBe("100\\%")
    expect(likeEscape("a_b")).toBe("a\\_b")
    // one literal backslash in, two out
    expect(likeEscape("a\\b")).toBe("a\\\\b")
  })

  it("leaves an ordinary name alone", () => {
    expect(likeEscape("Diop")).toBe("Diop")
  })

  it("wraps a pattern around the escaped term", () => {
    expect(likePattern("Diop")).toBe("%Diop%")
    expect(likePattern("100%")).toBe("%100\\%%")
  })
})

describe("searchWhere", () => {
  const branches = (contains: { contains: string; mode: "insensitive" }) => [
    { firstName: contains },
    { lastName: contains },
  ]

  it("requires every word to match somewhere", () => {
    expect(searchWhere("Fatou Diop", branches)).toEqual({
      AND: [
        {
          OR: [
            { firstName: { contains: "Fatou", mode: "insensitive" } },
            { lastName: { contains: "Fatou", mode: "insensitive" } },
          ],
        },
        {
          OR: [
            { firstName: { contains: "Diop", mode: "insensitive" } },
            { lastName: { contains: "Diop", mode: "insensitive" } },
          ],
        },
      ],
    })
  })

  it("still builds a single clause for a one-word search", () => {
    expect(searchWhere("Diop", branches)).toEqual({
      AND: [
        {
          OR: [
            { firstName: { contains: "Diop", mode: "insensitive" } },
            { lastName: { contains: "Diop", mode: "insensitive" } },
          ],
        },
      ],
    })
  })

  it("returns undefined for a blank box rather than a clause matching nothing", () => {
    expect(searchWhere("", branches)).toBeUndefined()
    expect(searchWhere("   ", branches)).toBeUndefined()
  })
})
