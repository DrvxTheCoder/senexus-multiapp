import { describe, expect, it } from "vitest"

import {
  DUPLICATE_FIELD_THRESHOLD,
  findDuplicate,
  mapHeader,
  normaliseAmount,
  normaliseGender,
  parseEmployeeCsv,
  type DuplicateCandidate,
  type ParsedRow,
} from "@/server/domain/csv-import"
import { toIsoDate, utcNoon } from "@/server/domain/dates"

describe("mapHeader", () => {
  it.each([
    ["Prénom", "firstName"],
    ["PRENOMS", "firstName"],
    ["Nom", "lastName"],
    ["Date d'embauche", "hireDate"],
    ["  Téléphone  ", "phone"],
    ["Salaire net", "netSalary"],
    ["hireDate", "hireDate"],
  ])("maps %j", (header, field) => {
    expect(mapHeader(header)).toBe(field)
  })

  it("returns null for a header it does not know", () => {
    expect(mapHeader("Observations diverses")).toBeNull()
  })
})

describe("parseEmployeeCsv", () => {
  const csv = [
    "Matricule,Prénom,Nom,Date d'embauche,Téléphone,Salaire",
    "CI0001,Fatou,Diop,05/03/2024,77 123 45 67,250 000",
    ",Abdou,Touré,2023-11-02,,180000",
    ",,Sow,01/01/2024,,",
    ",Awa,Fall,pas une date,,",
  ].join("\n")

  it("maps the headers it knows and reports the rest", () => {
    const result = parseEmployeeCsv("Prénom,Nom,Zzz\nA,B,C", true)
    expect(result.unknownHeaders).toEqual(["Zzz"])
    expect(result.mappedHeaders.firstName).toBe("Prénom")
  })

  it("numbers rows the way the spreadsheet does", () => {
    const { rows } = parseEmployeeCsv(csv, true)
    expect(rows[0].line).toBe(2)
    expect(rows[3].line).toBe(5)
  })

  it("parses the good rows and reports the bad ones without losing either", () => {
    const { rows } = parseEmployeeCsv(csv, true)
    expect(rows).toHaveLength(4)

    expect(rows[0].errors).toEqual([])
    expect(toIsoDate(rows[0].dates.hireDate!)).toBe("2024-03-05")

    expect(rows[1].errors).toEqual([])
    expect(toIsoDate(rows[1].dates.hireDate!)).toBe("2023-11-02")

    // A missing first name is a row error, not a reason to abort the batch.
    expect(rows[2].errors).toContain("Prénom manquant.")
    // An unreadable date is reported, never silently replaced.
    expect(rows[3].errors.join(" ")).toMatch(/illisible/)
    expect(rows[3].dates.hireDate).toBeUndefined()
  })

  it("keeps the raw value in the error so the file can be corrected", () => {
    const { rows } = parseEmployeeCsv(csv, true)
    expect(rows[3].errors.join(" ")).toContain("pas une date")
  })

  it("refuses a contract end before the hire date", () => {
    const { rows } = parseEmployeeCsv(
      "Prénom,Nom,Date d'embauche,Fin de contrat\nA,B,01/06/2024,01/01/2024",
      true
    )
    expect(rows[0].errors).toContain("La fin de contrat précède l'embauche.")
  })
})

describe("normalisers", () => {
  it.each([
    ["M", "MALE"],
    ["homme", "MALE"],
    ["Féminin", "FEMALE"],
    ["F", "FEMALE"],
    ["", ""],
    ["inconnu", ""],
  ])("reads the gender %j", (raw, expected) => {
    expect(normaliseGender(raw)).toBe(expected)
  })

  it("strips separators and currency from an amount", () => {
    expect(normaliseAmount("250 000 FCFA")).toBe("250000")
    expect(normaliseAmount("1.250.000")).toBe("1250000")
    expect(normaliseAmount("n/a")).toBe("")
  })
})

describe("findDuplicate", () => {
  const existing: DuplicateCandidate = {
    id: "emp-1",
    matricule: "CI0042",
    firstName: "Fatou",
    lastName: "Diop",
    cni: "1234567890123",
    phone: "771234567",
    email: "fatou.diop@example.sn",
    dateOfBirth: utcNoon(1990, 5, 12),
    hireDate: utcNoon(2022, 1, 10),
  }

  const row = (
    values: ParsedRow["values"],
    dates: ParsedRow["dates"] = {}
  ): ParsedRow => ({ line: 2, values, dates, errors: [] })

  it("treats a matching matricule as conclusive on its own", () => {
    const verdict = findDuplicate(row({ matricule: "ci0042" }), [existing])
    expect(verdict?.employeeId).toBe("emp-1")
    expect(verdict?.matched).toEqual(["matricule"])
  })

  it("does not call three matching fields a duplicate", () => {
    // Name plus date of birth: common enough inside one firm to import.
    const verdict = findDuplicate(
      row(
        { firstName: "Fatou", lastName: "Diop" },
        { dateOfBirth: utcNoon(1990, 5, 12) }
      ),
      [existing]
    )
    expect(verdict).toBeNull()
  })

  it("calls four matching fields a duplicate", () => {
    const verdict = findDuplicate(
      row(
        { firstName: "Fatou", lastName: "Diop", phone: "771234567" },
        { dateOfBirth: utcNoon(1990, 5, 12) }
      ),
      [existing]
    )
    expect(verdict?.employeeId).toBe("emp-1")
    expect(verdict?.matched.length).toBe(DUPLICATE_FIELD_THRESHOLD)
  })

  it("keeps counting past the threshold and reports what matched", () => {
    const verdict = findDuplicate(
      row(
        {
          firstName: "Fatou",
          lastName: "Diop",
          phone: "771234567",
          cni: "1234567890123",
          email: "FATOU.DIOP@example.sn",
        },
        { dateOfBirth: utcNoon(1990, 5, 12), hireDate: utcNoon(2022, 1, 10) }
      ),
      [existing]
    )
    expect(verdict?.matched).toContain("CNI")
    expect(verdict?.matched).toContain("embauche")
    expect(verdict!.matched.length).toBe(7)
  })

  it("ignores blank fields rather than counting them as agreement", () => {
    // Two employees with no CNI, no phone and no email on file must not match
    // on those absences.
    const blank: DuplicateCandidate = {
      ...existing,
      cni: null,
      phone: null,
      email: null,
      dateOfBirth: null,
    }
    const verdict = findDuplicate(
      row({ firstName: "Fatou", lastName: "Diop" }),
      [blank]
    )
    expect(verdict).toBeNull()
  })

  it("picks the strongest candidate when several match", () => {
    const weaker: DuplicateCandidate = {
      ...existing,
      id: "emp-2",
      matricule: "CI0099",
      cni: null,
      email: null,
    }
    const verdict = findDuplicate(
      row(
        {
          firstName: "Fatou",
          lastName: "Diop",
          phone: "771234567",
          cni: "1234567890123",
        },
        { dateOfBirth: utcNoon(1990, 5, 12) }
      ),
      [weaker, existing]
    )
    expect(verdict?.employeeId).toBe("emp-1")
  })
})
