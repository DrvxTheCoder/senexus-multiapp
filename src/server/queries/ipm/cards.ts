import "server-only"

import { db } from "@/lib/db"
import type { FirmContext } from "@/server/auth/require-firm-access"
import {
  cardInputsHash,
  cardState,
  type CardInputs,
  type CardState,
} from "@/server/domain/ipm/card"
import { tryResolveRate, type RateRow } from "@/server/domain/ipm/rates"

/**
 * Cartes.
 *
 * The card's content is derived, never stored: the same fields that feed the
 * renderer feed the hash, so "is this card up to date" is answered by
 * comparing a digest rather than by re-rendering an image and looking at it.
 *
 * Rates go through `tryResolveRate`, the same resolution the participant
 * record and the future settlement engine use. A category with no barème
 * comes back as `null` and is simply not printed — a card must not assert a
 * rate nobody chose.
 */

const toRateRows = (
  rows: {
    categoryId: string
    beneficiaryType: string
    rate: unknown
    ceilingPerAct: unknown
    ceilingMonthly: unknown
    ceilingAnnual: unknown
    waitingPeriodDays: number | null
  }[]
): RateRow[] =>
  rows.map((row) => ({
    categoryId: row.categoryId,
    beneficiaryType: row.beneficiaryType as RateRow["beneficiaryType"],
    rate: Number(row.rate),
    ceilingPerAct: row.ceilingPerAct === null ? null : Number(row.ceilingPerAct),
    ceilingMonthly:
      row.ceilingMonthly === null ? null : Number(row.ceilingMonthly),
    ceilingAnnual: row.ceilingAnnual === null ? null : Number(row.ceilingAnnual),
    waitingPeriodDays: row.waitingPeriodDays,
  }))

const iso = (date: Date | null) =>
  date ? new Date(date).toISOString().slice(0, 10) : null

const MEMBER_FOR_CARD = {
  id: true,
  matricule: true,
  status: true,
  person: {
    select: {
      firstName: true,
      lastName: true,
      birthDate: true,
      birthPlace: true,
      photoUrl: true,
    },
  },
  employer: {
    select: {
      planId: true,
      organization: { select: { name: true } },
      plan: { select: { name: true } },
      rates: {
        select: {
          categoryId: true,
          beneficiaryType: true,
          rate: true,
          ceilingPerAct: true,
          ceilingMonthly: true,
          ceilingAnnual: true,
          waitingPeriodDays: true,
        },
      },
    },
  },
  dependents: {
    where: { status: "ACTIVE" as const },
    orderBy: { rank: "asc" as const },
    select: {
      matricule: true,
      relation: true,
      person: {
        select: { firstName: true, lastName: true, photoUrl: true },
      },
    },
  },
  card: {
    select: { id: true, version: true, inputsHash: true, revokedAt: true, generatedAt: true },
  },
}

type MemberForCard = {
  id: string
  matricule: string
  status: string
  person: {
    firstName: string
    lastName: string
    birthDate: Date | null
    birthPlace: string | null
    photoUrl: string | null
  }
  employer: {
    planId: string | null
    organization: { name: string }
    plan: { name: string } | null
    rates: Parameters<typeof toRateRows>[0]
  }
  dependents: {
    matricule: string
    relation: string
    person: { firstName: string; lastName: string; photoUrl: string | null }
  }[]
  card: {
    id: string
    version: number
    inputsHash: string
    revokedAt: Date | null
    generatedAt: Date
  } | null
}

async function buildInputs(
  member: MemberForCard,
  categories: { id: string; code: string; label: string }[],
  planRatesByPlan: Map<string, RateRow[]>
): Promise<CardInputs> {
  const employerRates = toRateRows(member.employer.rates)
  const planRates = member.employer.planId
    ? (planRatesByPlan.get(member.employer.planId) ?? [])
    : []

  return {
    matricule: member.matricule,
    firstName: member.person.firstName,
    lastName: member.person.lastName,
    birthDate: iso(member.person.birthDate),
    birthPlace: member.person.birthPlace,
    photoUrl: member.person.photoUrl,
    employerName: member.employer.organization.name,
    planLabel: member.employer.plan?.name ?? "Barème employeur",
    rates: categories.map((category) => {
      const resolved = tryResolveRate({
        categoryId: category.id,
        categoryCode: category.code,
        beneficiaryType: "MEMBER",
        employerRates,
        planRates,
      })
      return { category: category.label, rate: resolved?.rate ?? null }
    }),
    dependents: member.dependents.map((dependent) => ({
      matricule: dependent.matricule,
      firstName: dependent.person.firstName,
      lastName: dependent.person.lastName,
      relation: dependent.relation,
      photoUrl: dependent.person.photoUrl,
    })),
  }
}

type Client = Pick<typeof db, "ipmServiceCategory" | "ipmPlanRate" | "member" | "dependent">

async function loadContext(client: Client, firmId: string) {
  const [categories, planRates] = await Promise.all([
    client.ipmServiceCategory.findMany({
      where: { firmId, active: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: { id: true, code: true, label: true },
    }),
    client.ipmPlanRate.findMany({
      where: { firmId },
      select: {
        planId: true,
        categoryId: true,
        beneficiaryType: true,
        rate: true,
        ceilingPerAct: true,
        ceilingMonthly: true,
        ceilingAnnual: true,
        waitingPeriodDays: true,
      },
    }),
  ])

  const planRatesByPlan = new Map<string, RateRow[]>()
  for (const row of planRates) {
    const list = planRatesByPlan.get(row.planId) ?? []
    list.push(...toRateRows([row]))
    planRatesByPlan.set(row.planId, list)
  }

  return { categories, planRatesByPlan }
}

/** Everything the renderer needs for one participant, plus the card's state. */
export async function cardForMember(
  ctx: FirmContext,
  memberId: string
): Promise<{
  inputs: CardInputs
  hash: string
  state: CardState
  version: number
  generatedAt: Date | null
} | null> {
  const member = (await db.member.findFirst({
    where: { id: memberId, firmId: ctx.firmId },
    select: MEMBER_FOR_CARD,
  })) as MemberForCard | null

  if (!member) return null

  const { categories, planRatesByPlan } = await loadContext(db, ctx.firmId)
  const inputs = await buildInputs(member, categories, planRatesByPlan)
  const hash = cardInputsHash(inputs)

  return {
    inputs,
    hash,
    state: cardState(member.card, hash),
    version: member.card?.version ?? 0,
    generatedAt: member.card?.generatedAt ?? null,
  }
}

export type CardRow = {
  memberId: string
  matricule: string
  firstName: string
  lastName: string
  employerName: string
  dependentCount: number
  state: CardState
  version: number
  generatedAt: Date | null
}

/**
 * The whole roster with each card's state.
 *
 * One pass over the members and one over the rates, then the hashes are
 * computed in memory — so a hundred cards cost two statements rather than a
 * hundred, and nothing is rendered to find out what is stale.
 */
export async function listCards(ctx: FirmContext): Promise<CardRow[]> {
  const [members, { categories, planRatesByPlan }] = await Promise.all([
    db.member.findMany({
      where: { firmId: ctx.firmId, status: { not: "TERMINATED" } },
      orderBy: { matricule: "asc" },
      select: MEMBER_FOR_CARD,
    }) as Promise<MemberForCard[]>,
    loadContext(db, ctx.firmId),
  ])

  return Promise.all(
    members.map(async (member) => {
      const inputs = await buildInputs(member, categories, planRatesByPlan)
      const hash = cardInputsHash(inputs)
      return {
        memberId: member.id,
        matricule: member.matricule,
        firstName: member.person.firstName,
        lastName: member.person.lastName,
        employerName: member.employer.organization.name,
        dependentCount: member.dependents.length,
        state: cardState(member.card, hash),
        version: member.card?.version ?? 0,
        generatedAt: member.card?.generatedAt ?? null,
      }
    })
  )
}

/* -------------------------------------------------------------------------- */
/* Vérification publique                                                      */

export type PublicVerification = {
  valid: boolean
  reason: string | null
  holderName: string
  matricule: string
  /** "Participant" or the relation, so the counter knows who is presenting. */
  quality: string
  employerName: string
  planLabel: string
  rates: { category: string; rate: number }[]
  dependentFirstNames: string[]
  checkedAt: Date
}

/**
 * Resolves a verification token to what is safe to show a stranger.
 *
 * This is the privacy decision the plan leaves open. §6 lists "validité, nom,
 * photo, ayants droit actifs, taux" on the public page, and two paragraphs
 * earlier requires that the photo, the date of birth and the matricule be
 * served only through an authenticated route. Both cannot hold.
 *
 * Resolved in favour of the security rule, because the page is public and
 * unauthenticated by design:
 *
 *   - **no photo, no date of birth, no address** — a face and a birth date on
 *     an open URL is an identity kit, and nothing about verification needs it;
 *   - the name and the matricule are shown, because the pharmacist is holding
 *     a card carrying both and verification means comparing them;
 *   - ayants droit appear as **first names only**, enough to confirm that the
 *     child in front of the counter is on the card, not enough to enumerate a
 *     family from a scanned QR.
 *
 * This is a decision the institution can reverse; it should not be reversed by
 * accident.
 */
export async function verifyBeneficiary(
  kind: "member" | "dependent",
  id: string,
  now: Date = new Date()
): Promise<PublicVerification | null> {
  const memberId =
    kind === "member"
      ? id
      : ((
          await db.dependent.findUnique({
            where: { id },
            select: { memberId: true },
          })
        )?.memberId ?? null)

  if (!memberId) return null

  const member = (await db.member.findUnique({
    where: { id: memberId },
    select: { ...MEMBER_FOR_CARD, firmId: true },
  })) as (MemberForCard & { firmId: string }) | null

  if (!member) return null

  const { categories, planRatesByPlan } = await loadContext(db, member.firmId)
  const inputs = await buildInputs(member, categories, planRatesByPlan)

  const dependent =
    kind === "dependent"
      ? await db.dependent.findUnique({
          where: { id },
          select: {
            status: true,
            relation: true,
            coverageStart: true,
            coverageEnd: true,
            person: { select: { firstName: true, lastName: true } },
          },
        })
      : null

  let valid = member.status === "ACTIVE"
  let reason = valid ? null : "Participant non actif."

  if (valid && member.card?.revokedAt) {
    valid = false
    reason = "Carte révoquée."
  }

  if (valid && dependent) {
    if (dependent.status !== "ACTIVE") {
      valid = false
      reason = "Ayant droit non actif."
    } else if (now < dependent.coverageStart) {
      valid = false
      reason = "La couverture n'a pas encore commencé."
    } else if (dependent.coverageEnd && now > dependent.coverageEnd) {
      valid = false
      reason = "La couverture est terminée."
    }
  }

  return {
    valid,
    reason,
    holderName: dependent
      ? `${dependent.person.lastName.toUpperCase()} ${dependent.person.firstName}`
      : `${inputs.lastName.toUpperCase()} ${inputs.firstName}`,
    matricule: inputs.matricule,
    quality: dependent ? dependent.relation : "MEMBER",
    employerName: inputs.employerName,
    planLabel: inputs.planLabel,
    rates: inputs.rates
      .filter((rate): rate is { category: string; rate: number } =>
        rate.rate !== null
      )
      .map((rate) => ({ category: rate.category, rate: rate.rate })),
    dependentFirstNames: inputs.dependents.map(
      (entry) => entry.firstName
    ),
    checkedAt: now,
  }
}

/**
 * The digest of what a card would print, computed inside a caller's
 * transaction.
 *
 * The write layer needs this so the hash it records is derived from the same
 * rows the write just touched — computing it outside the transaction would
 * leave a window in which a card is recorded as matching data that has since
 * moved. It shares `buildInputs` with the renderer, which is what makes "up to
 * date" a claim about the actual image rather than about a parallel guess.
 */
export async function cardSnapshot(
  client: Client,
  firmId: string,
  memberId: string
): Promise<{ inputs: CardInputs; hash: string } | null> {
  const member = (await client.member.findFirst({
    where: { id: memberId, firmId },
    select: MEMBER_FOR_CARD,
  })) as MemberForCard | null

  if (!member) return null

  const { categories, planRatesByPlan } = await loadContext(client, firmId)
  const inputs = await buildInputs(member, categories, planRatesByPlan)
  return { inputs, hash: cardInputsHash(inputs) }
}
