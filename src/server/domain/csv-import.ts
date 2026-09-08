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
  emploi: "jobTitle",
  categorie: "category",
  "fin de contrat": "contractEndDate",
  "date fin contrat": "contractEndDate",
  "date sortie": "contractEndDate",
  "date de sortie": "contractEndDate",
  sortie: "contractEndDate",
  "date entree": "hireDate",
  "date d'entree": "hireDate",
  entree: "hireDate",
  "type contrat": "contractType",
  "type de contrat": "contractType",
  contrat: "contractType",
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
  "contractType",
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

/**
 * One problem with one row.
 *
 * Two severities, because they mean different things to the person importing:
 * an **error** is a row that cannot become an employee, a **warning** is a row
 * that will import with a gap in it. Collapsing the two — which the first
 * version of this did — forces a choice between refusing good data and
 * accepting bad, and the file always contains some of each.
 */
export type RowIssue = {
  /** The column as the file spells it, so the fix is findable. */
  field: string
  message: string
  severity: "error" | "warning"
  /** What to do about it. Shown when the row is expanded. */
  fix?: string
}

export type RowStatus = "valid" | "warning" | "error"

export type ParsedRow = {
  /** 1-based, counting the header as row 1 — what the spreadsheet shows. */
  line: number
  values: Partial<Record<ImportField, string>>
  dates: { hireDate?: Date; dateOfBirth?: Date; contractEndDate?: Date }
  /** Resolved against the aliases, e.g. INTERIMAIRE → INTERIM. */
  contractType: string
  issues: RowIssue[]
  status: RowStatus
}

export type ParseSummary = {
  total: number
  valid: number
  warnings: number
  errors: number
}

export type ParseResult = {
  rows: ParsedRow[]
  summary: ParseSummary
  /** Headers we could not map, reported so the file can be corrected. */
  unknownHeaders: string[]
  mappedHeaders: Partial<Record<ImportField, string>>
}

export function summarise(rows: ParsedRow[]): ParseSummary {
  return {
    total: rows.length,
    valid: rows.filter((row) => row.status === "valid").length,
    warnings: rows.filter((row) => row.status === "warning").length,
    errors: rows.filter((row) => row.status === "error").length,
  }
}

/** Contract types as the files spell them. */
const CONTRACT_TYPES: Record<string, string> = {
  cdi: "CDI",
  cdd: "CDD",
  interim: "INTERIM",
  interimaire: "INTERIM",
  "contrat interim": "INTERIM",
  stage: "STAGE",
  stagiaire: "STAGE",
  prestation: "PRESTATION",
  prestataire: "PRESTATION",
  consultant: "PRESTATION",
}

export function normaliseContractType(raw: string | undefined): string {
  if (!raw) return ""
  return CONTRACT_TYPES[normaliseHeader(raw)] ?? ""
}

/** A fixed-term contract must say when it ends. */
export const DATED_CONTRACT_TYPES = ["CDD", "INTERIM"]

const MARITAL: Record<string, string> = {
  celibataire: "CELIBATAIRE",
  celibat: "CELIBATAIRE",
  single: "CELIBATAIRE",
  marie: "MARIE",
  mariee: "MARIE",
  married: "MARIE",
  veuf: "VEUF",
  veuve: "VEUF",
  divorce: "DIVORCE",
  divorcee: "DIVORCE",
  divorced: "DIVORCE",
}

export function normaliseMaritalStatus(raw: string | undefined): string {
  if (!raw) return ""
  return MARITAL[normaliseHeader(raw)] ?? raw.trim()
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
  dayFirst: boolean,
  options: ValidateOptions = {}
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

  const rows: ParsedRow[] = parsed.data.map((raw, index) => {
    const values: Partial<Record<ImportField, string>> = {}
    for (const [field, header] of Object.entries(mappedHeaders)) {
      const value = raw[header as string]
      if (typeof value === "string" && value.trim()) {
        values[field as ImportField] = value.trim()
      }
    }
    return validateRow(values, index + 2, dayFirst, mappedHeaders, options)
  })

  return { rows, summary: summarise(rows), unknownHeaders, mappedHeaders }
}

export type ValidateOptions = {
  /**
   * Applied to rows whose file gives no type. It is a real answer to a real
   * problem — an export that names no contract type would otherwise be entirely
   * unimportable — but it is a choice the person makes, not a default buried
   * in the parser.
   */
  defaultContractType?: string
  /** `now` is injectable so the tests do not depend on the day they run. */
  now?: Date
}

/**
 * One row, judged.
 *
 * The rules come from the legacy importer, which had them right; what it got
 * wrong was reporting. Every issue here names the column **as the file spells
 * it**, says what is wrong, and says what to do — a message like "Format de
 * date invalide" with no column and no example is a message that sends someone
 * back to a 400-row spreadsheet with no idea where to look.
 */
export function validateRow(
  values: Partial<Record<ImportField, string>>,
  line: number,
  dayFirst: boolean,
  mappedHeaders: Partial<Record<ImportField, string>> = {},
  options: ValidateOptions = {}
): ParsedRow {
  const now = options.now ?? new Date()
  const issues: RowIssue[] = []
  const dates: ParsedRow["dates"] = {}

  /** The column as the file spells it, falling back to a readable label. */
  const column = (field: ImportField, fallback: string) =>
    mappedHeaders[field] ?? fallback

  const error = (field: string, message: string, fix?: string) =>
    issues.push({ field, message, severity: "error", fix })
  const warn = (field: string, message: string, fix?: string) =>
    issues.push({ field, message, severity: "warning", fix })

  /* -- identity ----------------------------------------------------------- */

  if (!values.firstName) {
    error(column("firstName", "PRENOM"), "Le prénom est obligatoire.")
  }
  if (!values.lastName) {
    error(column("lastName", "NOM"), "Le nom est obligatoire.")
  }

  /* -- hire date ---------------------------------------------------------- */

  const hireColumn = column("hireDate", "DATE ENTREE")
  if (!values.hireDate) {
    error(
      hireColumn,
      "La date d'entrée est obligatoire.",
      "Format JJ/MM/AAAA, par exemple 15/01/2024."
    )
  } else {
    const hireDate = parseFlexibleDate(values.hireDate, dayFirst)
    if (!hireDate) {
      error(
        hireColumn,
        `Date illisible : « ${values.hireDate} »`,
        "Format JJ/MM/AAAA, par exemple 15/01/2024."
      )
    } else {
      dates.hireDate = hireDate
      if (hireDate.getTime() > now.getTime()) {
        // A future hire date is almost always a typo in the year, and it would
        // make the employee's seniority and their 730-day count nonsense.
        error(
          hireColumn,
          "La date d'entrée est dans le futur.",
          "Vérifiez l'année."
        )
      }
    }
  }

  /* -- contract type ------------------------------------------------------ */

  const typeColumn = column("contractType", "TYPE CONTRAT")
  const rawType = values.contractType
  let contractType = normaliseContractType(rawType)

  if (!contractType) {
    if (rawType) {
      error(
        typeColumn,
        `Type inconnu : « ${rawType} »`,
        "CDI, CDD, INTERIM, STAGE ou PRESTATION."
      )
    } else if (options.defaultContractType) {
      contractType = options.defaultContractType
      warn(
        typeColumn,
        "Type de contrat absent du fichier.",
        `Le type choisi au-dessus (${options.defaultContractType}) sera appliqué.`
      )
    } else {
      error(
        typeColumn,
        "Le type de contrat est obligatoire.",
        "Ajoutez la colonne, ou choisissez un type par défaut au-dessus."
      )
    }
  }

  /* -- end date, required for a fixed term -------------------------------- */

  const endColumn = column("contractEndDate", "DATE SORTIE")
  if (values.contractEndDate) {
    const end = parseFlexibleDate(values.contractEndDate, dayFirst)
    if (!end) {
      error(
        endColumn,
        `Date illisible : « ${values.contractEndDate} »`,
        "Format JJ/MM/AAAA, ou laissez vide."
      )
    } else {
      dates.contractEndDate = end
      if (dates.hireDate && end <= dates.hireDate) {
        error(endColumn, "La date de sortie précède ou égale l'entrée.")
      }
    }
  } else if (contractType && DATED_CONTRACT_TYPES.includes(contractType)) {
    // A fixed term with no term is the defect that gets a contract requalified
    // as a CDI, so it is refused rather than imported and discovered later.
    error(
      endColumn,
      `Un contrat ${contractType} doit avoir une date de fin.`,
      "Ajoutez la colonne DATE SORTIE, ou choisissez un type sans terme (CDI) au-dessus."
    )
  }

  /* -- date of birth ------------------------------------------------------ */

  const birthColumn = column("dateOfBirth", "DATE DE NAISSANCE")
  if (values.dateOfBirth) {
    const birth = parseFlexibleDate(values.dateOfBirth, dayFirst)
    if (!birth) {
      error(birthColumn, `Date illisible : « ${values.dateOfBirth} »`)
    } else {
      dates.dateOfBirth = birth
      const years =
        (now.getTime() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
      if (years < 16 || years > 100) {
        warn(
          birthColumn,
          `Âge inhabituel : ${Math.floor(years)} ans.`,
          "Souvent un siècle inversé — 1998 lu comme 2098."
        )
      }
    }
  } else {
    warn(birthColumn, "Date de naissance manquante.")
  }

  /* -- the rest ----------------------------------------------------------- */

  if (values.netSalary && !normaliseAmount(values.netSalary)) {
    warn(
      column("netSalary", "SALAIRE"),
      `Salaire illisible : « ${values.netSalary} »`,
      "Un nombre, par exemple 150000. Le champ sera laissé vide."
    )
  }

  const cniColumn = column("cni", "CNI")
  if (!values.cni) {
    warn(cniColumn, "Numéro CNI manquant.")
  } else if (values.cni.replace(/\D/g, "").length < 5) {
    warn(cniColumn, `Numéro CNI très court : « ${values.cni} »`)
  }

  if (!values.jobTitle) {
    warn(column("jobTitle", "EMPLOI"), "Emploi manquant.")
  }
  if (!values.nationality) {
    warn(column("nationality", "NATIONALITE"), "Nationalité manquante.")
  }

  if (values.maritalStatus) {
    const marital = normaliseMaritalStatus(values.maritalStatus)
    if (!["CELIBATAIRE", "MARIE", "VEUF", "DIVORCE"].includes(marital)) {
      warn(
        column("maritalStatus", "SITUATION MATRIMONIALE"),
        `Valeur inhabituelle : « ${values.maritalStatus} »`,
        "CELIBATAIRE, MARIE, VEUF ou DIVORCE."
      )
    }
  }

  const status: RowStatus = issues.some((issue) => issue.severity === "error")
    ? "error"
    : issues.length > 0
      ? "warning"
      : "valid"

  return { line, values, dates, contractType, issues, status }
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
