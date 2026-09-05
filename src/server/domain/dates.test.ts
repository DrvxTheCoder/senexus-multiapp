import { describe, expect, it } from "vitest"

import {
  businessDaysBetween,
  parseFlexibleDate,
  toIsoDate,
  utcNoon,
} from "@/server/domain/dates"

describe("parseFlexibleDate", () => {
  it("reads ISO", () => {
    expect(toIsoDate(parseFlexibleDate("2024-03-05")!)).toBe("2024-03-05")
  })

  it.each([
    ["05/03/2024", "2024-03-05"],
    ["5-3-2024", "2024-03-05"],
    ["05.03.2024", "2024-03-05"],
    ["05 03 2024", "2024-03-05"],
  ])("reads %j day-first", (raw, expected) => {
    expect(toIsoDate(parseFlexibleDate(raw)!)).toBe(expected)
  })

  it("is day-first by default and month-first on request", () => {
    // The one that matters: 03/04/2024 is either 3 April or 4 March, and the
    // source files are French.
    expect(toIsoDate(parseFlexibleDate("03/04/2024", true)!)).toBe("2024-04-03")
    expect(toIsoDate(parseFlexibleDate("03/04/2024", false)!)).toBe("2024-03-04")
  })

  it("lets an unambiguous day win over the convention", () => {
    // 12/25 cannot be day/month, whatever the setting says.
    expect(toIsoDate(parseFlexibleDate("12/25/2024", true)!)).toBe("2024-12-25")
  })

  it("expands a two-digit year into the century that keeps it in the past", () => {
    expect(toIsoDate(parseFlexibleDate("05/03/24")!)).toBe("2024-03-05")
    expect(toIsoDate(parseFlexibleDate("05/03/85")!)).toBe("1985-03-05")
  })

  it("refuses a date that does not exist rather than rolling it over", () => {
    expect(parseFlexibleDate("31/02/2024")).toBeNull()
    expect(parseFlexibleDate("2024-02-30")).toBeNull()
  })

  it.each(["", "   ", "hier", "12/2024", "1/2/3/4", "aa/bb/cccc"])(
    "returns null for %j rather than guessing",
    (raw) => {
      expect(parseFlexibleDate(raw)).toBeNull()
    }
  )

  it("stores at noon, so no offset can shift the day", () => {
    const date = parseFlexibleDate("2024-03-05")!
    expect(date.getUTCHours()).toBe(12)
  })
})

describe("businessDaysBetween", () => {
  // 2024-03-04 is a Monday.
  const monday = utcNoon(2024, 3, 4)

  it("counts one day for a single weekday", () => {
    expect(businessDaysBetween(monday, monday)).toBe(1)
  })

  it("counts a full week as five", () => {
    expect(businessDaysBetween(monday, utcNoon(2024, 3, 10))).toBe(5)
  })

  it("skips the weekend inside a range", () => {
    // Friday to Monday: two working days, not four.
    expect(businessDaysBetween(utcNoon(2024, 3, 8), utcNoon(2024, 3, 11))).toBe(2)
  })

  it("counts nothing for a weekend-only range", () => {
    expect(businessDaysBetween(utcNoon(2024, 3, 9), utcNoon(2024, 3, 10))).toBe(0)
  })

  it("counts nothing when the range is inverted", () => {
    expect(businessDaysBetween(utcNoon(2024, 3, 10), monday)).toBe(0)
  })

  it("crosses a month and a leap day", () => {
    // 2024-02-26 (Mon) to 2024-03-01 (Fri): five working days including 29 Feb.
    expect(businessDaysBetween(utcNoon(2024, 2, 26), utcNoon(2024, 3, 1))).toBe(5)
  })
})
