import Papa from "papaparse"

import { parseFlexibleDate, toIsoDate } from "@/server/domain/dates"

/**
 * The employee CSV import.
 *
 * Parsing, header mapping and duplicate detection live here, away from the
 * action, because they are the parts worth testing: the legacy importer got
 * ambiguous dates wrong, aborted the whole batch on one bad row, and reported
 * failures as a single count with no indication of which row failed.
 *
 * Three rules this keeps:
 *
 *   1. **Per row.** A row that cannot be read is reported and skipped; the
 *      rest of the file still imports.
 *   2. **Never guess a date.** An unreadable date is an error on that row, not
 *      a silent fallback to today.
 *   3. **Duplicates are a judgement, not a certainty.** Matching on four or
 *      more identifying fields is reported as a duplicate; fewer is not. The
 *      caller decides whether to skip or import anyway.
 */

/** Header spellings seen in the real exports, normalised to our field names. */
const HEADER_ALIASES: Record<string, string> = {
  matricule: "matricule",
  nom: "lastName",
  "nom de famille": "lastName",
  prenom: "firstName",
  prenoms: "firstName",
  "prenom(s)": "firstName",
  telephone: "phone",
  tel: "phone",
  "n° telephone": "phone",
  email: "email",
  "e-mail": "email",
  adresse: "address",
  cni: "cni",
  "n° cni": "cni",
  "numero cni": "cni",
  nationalite: "nationality",
  "date de naissance": "dateOfBirth",
  naissance: "dateOfBirth",
  "lieu de naissance": "placeOfBirth",
  sexe: "gender",
  genre: "gender",
  "situation matrimoniale": "maritalStatus",
  "nom du pere": "fatherName",
  pere: "fatherName",
  "nom de la mere": "motherName",
  mere: "motherName",
  "date embauche": "hireDate",
  "date d'embauche": "hireDate",
  embauche: "hireDate",
  poste: "jobTitle",
  fonction: "jobTitle",
  categorie: "category",
  "fin de contrat": "contractEndDate",
  "date fin contrat": "contractEndDate",
  salaire: "netSalary",
  "salaire net": "netSalary",
  client: "clientName",
  "client affecte": "clientName",
  departement: "departmentName",
  service: "departmentName",
}

export const IMPORT_FIELDS = [
  "matricule",
  "firstName",
  "lastName",
  "phone",
  "email",
  "address",
  "cni",
  "nationality",
  "dateOfBirth",
  "placeOfBirth",
  "gender",
  "maritalStatus",
  "fatherName",
  "motherName",
  "hireDate",
  "jobTitle",
  "category",
  "contractEndDate",
  "netSalary",
  "clientName",
  "departmentName",
] as const

export type ImportField = (typeof IMPORT_FIELDS)[number]

/** Accents and case vary between exports; the mapping should not. */
function normaliseHeader(header: string): string {
  return header
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function mapHeader(header: string): ImportField | null {
  const key = normaliseHeader(header)
  const mapped = HEADER_ALIASES[key]
  if (mapped) return mapped as ImportField
  // A header that already names one of our fields is accepted as-is, so a file
  // exported from this application re-imports without a mapping table. Matched
  // case-insensitively, because `normaliseHeader` has already lowercased it.
  return (
    IMPORT_FIELDS.find((field) => field.toLowerCase() === key) ?? null
  )
}

export type ParsedRow = {
  /** 1-based, counting the header as row 1 — what the spreadsheet shows. */
  line: number
  values: Partial<Record<ImportField, string>>
  dates: { hireDate?: Date; dateOfBirth?: Date; contractEndDate?: Date }
  errors: string[]
}

export type ParseResult = {
  rows: ParsedRow[]
  /** Headers we could not map, reported so the file can be corrected. */
  unknownHeaders: string[]
  mappedHeaders: Partial<Record<ImportField, string>>
}

const GENDERS: Record<string, "MALE" | "FEMALE" | "OTHER"> = {
  m: "MALE",
  h: "MALE",
  homme: "MALE",
  masculin: "MALE",
  male: "MALE",
  f: "FEMALE",
  femme: "FEMALE",
  feminin: "FEMALE",
  female: "FEMALE",
}

export function normaliseGender(raw: string | undefined): string {
  if (!raw) return ""
  return GENDERS[normaliseHeader(raw)] ?? ""
}

/** Strips thousands separators and any currency suffix. */
export function normaliseAmount(raw: string | undefined): string {
  if (!raw) return ""
  const digits = raw.replace(/[^\d]/g, "")
  return digits
}

export function parseEmployeeCsv(
  text: string,
  dayFirst: boolean
): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  })

  const headers = parsed.meta.fields ?? []
  const mappedHeaders: Partial<Record<ImportField, string>> = {}
  const unknownHeaders: string[] = []

  for (const header of headers) {
    const field = mapHeader(header)
    if (field) mappedHeaders[field] ??= header
    else unknownHeaders.push(header)
  }

  const rows: ParsedRow[] = []

  parsed.data.forEach((raw, index) => {
    const values: Partial<Record<ImportField, string>> = {}
    for (const [field, header] of Object.entries(mappedHeaders)) {
      const value = raw[header as string]
      if (typeof value === "string" && value.trim()) {
        values[field as ImportField] = value.trim()
      }
    }

    const errors: string[] = []
    const dates: ParsedRow["dates"] = {}

    if (!values.firstName) errors.push("Prénom manquant.")
    if (!values.lastName) errors.push("Nom manquant.")

    if (!values.hireDate) {
      errors.push("Date d'embauche manquante.")
    } else {
      const hireDate = parseFlexibleDate(values.hireDate, dayFirst)
      if (!hireDate) errors.push(`Date d'embauche illisible : ${values.hireDate}`)
      else dates.hireDate = hireDate
    }

    for (const field of ["dateOfBirth", "contractEndDate"] as const) {
      const value = values[field]
      if (!value) continue
      const date = parseFlexibleDate(value, dayFirst)
      if (!date) {
        errors.push(
          `${field === "dateOfBirth" ? "Date de naissance" : "Fin de contrat"} illisible : ${value}`
        )
      } else {
        dates[field] = date
      }
    }

    if (
      dates.hireDate &&
      dates.contractEndDate &&
      dates.contractEndDate < dates.hireDate
    ) {
      errors.push("La fin de contrat précède l'embauche.")
    }

    if (values.netSalary && !normaliseAmount(values.netSalary)) {
      errors.push(`Salaire illisible : ${values.netSalary}`)
    }

    rows.push({ line: index + 2, values, dates, errors })
  })

  return { rows, unknownHeaders, mappedHeaders }
}

/* -------------------------------------------------------------------------- */

/**
 * Existing employees, reduced to the fields a duplicate is judged on.
 */
export type DuplicateCandidate = {
  id: string
  matricule: string
  firstName: string
  lastName: string
  cni: string | null
  phone: string | null
  email: string | null
  dateOfBirth: Date | null
  hireDate: Date
}

export type DuplicateVerdict = {
  employeeId: string
  matricule: string
  /** Fields that matched, for the report. */
  matched: string[]
}

/** The legacy heuristic: four or more matching identifying fields. */
export const DUPLICATE_FIELD_THRESHOLD = 4

const compare = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b && normaliseHeader(a) === normaliseHeader(b))

/**
 * Decides whether a parsed row is the same person as an existing employee.
 *
 * A matching **matricule** is conclusive on its own — it is unique per firm, so
 * two rows sharing one are the same record by definition. Otherwise the row
 * must agree on at least `DUPLICATE_FIELD_THRESHOLD` of first name, last name,
 * CNI, phone, email, date of birth and hire date.
 *
 * The threshold is a judgement about Senegalese personnel data, where names
 * repeat heavily inside one firm: two Fatou Diop who share a hire date are
 * ordinary, and three matches is not enough to refuse an import.
 */
export function findDuplicate(
  row: ParsedRow,
  candidates: DuplicateCandidate[]
): DuplicateVerdict | null {
  if (row.values.matricule) {
    const exact = candidates.find(
      (candidate) =>
        candidate.matricule.toUpperCase() === row.values.matricule!.toUpperCase()
    )
    if (exact) {
      return {
        employeeId: exact.id,
        matricule: exact.matricule,
        matched: ["matricule"],
      }
    }
  }

  let best: DuplicateVerdict | null = null

  for (const candidate of candidates) {
    const matched: string[] = []

    if (compare(row.values.firstName, candidate.firstName)) matched.push("prénom")
    if (compare(row.values.lastName, candidate.lastName)) matched.push("nom")
    if (compare(row.values.cni, candidate.cni)) matched.push("CNI")
    if (compare(row.values.phone, candidate.phone)) matched.push("téléphone")
    if (compare(row.values.email, candidate.email)) matched.push("email")

    if (
      row.dates.dateOfBirth &&
      candidate.dateOfBirth &&
      toIsoDate(row.dates.dateOfBirth) === toIsoDate(candidate.dateOfBirth)
    ) {
      matched.push("naissance")
    }

    if (
      row.dates.hireDate &&
      toIsoDate(row.dates.hireDate) === toIsoDate(candidate.hireDate)
    ) {
      matched.push("embauche")
    }

    if (
      matched.length >= DUPLICATE_FIELD_THRESHOLD &&
      matched.length > (best?.matched.length ?? 0)
    ) {
      best = {
        employeeId: candidate.id,
        matricule: candidate.matricule,
        matched,
      }
    }
  }

  return best
}
