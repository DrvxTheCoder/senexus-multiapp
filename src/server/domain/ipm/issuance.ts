import {
  CEILING_LABELS,
  checkCeilings,
  contributionStanding,
  split,
  waitingPeriodElapsed,
  type Ceilings,
  type ConsumedSoFar,
  type Split,
} from "@/server/domain/ipm/settlement"
import {
  isDependentCovered,
  type DependentCoverageInput,
} from "@/server/domain/ipm/coverage"

/**
 * Contrôles à l'émission d'un bon — plan §5.
 *
 * Seven checks, and the point of this file is that **every refusal is
 * motivated**. WebLamps answers OK/KO and leaves the counter to guess whether
 * the participant is suspended, the child has aged out, the carence has not
 * run or the plafond is reached — four different problems with four different
 * remedies, none of which the operator can tell apart.
 *
 * Every refusal here carries a code, a sentence, and where relevant a number:
 * how much is left under the ceiling, what date the carence runs to. That is
 * what turns a refusal into something the person at the desk can act on.
 *
 * Pure: the caller loads the facts, this decides. That makes the whole rule
 * set testable without a database, which is the only way a rule set this size
 * stays trustworthy.
 */

export type RefusalCode =
  | "MEMBER_NOT_ACTIVE"
  | "MEMBER_TERMINATED"
  | "DEPENDENT_NOT_COVERED"
  | "CONTRIBUTIONS_SUSPENDED"
  | "WAITING_PERIOD"
  | "CEILING_REACHED"
  | "PROVIDER_NOT_ACCREDITED"
  | "PROVIDER_INACTIVE"
  | "NO_RATE"

export type Refusal = {
  code: RefusalCode
  message: string
  /** Set when the refusal has a figure attached — remaining, or a date. */
  detail?: { remaining?: number; nextEligibleOn?: Date; daysBehind?: number }
}

export type Warning = {
  code: "CONTRIBUTIONS_LATE" | "AGREEMENT_EXPIRED"
  message: string
}

export type IssuanceFacts = {
  on: Date
  memberStatus: "PENDING" | "ACTIVE" | "SUSPENDED" | "TERMINATED"
  /** Absent when the participant themselves is the beneficiary. */
  dependent: DependentCoverageInput | null
  /** From the employer's agreement. */
  reminderDelayDays: number
  suspensionDelayDays: number
  /** Last month the family's cotisation is settled through. Null = unknown. */
  contributionsPaidThrough: Date | null
  provider: {
    accredited: boolean
    status: "ACTIVE" | "SUSPENDED" | "TERMINATED"
    /** True when a convention is in force on `on`. */
    hasLiveAgreement: boolean
  }
  /** Resolved rate, or null when no barème covers the category. */
  rate: number | null
  totalAmount: number
  ceilings: Ceilings
  consumed: ConsumedSoFar
  waitingPeriodDays: number
  /** Last bon issued in the same category for the same beneficiary. */
  lastIssuedInCategory: Date | null
}

export type IssuanceDecision =
  | { allowed: true; split: Split; warnings: Warning[] }
  | { allowed: false; refusals: Refusal[]; warnings: Warning[] }

const money = (value: number) =>
  `${new Intl.NumberFormat("fr-FR").format(value)} FCFA`

const day = (value: Date) =>
  value.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })

/**
 * Runs every check and returns **all** the reasons, not the first.
 *
 * Stopping at the first refusal is the behaviour that makes a counter iterate:
 * fix the cotisation, resubmit, discover the carence, fix that, discover the
 * plafond. One pass, every reason.
 */
export function decideIssuance(facts: IssuanceFacts): IssuanceDecision {
  const refusals: Refusal[] = []
  const warnings: Warning[] = []

  /* -- participant -------------------------------------------------------- */

  if (facts.memberStatus === "TERMINATED") {
    refusals.push({
      code: "MEMBER_TERMINATED",
      message: "Le participant est radié.",
    })
  } else if (facts.memberStatus !== "ACTIVE") {
    refusals.push({
      code: "MEMBER_NOT_ACTIVE",
      message:
        facts.memberStatus === "SUSPENDED"
          ? "Le participant est suspendu."
          : "L'affiliation du participant n'est pas encore active.",
    })
  }

  /* -- ayant droit -------------------------------------------------------- */

  if (facts.dependent) {
    const coverage = isDependentCovered(facts.dependent, facts.on)
    if (!coverage.covered) {
      refusals.push({
        code: "DEPENDENT_NOT_COVERED",
        message: coverage.message,
      })
    }
  }

  /* -- cotisations -------------------------------------------------------- */

  const standing = contributionStanding(
    facts.contributionsPaidThrough,
    facts.reminderDelayDays,
    facts.suspensionDelayDays,
    facts.on
  )

  if (standing.state === "SUSPENDED") {
    refusals.push({
      code: "CONTRIBUTIONS_SUSPENDED",
      message: `Cotisations en retard de ${standing.daysBehind} jours, au-delà du délai de suspension de ${facts.suspensionDelayDays} jours.`,
      detail: { daysBehind: standing.daysBehind },
    })
  } else if (standing.state === "REMINDER") {
    warnings.push({
      code: "CONTRIBUTIONS_LATE",
      message: `Cotisations en retard de ${standing.daysBehind} jours. Relance à prévoir.`,
    })
  }

  /* -- prestataire -------------------------------------------------------- */

  if (facts.provider.status !== "ACTIVE") {
    refusals.push({
      code: "PROVIDER_INACTIVE",
      message: "Le prestataire n'est pas actif.",
    })
  }

  if (!facts.provider.accredited) {
    refusals.push({
      code: "PROVIDER_NOT_ACCREDITED",
      message: "Le prestataire n'est pas agréé pour le tiers payant.",
    })
  } else if (!facts.provider.hasLiveAgreement) {
    // Accredited but with no convention in force is a warning rather than a
    // refusal: the 101 legacy providers have no agreement dates at all, so
    // refusing on that alone would block every bon on day one.
    warnings.push({
      code: "AGREEMENT_EXPIRED",
      message: "Aucune convention en cours pour ce prestataire.",
    })
  }

  /* -- barème ------------------------------------------------------------- */

  if (facts.rate === null) {
    refusals.push({
      code: "NO_RATE",
      message:
        "Aucun barème ne couvre cette catégorie : le montant pris en charge ne peut pas être calculé.",
    })
  }

  /* -- carence ------------------------------------------------------------ */

  const carence = waitingPeriodElapsed(
    facts.lastIssuedInCategory,
    facts.waitingPeriodDays,
    facts.on
  )
  if (!carence.elapsed) {
    refusals.push({
      code: "WAITING_PERIOD",
      message: `Délai de carence non écoulé : prochaine prise en charge possible le ${day(carence.nextEligibleOn)}.`,
      detail: { nextEligibleOn: carence.nextEligibleOn },
    })
  }

  /* -- plafonds ----------------------------------------------------------- */

  // Computed even when the rate is missing would throw, so this is guarded.
  let computed: Split | null = null
  if (facts.rate !== null) {
    computed = split(facts.totalAmount, facts.rate)

    const breach = checkCeilings(
      computed.insurerShare,
      facts.ceilings,
      facts.consumed
    )
    if (breach) {
      refusals.push({
        code: "CEILING_REACHED",
        message:
          breach.remaining > 0
            ? `${CEILING_LABELS[breach.kind]} atteint : il reste ${money(breach.remaining)} de prise en charge.`
            : `${CEILING_LABELS[breach.kind]} épuisé.`,
        detail: { remaining: breach.remaining },
      })
    }
  }

  if (refusals.length > 0 || !computed) {
    return { allowed: false, refusals, warnings }
  }

  return { allowed: true, split: computed, warnings }
}

/* ==========================================================================
 * Numérotation
 * ========================================================================== */

/** BPI pharmacie · BCI optique · LGI lettre de garantie · LHI hospitalisation. */
export const VOUCHER_PREFIX = {
  PHARMACY: "BPI",
  OPTICAL: "BCI",
  GUARANTEE: "LGI",
  HOSPITALIZATION: "LHI",
} as const

export type VoucherType = keyof typeof VOUCHER_PREFIX

/**
 * Where each series must start so it never collides with a document already in
 * circulation (plan §4.6). These are the observed maxima in the legacy export;
 * the sequence is seeded above them.
 */
export const LEGACY_MAXIMA: Record<VoucherType, number> = {
  PHARMACY: 5_430,
  OPTICAL: 0,
  GUARANTEE: 9_310,
  HOSPITALIZATION: 0,
}

export function formatVoucherNumber(type: VoucherType, sequence: number): string {
  return `${VOUCHER_PREFIX[type]}${String(sequence).padStart(6, "0")}`
}

export function parseVoucherNumber(
  value: string
): { type: VoucherType; sequence: number } | null {
  const match = /^([A-Z]{3})(\d{6})$/.exec(value.trim().toUpperCase())
  if (!match) return null
  const entry = (Object.entries(VOUCHER_PREFIX) as [VoucherType, string][]).find(
    ([, prefix]) => prefix === match[1]
  )
  return entry ? { type: entry[0], sequence: Number.parseInt(match[2], 10) } : null
}

/** A bon is valid for a month unless the type says otherwise. */
export const VOUCHER_VALIDITY_DAYS: Record<VoucherType, number> = {
  PHARMACY: 30,
  OPTICAL: 60,
  // A guarantee or hospitalisation letter covers an episode that is scheduled,
  // so it runs longer than a prescription to be filled.
  GUARANTEE: 90,
  HOSPITALIZATION: 90,
}

export function expiryFor(type: VoucherType, issueDate: Date): Date {
  const expiry = new Date(issueDate)
  expiry.setDate(expiry.getDate() + VOUCHER_VALIDITY_DAYS[type])
  return expiry
}
