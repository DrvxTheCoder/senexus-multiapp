import "server-only"

import type { Prisma } from "@prisma/client"

import { normalisePhone } from "@/server/portal/token"

type Tx = Prisma.TransactionClient

/**
 * Accès au portail — the gestionnaire opening a participant's login.
 *
 * Only the participant gets one: an ayant droit has no account of their own,
 * they are reached through the participant's. The login is the phone number on
 * the participant's identity, in the national form the portal's session
 * endpoint compares against (9 digits). The account starts INVITED and becomes
 * ACTIVE on the first successful code — see `openSession`.
 *
 * One function for one participant and for three hundred: each is either
 * granted or skipped with the reason in words, so the bulk dialog can name
 * every participant it left out and the fiche can say why its button failed.
 */

export type PortalSkipReason =
  | "ALREADY_INVITED"
  | "ALREADY_ACTIVE"
  | "LOCKED"
  | "NOT_ACTIVE"
  | "NO_PHONE"
  | "INVALID_PHONE"
  | "PHONE_TAKEN"
  | "PHONE_SHARED"

export type PortalGrantSkip = {
  memberId: string
  name: string
  matricule: string
  reason: PortalSkipReason
  /** Words for the reason, with the other participant named when there is one. */
  detail: string
}

export type PortalGrantResult = {
  granted: { memberId: string; name: string; matricule: string }[]
  skipped: PortalGrantSkip[]
}

const ACCOUNT_SKIP: Record<
  string,
  { reason: PortalSkipReason; detail: string }
> = {
  INVITED: { reason: "ALREADY_INVITED", detail: "Accès déjà ouvert (invité)." },
  ACTIVE: { reason: "ALREADY_ACTIVE", detail: "Accès déjà ouvert (actif)." },
  LOCKED: {
    reason: "LOCKED",
    detail: "Accès suspendu : rétablissez-le depuis sa fiche.",
  },
}

const displayName = (person: { firstName: string; lastName: string }) =>
  `${person.lastName.toUpperCase()} ${person.firstName}`

export async function grantPortalAccess(
  tx: Tx,
  firmId: string,
  memberIds: string[]
): Promise<PortalGrantResult> {
  const members = await tx.member.findMany({
    where: { id: { in: memberIds }, firmId },
    select: {
      id: true,
      matricule: true,
      status: true,
      person: { select: { firstName: true, lastName: true, phone: true } },
      portalAccount: { select: { status: true } },
    },
    orderBy: { matricule: "asc" },
  })

  const granted: PortalGrantResult["granted"] = []
  const skipped: PortalGrantSkip[] = []
  const skip = (
    member: (typeof members)[number],
    reason: PortalSkipReason,
    detail: string
  ) =>
    skipped.push({
      memberId: member.id,
      name: displayName(member.person),
      matricule: member.matricule,
      reason,
      detail,
    })

  // First pass: everything decidable from the participant alone.
  const candidates: { member: (typeof members)[number]; phone: string }[] = []
  for (const member of members) {
    if (member.portalAccount) {
      const { reason, detail } = ACCOUNT_SKIP[member.portalAccount.status]
      skip(member, reason, detail)
      continue
    }
    if (member.status !== "ACTIVE") {
      skip(member, "NOT_ACTIVE", "Participant non actif.")
      continue
    }
    if (!member.person.phone?.trim()) {
      skip(member, "NO_PHONE", "Aucun numéro de téléphone sur sa fiche.")
      continue
    }
    const phone = normalisePhone(member.person.phone)
    if (!/^\d{9}$/.test(phone)) {
      skip(
        member,
        "INVALID_PHONE",
        `Numéro invalide (${member.person.phone}) : 9 chiffres attendus.`
      )
      continue
    }
    candidates.push({ member, phone })
  }

  // The phone is the login, so it identifies one participant per IPM. A number
  // already held by another participant's account stays with them.
  const taken = await tx.portalAccount.findMany({
    where: { firmId, phone: { in: candidates.map((entry) => entry.phone) } },
    select: {
      phone: true,
      member: {
        select: {
          matricule: true,
          person: { select: { firstName: true, lastName: true } },
        },
      },
    },
  })
  const holder = new Map(
    taken.map((account) => [account.phone, account.member])
  )

  // Two participants of the same batch with one number: neither gets it, since
  // nothing here says whose it is. The gestionnaire fixes a fiche and retries.
  const byPhone = new Map<string, typeof candidates>()
  for (const entry of candidates) {
    byPhone.set(entry.phone, [...(byPhone.get(entry.phone) ?? []), entry])
  }

  const toCreate: { member: (typeof members)[number]; phone: string }[] = []
  for (const entry of candidates) {
    const owner = holder.get(entry.phone)
    if (owner) {
      skip(
        entry.member,
        "PHONE_TAKEN",
        `Numéro déjà utilisé par ${displayName(owner.person)} (${owner.matricule}).`
      )
      continue
    }
    const sharing = byPhone.get(entry.phone)!.filter((other) => other !== entry)
    if (sharing.length > 0) {
      skip(
        entry.member,
        "PHONE_SHARED",
        `Même numéro que ${sharing
          .map(
            (other) =>
              `${displayName(other.member.person)} (${other.member.matricule})`
          )
          .join(", ")}.`
      )
      continue
    }
    toCreate.push(entry)
  }

  if (toCreate.length > 0) {
    await tx.portalAccount.createMany({
      data: toCreate.map(({ member, phone }) => ({
        firmId,
        memberId: member.id,
        phone,
        status: "INVITED" as const,
      })),
    })
  }
  for (const { member } of toCreate) {
    granted.push({
      memberId: member.id,
      name: displayName(member.person),
      matricule: member.matricule,
    })
  }

  return { granted, skipped }
}

/**
 * Keeps the portal login on the participant's phone. Called when the fiche's
 * phone changes: the number is the login, and with the SMS code it is where
 * the code goes, so an account left on the old number would lock its
 * participant out — or send their codes to whoever has the number now.
 *
 * Refuses the change, rather than silently leaving the login behind, when the
 * participant has an account and the new number cannot be a login. Returns
 * the field error to show, or null when the change may go through.
 */
export async function syncPortalPhone(
  tx: Tx,
  firmId: string,
  personId: string,
  rawPhone: string | null
): Promise<string | null> {
  const accounts = await tx.portalAccount.findMany({
    where: { firmId, member: { personId } },
    select: { id: true, phone: true },
  })
  if (accounts.length === 0) return null

  if (!rawPhone?.trim()) {
    return "Ce participant a un accès au portail : son numéro est son identifiant, il ne peut pas être vide."
  }
  const phone = normalisePhone(rawPhone)
  if (!/^\d{9}$/.test(phone)) {
    return "Numéro invalide : 9 chiffres attendus, c'est l'identifiant du portail."
  }

  const holder = await tx.portalAccount.findFirst({
    where: {
      firmId,
      phone,
      id: { notIn: accounts.map((account) => account.id) },
    },
    select: {
      member: {
        select: {
          matricule: true,
          person: { select: { firstName: true, lastName: true } },
        },
      },
    },
  })
  if (holder) {
    return `Numéro déjà utilisé pour le portail par ${displayName(holder.member.person)} (${holder.member.matricule}).`
  }

  await tx.portalAccount.updateMany({
    where: {
      id: { in: accounts.map((account) => account.id) },
      phone: { not: phone },
    },
    data: { phone },
  })
  return null
}
