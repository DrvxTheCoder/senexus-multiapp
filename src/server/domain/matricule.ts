import "server-only"

import type { Prisma } from "@prisma/client"

/**
 * Matricule generation.
 *
 * Format is `{PREFIX}{4 digits}`, e.g. `CI0142`, unique per firm — the schema
 * enforces `@@unique([firmId, matricule])`.
 *
 * Two things the legacy implementation got wrong:
 *
 * 1. **Every firm generated `CI####`.** `generateNextMatricule` took a `prefix`
 *    parameter that no caller ever passed, so Synergie Pro employees were also
 *    numbered `CI`. That is the root cause of the matricule collisions the
 *    transfer flow keeps hitting, and the reason `newMatricule` had to be added
 *    to `EmployeeTransfer` at all.
 * 2. **It was not race-safe.** It read the highest matricule, added one, then
 *    wrote — so two concurrent creations computed the same number and one hit
 *    the unique constraint as a raw 500.
 *
 * The prefix now lives per firm in `FirmModule.settings` on the HR module — the
 * schema's own JSON extension point, since the schema is frozen and there is no
 * column for it. Generation happens inside the caller's transaction and retries
 * on collision.
 */

export const HR_MODULE_SLUG = "hr"

/** Fallback when a firm has no configured prefix: initials from its slug. */
export function derivePrefix(slug: string): string {
  const letters = slug
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")

  const prefix = letters.slice(0, 2)
  return prefix.length >= 2 ? prefix : (slug.slice(0, 2).toUpperCase() || "XX")
}

type Settings = { matriculePrefix?: unknown }

/** Reads the configured prefix, falling back to the slug-derived one. */
export async function matriculePrefixFor(
  tx: Prisma.TransactionClient,
  firmId: string
): Promise<string> {
  const firm = await tx.firm.findUnique({
    where: { id: firmId },
    select: {
      slug: true,
      firmModules: {
        where: { module: { slug: HR_MODULE_SLUG } },
        select: { settings: true },
        take: 1,
      },
    },
  })

  if (!firm) return "XX"

  const settings = firm.firmModules[0]?.settings as Settings | null
  const configured = settings?.matriculePrefix

  if (typeof configured === "string" && /^[A-Z]{1,4}$/.test(configured)) {
    return configured
  }

  return derivePrefix(firm.slug)
}

/**
 * Stores the prefix on the firm's HR module row, creating the row if the module
 * is installed but not yet configured. A blank value clears it, which puts the
 * firm back on the slug-derived default.
 */
export async function writeMatriculePrefix(
  tx: Prisma.TransactionClient,
  firmId: string,
  prefix: string
): Promise<void> {
  const hr = await tx.module.findUnique({
    where: { slug: HR_MODULE_SLUG },
    select: { id: true },
  })
  if (!hr) return

  const existing = await tx.firmModule.findUnique({
    where: { firmId_moduleId: { firmId, moduleId: hr.id } },
    select: { settings: true },
  })

  const settings = {
    ...((existing?.settings as Record<string, unknown> | null) ?? {}),
    matriculePrefix: prefix || undefined,
  }

  await tx.firmModule.upsert({
    where: { firmId_moduleId: { firmId, moduleId: hr.id } },
    update: { settings: settings as Prisma.InputJsonObject },
    create: {
      firmId,
      moduleId: hr.id,
      isEnabled: true,
      settings: settings as Prisma.InputJsonObject,
    },
  })
}

export function formatMatricule(prefix: string, sequence: number): string {
  return `${prefix}${String(sequence).padStart(4, "0")}`
}

/**
 * The next free matricule for a firm.
 *
 * Ordering is numeric on the suffix rather than lexicographic on the whole
 * string, so a firm holding both `CI0999` and a legacy `CI1000` still advances
 * correctly. Callers should pass their own transaction and be prepared to
 * retry — see `nextMatriculeWithRetry`.
 */
export async function nextMatricule(
  tx: Prisma.TransactionClient,
  firmId: string,
  prefixOverride?: string
): Promise<string> {
  const prefix = prefixOverride ?? (await matriculePrefixFor(tx, firmId))

  const rows = await tx.employee.findMany({
    where: { firmId, matricule: { startsWith: prefix } },
    select: { matricule: true },
  })

  let highest = 0
  for (const row of rows) {
    const suffix = row.matricule.slice(prefix.length)
    if (!/^\d+$/.test(suffix)) continue
    const value = Number.parseInt(suffix, 10)
    if (value > highest) highest = value
  }

  const next = highest + 1
  if (next > 9999) {
    throw new Error(
      `Le préfixe ${prefix} a atteint 9999 matricules pour cette entreprise.`
    )
  }

  return formatMatricule(prefix, next)
}

/**
 * Generates a matricule and hands it to `write`, retrying on the unique
 * constraint. Two people onboarding an employee at the same moment both get a
 * valid number instead of one of them seeing a database error.
 */
export async function nextMatriculeWithRetry<T>(
  tx: Prisma.TransactionClient,
  firmId: string,
  write: (matricule: string) => Promise<T>,
  attempts = 5
): Promise<T> {
  const prefix = await matriculePrefixFor(tx, firmId)
  let taken = 0

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidate = await nextMatricule(tx, firmId, prefix)
    const bumped = formatMatricule(
      prefix,
      Number.parseInt(candidate.slice(prefix.length), 10) + taken
    )

    try {
      return await write(bumped)
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      taken += 1
    }
  }

  throw new Error(
    "Impossible d'attribuer un matricule unique après plusieurs tentatives."
  )
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  )
}
