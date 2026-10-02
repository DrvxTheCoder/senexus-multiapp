import type { IpmBeneficiaryType } from "@prisma/client"

/**
 * Résolution du taux de prise en charge — plan §5.
 *
 * Four candidates, tried in order, and **no default at the end**:
 *
 *   1. EmployerRate for this employer, category and beneficiary type
 *   2. EmployerRate for this employer and category (`ALL`)
 *   3. PlanRate of the subscribed formule, for this beneficiary type
 *   4. PlanRate of the subscribed formule (`ALL`)
 *
 * A miss throws. That is the point: WebLamps carries `tauxprise = 0` on all
 * 101 providers and settles anyway, so a silent fallback is how a voucher ends
 * up priced at a rate nobody chose. Refusing loudly is the only behaviour that
 * cannot quietly cost money.
 *
 * **Ceilings resolve field by field**, most specific first, and are not tied
 * to the row the taux came from:
 *
 *   participant (IpmMemberCeiling) > employer, exact type > employer, ALL
 *     > formule, exact type > formule, ALL
 *
 * A null at any level means "inherit from the next one", never "no ceiling" —
 * the same rule `waitingPeriodDays` already followed. So an employer that
 * negotiates only its taux keeps the formule's plafonds, and a participant
 * granted a higher monthly plafond keeps the annual one everybody else has.
 * Each resolved ceiling says where it came from, so a screen can say so.
 *
 * This is the one implementation: issuance (`gatherIssuanceFacts`), the review
 * threshold, the back office and the portal snapshot all call it.
 *
 * No database here — the caller loads the rate sets once and resolves in
 * memory, because a voucher screen resolves many lines against the same sets.
 */

/** Raised when no rate covers a category. Carries what was looked for. */
export class RateNotFoundError extends Error {
  readonly categoryCode: string
  readonly beneficiaryType: IpmBeneficiaryType

  constructor(categoryCode: string, beneficiaryType: IpmBeneficiaryType) {
    super(
      `Aucun barème ne couvre la catégorie ${categoryCode} pour ce bénéficiaire.`
    )
    this.name = "RateNotFoundError"
    this.categoryCode = categoryCode
    this.beneficiaryType = beneficiaryType
  }
}

/** Where a resolved rate came from. Shown in the interface, never inferred. */
export type RateSource = "EMPLOYER" | "PLAN"

/** Where a resolved ceiling came from. `MEMBER` is a plafond particulier. */
export type CeilingSource = "MEMBER" | "EMPLOYER" | "PLAN"

/** A participant's plafonds particuliers in one category, already filtered to the date. */
export type MemberCeilingRow = {
  categoryId: string
  ceilingPerAct: number | null
  ceilingMonthly: number | null
  ceilingAnnual: number | null
}

export type CeilingSources = {
  perAct: CeilingSource | null
  monthly: CeilingSource | null
  annual: CeilingSource | null
}

export type RateRow = {
  categoryId: string
  beneficiaryType: IpmBeneficiaryType
  /** Fraction, not percentage — see IpmPlanRate.rate. */
  rate: number
  ceilingPerAct: number | null
  ceilingMonthly: number | null
  ceilingAnnual: number | null
  waitingPeriodDays: number | null
}

export type ResolvedRate = {
  rate: number
  source: RateSource
  /** `ALL` when the match was the catch-all rather than the exact type. */
  matchedOn: IpmBeneficiaryType
  ceilingPerAct: number | null
  ceilingMonthly: number | null
  ceilingAnnual: number | null
  /** Where each ceiling came from; null when no level sets it. */
  ceilingSource: CeilingSources
  waitingPeriodDays: number
}

type CeilingField = "ceilingPerAct" | "ceilingMonthly" | "ceilingAnnual"

function pick(
  rows: readonly RateRow[],
  categoryId: string,
  beneficiaryType: IpmBeneficiaryType
): RateRow | undefined {
  return rows.find(
    (row) =>
      row.categoryId === categoryId && row.beneficiaryType === beneficiaryType
  )
}

/**
 * An employer dérogation may leave `waitingPeriodDays` unset, meaning "keep the
 * formule's". Resolution therefore falls back to the plan row for that one
 * field rather than silently treating absent as zero — a zero carence would
 * admit a second pair of glasses the day after the first.
 */
export function resolveRate(args: {
  categoryId: string
  categoryCode: string
  beneficiaryType: IpmBeneficiaryType
  employerRates: readonly RateRow[]
  planRates: readonly RateRow[]
  /** The participant's plafonds particuliers in force on the date. Optional. */
  memberCeilings?: readonly MemberCeilingRow[]
}): ResolvedRate {
  const { categoryId, categoryCode, beneficiaryType, employerRates, planRates } =
    args

  const planExact = pick(planRates, categoryId, beneficiaryType)
  const planAll = pick(planRates, categoryId, "ALL")
  const planFallback = planExact ?? planAll

  const candidates: Array<{ row: RateRow | undefined; source: RateSource }> = [
    { row: pick(employerRates, categoryId, beneficiaryType), source: "EMPLOYER" },
    { row: pick(employerRates, categoryId, "ALL"), source: "EMPLOYER" },
    { row: planExact, source: "PLAN" },
    { row: planAll, source: "PLAN" },
  ]

  const member = args.memberCeilings?.find((row) => row.categoryId === categoryId)

  // Most specific first. The taux candidates above, with the participant's
  // plafonds in front of them — ceilings only, a participant has no taux.
  function ceiling(field: CeilingField): [number | null, CeilingSource | null] {
    if (member && member[field] !== null) return [member[field], "MEMBER"]
    for (const candidate of candidates) {
      const value = candidate.row?.[field]
      if (value !== null && value !== undefined) return [value, candidate.source]
    }
    return [null, null]
  }

  for (const candidate of candidates) {
    if (!candidate.row) continue
    const row = candidate.row
    const [perAct, perActSource] = ceiling("ceilingPerAct")
    const [monthly, monthlySource] = ceiling("ceilingMonthly")
    const [annual, annualSource] = ceiling("ceilingAnnual")
    return {
      rate: row.rate,
      source: candidate.source,
      matchedOn: row.beneficiaryType,
      ceilingPerAct: perAct,
      ceilingMonthly: monthly,
      ceilingAnnual: annual,
      ceilingSource: {
        perAct: perActSource,
        monthly: monthlySource,
        annual: annualSource,
      },
      waitingPeriodDays:
        row.waitingPeriodDays ?? planFallback?.waitingPeriodDays ?? 0,
    }
  }

  throw new RateNotFoundError(categoryCode, beneficiaryType)
}

/** Non-throwing form, for screens that show "non couvert" rather than failing. */
export function tryResolveRate(
  args: Parameters<typeof resolveRate>[0]
): ResolvedRate | null {
  try {
    return resolveRate(args)
  } catch (error) {
    if (error instanceof RateNotFoundError) return null
    throw error
  }
}

/* -------------------------------------------------------------------------- */
/* Presentation                                                               */

/**
 * The column holds a fraction; every interface shows a percentage. Both
 * conversions live here so no screen writes `rate * 100` inline and no form
 * writes `90` into the column.
 */
export function toPercent(rate: number): number {
  return Math.round(rate * 1000) / 10
}

export function fromPercent(percent: number): number {
  return Math.round(percent * 100) / 10000
}

export function formatRate(rate: number): string {
  const percent = toPercent(rate)
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)} %`
}
