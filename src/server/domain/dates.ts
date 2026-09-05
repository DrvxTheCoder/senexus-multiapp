/**
 * Date handling shared by the CSV import and the leave calculator.
 *
 * No `server-only` marker: this is plain arithmetic with no database access,
 * and the import preview shows the parsed dates back to the user in the
 * browser before anything is written.
 */

export const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** All dates are stored at noon UTC — see `hr-schemas.ts` for why. */
export function utcNoon(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0))
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000)
}

/**
 * Parses the date formats a Senegalese HR spreadsheet actually contains.
 *
 * Accepted: `2024-03-05`, `05/03/2024`, `5-3-2024`, `05.03.2024`, and the same
 * with a two-digit year. Anything else is refused rather than guessed at.
 *
 * **Ambiguity is resolved by `dayFirst`, which defaults to true.** `03/04/2024`
 * is the 3rd of April here, not the 4th of March: the source files are French.
 * The import dialog states the assumption and lets it be flipped, because a
 * silent month/day swap is the kind of error nobody notices until payroll.
 *
 * Returns `null` for anything it cannot read — the caller reports the row
 * rather than substituting today's date, which is what the legacy importer did.
 */
export function parseFlexibleDate(
  raw: string,
  dayFirst = true
): Date | null {
  const value = raw.trim()
  if (!value) return null

  const iso = ISO_DATE.exec(value)
  if (iso) {
    const [, year, month, day] = iso
    return validate(Number(year), Number(month), Number(day))
  }

  const parts = value.split(/[/\-.\s]+/).filter(Boolean)
  if (parts.length !== 3) return null
  if (!parts.every((part) => /^\d+$/.test(part))) return null

  const [a, b, c] = parts.map(Number)

  // A four-digit leading number can only be a year.
  if (parts[0].length === 4) return validate(a, b, c)

  const year = expandYear(c)
  const [day, month] = dayFirst ? [a, b] : [b, a]

  // One of the two is unambiguously a day: use it even against `dayFirst`,
  // because a value above 12 cannot be a month whatever the convention.
  if (month > 12 && day <= 12) return validate(year, day, month)

  return validate(year, month, day)
}

function expandYear(value: number): number {
  if (value >= 1000) return value
  // A two-digit year in personnel data is a birth date or a hire date; both
  // are in living memory, so the century that keeps it in the past wins.
  return value <= 40 ? 2000 + value : 1900 + value
}

function validate(year: number, month: number, day: number): Date | null {
  if (year < 1900 || year > 2200) return null
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null

  const date = utcNoon(year, month, day)
  // Rejects 31 February rather than rolling it into March.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return date
}

/* -------------------------------------------------------------------------- */

/**
 * Working days between two dates, inclusive of both, counting Monday–Friday.
 *
 * Public holidays are **not** subtracted: the schema has nowhere to record the
 * Senegalese holiday calendar, and inventing a hard-coded list would be wrong
 * the first time a movable feast shifted. This matches the legacy calculation,
 * which counted the same way.
 */
export function businessDaysBetween(start: Date, end: Date): number {
  if (end < start) return 0

  let count = 0
  const cursor = new Date(
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate(),
      12
    )
  )
  const last = Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate(),
    12
  )

  while (cursor.getTime() <= last) {
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) count += 1
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return count
}
