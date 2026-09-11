import "server-only"

import type { Prisma } from "@prisma/client"

/**
 * Matricule participant — §11 Q1.
 *
 * The card carries `01716`; WebLamps carries `001-00185-21`. Asked which is
 * canonical, the answer was the card, so that is what `Member.matricule` holds
 * and what every screen, search and QR token resolves. `Member.legacyCode`
 * keeps the WebLamps form so the two stay cross-referenceable at the counter
 * when Rokhaya reads a number off an old card.
 *
 * The employer's `matriculePrefix` scopes the sequence, so two employers cannot
 * be handed the same number — the exact defect the HR module had, where every
 * firm numbered its people `CI####` because a prefix parameter was never
 * passed. Here the prefix is a required column, not an optional argument.
 *
 * An ayant droit's matricule extends the participant's with their rank, which
 * is what makes a dependent addressable by a QR token of its own (§6) without
 * a second sequence to keep in step.
 */

/** Card format: five digits, no separator. */
export const MEMBER_MATRICULE_DIGITS = 5

export function formatMemberMatricule(
  prefix: string,
  sequence: number
): string {
  return `${prefix}${String(sequence).padStart(MEMBER_MATRICULE_DIGITS, "0")}`
}

/** `01716-02` — the participant's number, then the rank. */
export function formatDependentMatricule(
  memberMatricule: string,
  rank: number
): string {
  return `${memberMatricule}-${String(rank).padStart(2, "0")}`
}

/**
 * The WebLamps form, rebuilt from its parts. Used by the import to check that a
 * reconstructed code matches the one in the export rather than trusting either.
 */
export function formatLegacyCode(
  employerCode: string,
  sequence: number,
  yearSuffix: string
): string {
  return `${employerCode.padStart(3, "0")}-${String(sequence).padStart(5, "0")}-${yearSuffix}`
}

const LEGACY_CODE = /^(\d{3})-(\d{5})-(\d{2})$/

export function parseLegacyCode(
  code: string
): { employerCode: string; sequence: number; yearSuffix: string } | null {
  const match = LEGACY_CODE.exec(code.trim())
  if (!match) return null
  return {
    employerCode: match[1],
    sequence: Number.parseInt(match[2], 10),
    yearSuffix: match[3],
  }
}

/**
 * Next free number for an employer.
 *
 * Ordering is numeric on the suffix rather than lexicographic on the whole
 * string, so an employer holding both `0999` and a legacy `1000` still
 * advances correctly.
 */
export async function nextMemberMatricule(
  tx: Prisma.TransactionClient,
  firmId: string,
  prefix: string
): Promise<string> {
  const rows = await tx.member.findMany({
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
  const ceiling = 10 ** MEMBER_MATRICULE_DIGITS - 1
  if (next > ceiling) {
    throw new Error(
      `Le préfixe ${prefix} a atteint ${ceiling} matricules pour cet employeur.`
    )
  }

  return formatMemberMatricule(prefix, next)
}

/**
 * Generates a matricule and hands it to `write`, retrying on the unique
 * constraint so two concurrent affiliations both succeed instead of one of
 * them surfacing a raw database error.
 */
export async function withMemberMatricule<T>(
  tx: Prisma.TransactionClient,
  firmId: string,
  prefix: string,
  write: (matricule: string) => Promise<T>,
  attempts = 5
): Promise<T> {
  let taken = 0

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidate = await nextMemberMatricule(tx, firmId, prefix)
    const sequence =
      Number.parseInt(candidate.slice(prefix.length), 10) + taken
    try {
      return await write(formatMemberMatricule(prefix, sequence))
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      taken += 1
    }
  }

  throw new Error(
    "Impossible d'attribuer un matricule unique après plusieurs tentatives."
  )
}

/** Next free rank within a family — also the dependent's matricule suffix. */
export async function nextDependentRank(
  tx: Prisma.TransactionClient,
  memberId: string
): Promise<number> {
  const highest = await tx.dependent.findFirst({
    where: { memberId },
    orderBy: { rank: "desc" },
    select: { rank: true },
  })
  return (highest?.rank ?? 0) + 1
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  )
}
