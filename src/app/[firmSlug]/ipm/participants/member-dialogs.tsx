"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import {
  DateControl,
  FieldGrid,
  SelectControl,
  TextControl,
  TextareaControl,
} from "@/components/forms/controls"
import {
  DangerButton,
  FormMessage,
  SubmitButton,
} from "@/components/forms/form-field"
import { useActionForm } from "@/components/forms/use-action-form"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  createDependentSchema,
  createMemberSchema,
  openContributionSchema,
  terminateMemberSchema,
  updateDependentSchema,
  updateMemberSchema,
} from "@/lib/forms/ipm-schemas"
import {
  createDependent,
  createMember,
  openContribution,
  terminateMember,
  updateDependent,
  updateMember,
} from "@/server/actions/ipm"

export const MEMBER_STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Actif" },
  { value: "PENDING", label: "En attente" },
  { value: "SUSPENDED", label: "Suspendu" },
  { value: "TERMINATED", label: "Radié" },
] as const

export const GENDER_OPTIONS = [
  { value: "MALE", label: "Masculin" },
  { value: "FEMALE", label: "Féminin" },
  { value: "OTHER", label: "Autre" },
] as const

export const RELATION_OPTIONS = [
  { value: "SPOUSE_F", label: "Épouse" },
  { value: "SPOUSE_M", label: "Époux" },
  { value: "CHILD", label: "Enfant" },
  { value: "ASCENDANT", label: "Ascendant" },
  { value: "OTHER", label: "Autre" },
] as const

const DEPENDENT_STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Actif" },
  { value: "SUSPENDED", label: "Suspendu" },
  { value: "TERMINATED", label: "Radié" },
] as const

export type MemberDefaults = {
  id: string
  employerId: string
  jobTitle: string
  affiliationDate: string
  terminationDate: string
  status: string
  legacyCode: string
  person: {
    firstName: string
    lastName: string
    birthDate: string
    birthPlace: string
    gender: string
    nationalId: string
    phone: string
    email: string
    address: string
  }
}

const today = () => new Date().toISOString().slice(0, 10)

/**
 * Affiliation.
 *
 * The matricule is not a field: it is assigned by the server on the firm-wide
 * card sequence, inside the same transaction as the member row, so two people
 * affiliating at once cannot be handed the same number. Offering it as an
 * input would invite exactly the collisions the HR module spent a migration
 * recovering from.
 */
export function MemberDialog({
  firmSlug,
  employers,
  member,
  onClose,
}: {
  firmSlug: string
  employers: { id: string; name: string; planCode: string | null }[]
  member: MemberDefaults | null
  onClose: () => void
}) {
  const router = useRouter()
  const isEdit = member !== null

  const form = useForm({
    resolver: zodResolver(
      isEdit ? updateMemberSchema : createMemberSchema
    ) as never,
    defaultValues: (isEdit
      ? {
          firmSlug,
          memberId: member.id,
          employerId: member.employerId,
          jobTitle: member.jobTitle,
          affiliationDate: member.affiliationDate,
          terminationDate: member.terminationDate,
          status: member.status,
          legacyCode: member.legacyCode,
          person: member.person,
        }
      : {
          firmSlug,
          employerId: employers[0]?.id ?? "",
          person: {
            firstName: "",
            lastName: "",
            birthDate: "",
            birthPlace: "",
            gender: undefined,
            nationalId: "",
            phone: "",
            email: "",
            address: "",
          },
          jobTitle: "",
          affiliationDate: today(),
          status: "ACTIVE",
          legacyCode: "",
          monthlyContribution: "",
        }) as never,
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    (async (values: Record<string, unknown>) =>
      isEdit ? updateMember(values as never) : createMember(values as never)) as never,
    {
      success: isEdit ? "Participant modifié." : "Participant affilié.",
      onSuccess: () => {
        onClose()
        router.refresh()
      },
    }
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92svh] w-[min(720px,calc(100%-2rem))] max-w-none overflow-y-auto sm:max-w-none">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Modifier le participant" : "Affilier un participant"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Le matricule ne change pas : il est imprimé sur la carte en circulation."
              : "Le matricule est attribué automatiquement, au format de la carte."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <FieldGrid>
            <TextControl
              form={form}
              name={"person.lastName" as never}
              label="Nom"
              required
              autoFocus
            />
            <TextControl
              form={form}
              name={"person.firstName" as never}
              label="Prénom"
              required
            />
            <DateControl
              form={form}
              name={"person.birthDate" as never}
              label="Date de naissance"
            />
            <TextControl
              form={form}
              name={"person.birthPlace" as never}
              label="Lieu de naissance"
            />
            <SelectControl
              form={form}
              name={"person.gender" as never}
              label="Sexe"
              options={GENDER_OPTIONS}
            />
            <TextControl
              form={form}
              name={"person.nationalId" as never}
              label="CNI"
              mono
            />
            <TextControl form={form} name={"person.phone" as never} label="Téléphone" type="tel" />
            <TextControl form={form} name={"person.email" as never} label="Email" type="email" />
          </FieldGrid>

          <TextareaControl
            form={form}
            name={"person.address" as never}
            label="Adresse"
            rows={2}
          />

          <FieldGrid>
            <SelectControl
              form={form}
              name={"employerId" as never}
              label="Employeur"
              required
              options={employers.map((employer) => ({
                value: employer.id,
                label: employer.planCode
                  ? `${employer.name} — ${employer.planCode}`
                  : employer.name,
              }))}
            />
            <TextControl form={form} name={"jobTitle" as never} label="Fonction" />
            <DateControl
              form={form}
              name={"affiliationDate" as never}
              label="Date d'affiliation"
              required
            />
            <SelectControl
              form={form}
              name={"status" as never}
              label="Statut"
              required
              options={MEMBER_STATUS_OPTIONS}
            />
            <TextControl
              form={form}
              name={"legacyCode" as never}
              label="Matricule WebLamps"
              mono
            />
            {isEdit ? (
              <DateControl
                form={form}
                name={"terminationDate" as never}
                label="Date de radiation"
              />
            ) : (
              <TextControl
                form={form}
                name={"monthlyContribution" as never}
                label="Cotisation mensuelle (FCFA)"
              />
            )}
          </FieldGrid>

          <FormMessage tone={tone}>{message}</FormMessage>

          <DialogFooter>
            <SubmitButton pending={pending}>
              {isEdit ? "Enregistrer" : "Affilier"}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Radiation.
 *
 * Spelled out rather than offered as a delete: the participant keeps their
 * cotisation history and, from Phase 2, their bons. The dialog says what else
 * the date closes, because it closes more than the participant.
 */
export function TerminateMemberDialog({
  firmSlug,
  memberId,
  memberName,
  dependentCount,
  onClose,
}: {
  firmSlug: string
  memberId: string
  memberName: string
  dependentCount: number
  onClose: () => void
}) {
  const router = useRouter()

  const form = useForm({
    resolver: zodResolver(terminateMemberSchema) as never,
    defaultValues: {
      firmSlug,
      memberId,
      terminationDate: today(),
      reason: "",
    } as never,
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    (async (values: Record<string, unknown>) =>
      terminateMember(values as never)) as never,
    {
      success: "Participant radié.",
      onSuccess: () => {
        onClose()
        router.refresh()
      },
    }
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(520px,calc(100%-2rem))] max-w-none sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Radier {memberName}</DialogTitle>
          <DialogDescription>
            La radiation ferme la cotisation en cours à cette date — elle ne
            l&apos;efface pas —
            {dependentCount > 0
              ? ` et met fin à la couverture de ${dependentCount} ayant${dependentCount > 1 ? "s" : ""} droit.`
              : " et le participant reste consultable."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <FieldGrid>
            <DateControl
              form={form}
              name={"terminationDate" as never}
              label="Date d'effet"
              required
            />
            <TextControl form={form} name={"reason" as never} label="Motif" />
          </FieldGrid>

          <FormMessage tone={tone}>{message}</FormMessage>

          <DialogFooter>
            <DangerButton pending={pending}>Radier</DangerButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Nouvelle période de cotisation.
 *
 * There is no "edit the cotisation" — that is the point (§11 Q6). Recording a
 * new amount closes the current period on the effective date and opens
 * another, so a bon issued last January still prices against last January.
 */
export function ContributionDialog({
  firmSlug,
  memberId,
  currentAmount,
  onClose,
}: {
  firmSlug: string
  memberId: string
  currentAmount: number | null
  onClose: () => void
}) {
  const router = useRouter()

  const form = useForm({
    resolver: zodResolver(openContributionSchema) as never,
    defaultValues: {
      firmSlug,
      memberId,
      monthlyAmount: currentAmount ? String(currentAmount) : "",
      employerAmount: "",
      employeeAmount: "",
      validFrom: today(),
      reason: "",
    } as never,
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    (async (values: Record<string, unknown>) =>
      openContribution(values as never)) as never,
    {
      success: "Nouvelle cotisation enregistrée.",
      onSuccess: () => {
        onClose()
        router.refresh()
      },
    }
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(560px,calc(100%-2rem))] max-w-none sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Nouvelle cotisation</DialogTitle>
          <DialogDescription>
            La période en cours est clôturée à la date d&apos;effet et
            conservée. Rien n&apos;est écrasé.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <FieldGrid>
            <TextControl
              form={form}
              name={"monthlyAmount" as never}
              label="Cotisation mensuelle (FCFA)"
              required
              autoFocus
            />
            <DateControl
              form={form}
              name={"validFrom" as never}
              label="Prend effet le"
              required
            />
            <TextControl
              form={form}
              name={"employerAmount" as never}
              label="Part employeur"
            />
            <TextControl
              form={form}
              name={"employeeAmount" as never}
              label="Part salarié"
            />
          </FieldGrid>

          <TextControl form={form} name={"reason" as never} label="Motif" />

          <FormMessage tone={tone}>{message}</FormMessage>

          <DialogFooter>
            <SubmitButton pending={pending}>Enregistrer</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export type DependentDefaults = {
  id: string
  relation: string
  marriageDate: string
  coverageStart: string
  coverageEnd: string
  status: string
  person: {
    firstName: string
    lastName: string
    birthDate: string
    gender: string
  }
}

export function DependentDialog({
  firmSlug,
  memberId,
  dependent,
  ageMajority,
  onClose,
}: {
  firmSlug: string
  memberId: string
  dependent: DependentDefaults | null
  ageMajority: number
  onClose: () => void
}) {
  const router = useRouter()
  const isEdit = dependent !== null

  const form = useForm({
    resolver: zodResolver(
      isEdit ? updateDependentSchema : createDependentSchema
    ) as never,
    defaultValues: (isEdit
      ? {
          firmSlug,
          dependentId: dependent.id,
          relation: dependent.relation,
          marriageDate: dependent.marriageDate,
          coverageStart: dependent.coverageStart,
          coverageEnd: dependent.coverageEnd,
          status: dependent.status,
          person: dependent.person,
        }
      : {
          firmSlug,
          memberId,
          relation: "CHILD",
          marriageDate: "",
          coverageStart: today(),
          coverageEnd: "",
          person: {
            firstName: "",
            lastName: "",
            birthDate: "",
            gender: undefined,
          },
        }) as never,
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    (async (values: Record<string, unknown>) =>
      isEdit
        ? updateDependent(values as never)
        : createDependent(values as never)) as never,
    {
      success: isEdit ? "Ayant droit modifié." : "Ayant droit ajouté.",
      onSuccess: () => {
        onClose()
        router.refresh()
      },
    }
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92svh] w-[min(620px,calc(100%-2rem))] max-w-none overflow-y-auto sm:max-w-none">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Modifier l'ayant droit" : "Ajouter un ayant droit"}
          </DialogTitle>
          <DialogDescription>
            Chez cet employeur, un enfant est couvert jusqu&apos;à {ageMajority}{" "}
            ans. Sans date de naissance, aucune limite d&apos;âge ne
            s&apos;applique — et la carte devra être complétée.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <FieldGrid>
            <TextControl
              form={form}
              name={"person.lastName" as never}
              label="Nom"
              required
              autoFocus
            />
            <TextControl
              form={form}
              name={"person.firstName" as never}
              label="Prénom"
              required
            />
            <SelectControl
              form={form}
              name={"relation" as never}
              label="Lien"
              required
              options={RELATION_OPTIONS}
            />
            <DateControl
              form={form}
              name={"person.birthDate" as never}
              label="Date de naissance"
            />
            <SelectControl
              form={form}
              name={"person.gender" as never}
              label="Sexe"
              options={GENDER_OPTIONS}
            />
            <DateControl
              form={form}
              name={"marriageDate" as never}
              label="Date de mariage"
            />
            <DateControl
              form={form}
              name={"coverageStart" as never}
              label="Début de couverture"
              required
            />
            <DateControl
              form={form}
              name={"coverageEnd" as never}
              label="Fin de couverture"
            />
            {isEdit ? (
              <SelectControl
                form={form}
                name={"status" as never}
                label="Statut"
                required
                options={DEPENDENT_STATUS_OPTIONS}
              />
            ) : null}
          </FieldGrid>

          <FormMessage tone={tone}>{message}</FormMessage>

          <DialogFooter>
            <SubmitButton pending={pending}>
              {isEdit ? "Enregistrer" : "Ajouter"}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
