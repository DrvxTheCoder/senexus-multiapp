import type {
  IpmBeneficiaryType,
  IpmDependentRelation,
  IpmMemberStatus,
} from "@prisma/client"

/**
 * Qui est couvert, et jusqu'à quand — plan §4.2 and §5.
 *
 * The checks a voucher runs at issue time (participant actif, ayant droit dans
 * sa période, enfant sous l'âge de majorité) are the same ones the affiliation
 * screens need in order to show an honest status, so they live here rather
 * than inside Phase 2's engine. Each refusal carries a reason: WebLamps
 * answers OK/KO and leaves the counter guessing why.
 */

/**
 * WebLamps `codebenef`. The participant themselves carries 1; `lienjuridique`
 * is deliberately unused — 229 legal forms for 95 real spouses means the field
 * is corrupt, and the relation is derived from `codebenef` instead.
 */
export const LEGACY_RELATION_CODES: Record<IpmDependentRelation, number> = {
  SPOUSE_F: 2,
  CHILD: 3,
  SPOUSE_M: 4,
  ASCENDANT: 5,
  OTHER: 6,
}

export const MEMBER_LEGACY_CODE = 1

export function relationFromLegacyCode(
  code: number
): IpmDependentRelation | null {
  const entry = Object.entries(LEGACY_RELATION_CODES).find(
    ([, value]) => value === code
  )
  return entry ? (entry[0] as IpmDependentRelation) : null
}

/** A dependent's relation is also the beneficiary type a barème matches on. */
export function beneficiaryTypeFor(
  relation: IpmDependentRelation
): IpmBeneficiaryType {
  return relation as unknown as IpmBeneficiaryType
}

export const RELATION_LABELS: Record<IpmDependentRelation, string> = {
  SPOUSE_F: "Épouse",
  SPOUSE_M: "Époux",
  CHILD: "Enfant",
  ASCENDANT: "Ascendant",
  OTHER: "Autre",
}

/* -------------------------------------------------------------------------- */
/* Âge                                                                        */

/**
 * Completed years at `on`. Month and day are compared explicitly rather than
 * dividing a millisecond difference by 365.25, which drifts by a day around
 * leap years — and a child who ages out a day early loses cover a day early.
 */
export function ageOn(birthDate: Date, on: Date): number {
  let age = on.getFullYear() - birthDate.getFullYear()
  const monthDelta = on.getMonth() - birthDate.getMonth()
  if (monthDelta < 0 || (monthDelta === 0 && on.getDate() < birthDate.getDate())) {
    age -= 1
  }
  return age
}

/* -------------------------------------------------------------------------- */
/* Couverture                                                                 */

export type CoverageRefusal =
  | "MEMBER_NOT_ACTIVE"
  | "COVERAGE_NOT_STARTED"
  | "COVERAGE_ENDED"
  | "DEPENDENT_NOT_ACTIVE"
  | "AGE_LIMIT_REACHED"

export const REFUSAL_MESSAGES: Record<CoverageRefusal, string> = {
  MEMBER_NOT_ACTIVE: "Le participant n'est pas actif.",
  COVERAGE_NOT_STARTED: "La couverture n'a pas encore commencé.",
  COVERAGE_ENDED: "La couverture est terminée.",
  DEPENDENT_NOT_ACTIVE: "L'ayant droit n'est pas actif.",
  AGE_LIMIT_REACHED: "L'ayant droit a dépassé l'âge de majorité.",
}

export type CoverageResult =
  | { covered: true }
  | { covered: false; reason: CoverageRefusal; message: string }

function refuse(reason: CoverageRefusal): CoverageResult {
  return { covered: false, reason, message: REFUSAL_MESSAGES[reason] }
}

export type DependentCoverageInput = {
  memberStatus: IpmMemberStatus
  relation: IpmDependentRelation
  dependentStatus: "ACTIVE" | "SUSPENDED" | "TERMINATED"
  coverageStart: Date
  coverageEnd: Date | null
  birthDate: Date | null
  /** From the employer: 21 or 22, per the agreement. */
  ageMajority: number
}

/**
 * Whether an ayant droit is covered on a given date.
 *
 * The age limit applies to children only. An ascendant has no upper bound, and
 * a spouse is bounded by `coverageEnd` (a divorce closes the window) rather
 * than by age — applying the majority rule to everyone would cut off every
 * parent on the list.
 *
 * A dependent with no recorded birth date is **not** aged out. The date is
 * missing in the legacy export for part of the population, and refusing cover
 * on the strength of an absent field would deny real people at the counter;
 * the import reports them instead so they can be completed.
 */
export function isDependentCovered(
  input: DependentCoverageInput,
  on: Date
): CoverageResult {
  if (input.memberStatus !== "ACTIVE") return refuse("MEMBER_NOT_ACTIVE")
  if (input.dependentStatus !== "ACTIVE") return refuse("DEPENDENT_NOT_ACTIVE")
  if (on < input.coverageStart) return refuse("COVERAGE_NOT_STARTED")
  if (input.coverageEnd && on > input.coverageEnd) return refuse("COVERAGE_ENDED")

  if (input.relation === "CHILD" && input.birthDate) {
    if (ageOn(input.birthDate, on) >= input.ageMajority) {
      return refuse("AGE_LIMIT_REACHED")
    }
  }

  return { covered: true }
}

/**
 * The date a child ages out, so a list can show it before it happens and the
 * card regeneration counter can pick it up. Null when it does not apply.
 */
export function majorityDate(
  relation: IpmDependentRelation,
  birthDate: Date | null,
  ageMajority: number
): Date | null {
  if (relation !== "CHILD" || !birthDate) return null
  const date = new Date(birthDate)
  date.setFullYear(date.getFullYear() + ageMajority)
  return date
}
