import { describe, expect, it } from "vitest"

import {
  DUPLICATE_FIELD_THRESHOLD,
  findDuplicate,
  mapHeader,
  normaliseAmount,
  normaliseContractType,
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
  // Headers as the real exports spell them, uppercase and French.
  const csv = [
    "PRENOM,NOM,DATE ENTREE,TYPE CONTRAT,DATE SORTIE,CNI,EMPLOI,NATIONALITE,DATE DE NAISSANCE",
    "Fatou,Diop,05/03/2024,CDI,,1234567890123,Technicienne,Sénégalaise,12/05/1990",
    "Abdou,Touré,02/11/2023,INTERIMAIRE,30/06/2024,2234567890123,Chauffeur,Sénégalaise,03/08/1985",
    ",Sow,01/01/2024,CDI,,3234567890123,Laveuse,Sénégalaise,01/01/1992",
    "Awa,Fall,pas une date,CDI,,4234567890123,Réceptionniste,Sénégalaise,07/07/1995",
  ].join("\n")

  const options = { now: new Date("2026-09-08T12:00:00.000Z") }

  it("maps the headers it knows and reports the rest", () => {
    const result = parseEmployeeCsv("PRENOM,NOM,Zzz\nA,B,C", true)
    expect(result.unknownHeaders).toEqual(["Zzz"])
    expect(result.mappedHeaders.firstName).toBe("PRENOM")
  })

  it("reads the headers the real exports use", () => {
    const { mappedHeaders } = parseEmployeeCsv(csv, true, options)
    expect(mappedHeaders.hireDate).toBe("DATE ENTREE")
    expect(mappedHeaders.contractEndDate).toBe("DATE SORTIE")
    expect(mappedHeaders.contractType).toBe("TYPE CONTRAT")
    expect(mappedHeaders.jobTitle).toBe("EMPLOI")
  })

  it("numbers rows the way the spreadsheet does", () => {
    const { rows } = parseEmployeeCsv(csv, true, options)
    expect(rows[0].line).toBe(2)
    expect(rows[3].line).toBe(5)
  })

  it("separates rows that cannot import from rows that merely have gaps", () => {
    const { rows, summary } = parseEmployeeCsv(csv, true, options)
    expect(rows).toHaveLength(4)

    expect(rows[0].status).toBe("valid")
    expect(toIsoDate(rows[0].dates.hireDate!)).toBe("2024-03-05")

    expect(rows[1].status).toBe("valid")
    expect(rows[1].contractType).toBe("INTERIM")

    // A missing first name stops that row, not the batch.
    expect(rows[2].status).toBe("error")
    expect(rows[2].issues.some((i) => i.field === "PRENOM")).toBe(true)

    // An unreadable date is reported, never silently replaced.
    expect(rows[3].status).toBe("error")
    expect(rows[3].dates.hireDate).toBeUndefined()

    expect(summary).toEqual({ total: 4, valid: 2, warnings: 0, errors: 2 })
  })

  it("names the column as the file spells it, and keeps the raw value", () => {
    const { rows } = parseEmployeeCsv(csv, true, options)
    const issue = rows[3].issues.find((i) => i.severity === "error")!
    expect(issue.field).toBe("DATE ENTREE")
    expect(issue.message).toContain("pas une date")
    expect(issue.fix).toContain("JJ/MM/AAAA")
  })

  it("requires an end date for a fixed term, and not otherwise", () => {
    const dated = parseEmployeeCsv(
      "PRENOM,NOM,DATE ENTREE,TYPE CONTRAT\nA,B,01/06/2024,CDD",
      true,
      options
    )
    expect(dated.rows[0].status).toBe("error")
    expect(
      dated.rows[0].issues.some((i) => i.message.includes("date de fin"))
    ).toBe(true)

    const openEnded = parseEmployeeCsv(
      "PRENOM,NOM,DATE ENTREE,TYPE CONTRAT\nA,B,01/06/2024,CDI",
      true,
      options
    )
    expect(
      openEnded.rows[0].issues.some((i) => i.severity === "error")
    ).toBe(false)
  })

  it("refuses an end date that precedes the hire date", () => {
    const { rows } = parseEmployeeCsv(
      "PRENOM,NOM,DATE ENTREE,DATE SORTIE,TYPE CONTRAT\nA,B,01/06/2024,01/01/2024,CDD",
      true,
      options
    )
    expect(rows[0].status).toBe("error")
    expect(rows[0].issues.some((i) => i.field === "DATE SORTIE")).toBe(true)
  })

  it("refuses a hire date in the future", () => {
    const { rows } = parseEmployeeCsv(
      "PRENOM,NOM,DATE ENTREE,TYPE CONTRAT\nA,B,01/06/2099,CDI",
      true,
      options
    )
    expect(rows[0].status).toBe("error")
    expect(rows[0].issues.some((i) => i.message.includes("futur"))).toBe(true)
  })

  it("takes a default contract type, and says it did", () => {
    const source = "PRENOM,NOM,DATE ENTREE\nA,B,01/06/2024"

    const without = parseEmployeeCsv(source, true, options)
    expect(without.rows[0].status).toBe("error")

    const withDefault = parseEmployeeCsv(source, true, {
      ...options,
      defaultContractType: "CDI",
    })
    expect(withDefault.rows[0].status).toBe("warning")
    expect(withDefault.rows[0].contractType).toBe("CDI")
    // Applied, but never silently.
    expect(
      withDefault.rows[0].issues.some(
        (i) => i.severity === "warning" && i.fix?.includes("CDI")
      )
    ).toBe(true)
  })

  it("warns about gaps without refusing the row", () => {
    const { rows } = parseEmployeeCsv(
      "PRENOM,NOM,DATE ENTREE,TYPE CONTRAT\nA,B,01/06/2024,CDI",
      true,
      options
    )
    expect(rows[0].status).toBe("warning")
    const fields = rows[0].issues.map((i) => i.field)
    expect(fields).toContain("CNI")
    expect(fields).toContain("EMPLOI")
    expect(fields).toContain("NATIONALITE")
    expect(rows[0].issues.every((i) => i.severity === "warning")).toBe(true)
  })

  it("flags an age that is almost certainly a mistyped century", () => {
    const { rows } = parseEmployeeCsv(
      "PRENOM,NOM,DATE ENTREE,TYPE CONTRAT,DATE DE NAISSANCE\nA,B,01/06/2024,CDI,12/05/2098",
      true,
      options
    )
    const issue = rows[0].issues.find((i) => i.field === "DATE DE NAISSANCE")!
    expect(issue.severity).toBe("warning")
    expect(issue.message).toMatch(/Âge inhabituel/)
  })
})

describe("normaliseContractType", () => {
  it.each([
    ["CDI", "CDI"],
    ["cdd", "CDD"],
    ["Intérimaire", "INTERIM"],
    ["INTERIM", "INTERIM"],
    ["Consultant", "PRESTATION"],
    ["Stagiaire", "STAGE"],
  ])("reads %j", (raw, expected) => {
    expect(normaliseContractType(raw)).toBe(expected)
  })

  it("returns nothing for a type it does not know, rather than guessing", () => {
    expect(normaliseContractType("VACATAIRE")).toBe("")
    expect(normaliseContractType("")).toBe("")
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
  ): ParsedRow => ({
    line: 2,
    values,
    dates,
    contractType: "CDI",
    issues: [],
    status: "valid",
  })

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
