"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { HugeiconsIcon } from "@hugeicons/react"
import { PlusSignIcon } from "@hugeicons/core-free-icons"

import { FieldGrid, SelectControl, TextControl } from "@/components/forms/controls"
import { FormMessage, SubmitButton } from "@/components/forms/form-field"
import { useActionForm } from "@/components/forms/use-action-form"
import { Panel } from "@/components/panel"
import { EmptyState, StatusPill, TagCode } from "@/components/primitives"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatNumber } from "@/lib/format"
import {
  createCategorySchema,
  createServiceTypeSchema,
  createSpecialtySchema,
} from "@/lib/forms/ipm-schemas"
import {
  createCategory,
  createServiceType,
  createSpecialty,
} from "@/server/actions/ipm"

export type CategoryEntry = {
  id: string
  code: string
  label: string
  sortOrder: number
  active: boolean
  serviceTypeCount: number
}

export type ServiceTypeEntry = {
  id: string
  code: string
  label: string
  categoryLabel: string
  accountCode: string | null
}

export type SpecialtyEntry = {
  id: string
  code: string
  label: string
  accountCode: string | null
}

/**
 * Référentiel.
 *
 * Catégories de soins are rows here rather than an enum in the schema, which
 * is the whole reason this screen exists (§11 Q3): asked whether accouchement
 * should be priced separately, the answer was that plan options must stay
 * configurable. Adding MATERNITE is a form, not a deploy.
 */
export function ReferentielView({
  firmSlug,
  categories,
  serviceTypes,
  specialties,
  canWrite,
}: {
  firmSlug: string
  categories: CategoryEntry[]
  serviceTypes: ServiceTypeEntry[]
  specialties: SpecialtyEntry[]
  canWrite: boolean
}) {
  const [dialog, setDialog] = React.useState<
    "category" | "serviceType" | "specialty" | null
  >(null)

  return (
    <div className="space-y-3.5">
      <Panel
        title="Catégories de soins"
        description="Chaque barème se déclare par catégorie. En ajouter une est une saisie, pas une migration."
        padded={false}
        tools={
          canWrite ? (
            <AddButton onClick={() => setDialog("category")}>
              Nouvelle catégorie
            </AddButton>
          ) : null
        }
      >
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-y border-line bg-sub text-left text-[11.5px] text-ink-3">
              <th className="px-[15px] py-2 font-medium">Code</th>
              <th className="px-[15px] py-2 font-medium">Libellé</th>
              <th className="px-[15px] py-2 font-medium">Prestations</th>
              <th className="px-[15px] py-2 font-medium">Statut</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr key={category.id} className="border-b border-line">
                <td className="px-[15px] py-2.5">
                  <TagCode>{category.code}</TagCode>
                </td>
                <td className="px-[15px] py-2.5">{category.label}</td>
                <td className="px-[15px] py-2.5 tabular-nums text-ink-3">
                  {formatNumber(category.serviceTypeCount)}
                </td>
                <td className="px-[15px] py-2.5">
                  <StatusPill tone={category.active ? "ok" : "muted"}>
                    {category.active ? "Active" : "Inactive"}
                  </StatusPill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel
        title="Types de prestation"
        description="Codes WebLamps 0 à 49, rattachés à une catégorie et à un compte 602xxx."
        padded={false}
        tools={
          canWrite ? (
            <AddButton onClick={() => setDialog("serviceType")}>
              Nouveau type
            </AddButton>
          ) : null
        }
      >
        {serviceTypes.length === 0 ? (
          <EmptyState
            title="Aucun type de prestation"
            description="Les 49 prestations arrivent avec la reprise WebLamps ; en attendant, saisissez celles dont vous avez besoin."
          />
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-y border-line bg-sub text-left text-[11.5px] text-ink-3">
                <th className="px-[15px] py-2 font-medium">Code</th>
                <th className="px-[15px] py-2 font-medium">Libellé</th>
                <th className="px-[15px] py-2 font-medium">Catégorie</th>
                <th className="px-[15px] py-2 font-medium">Compte</th>
              </tr>
            </thead>
            <tbody>
              {serviceTypes.map((serviceType) => (
                <tr key={serviceType.id} className="border-b border-line">
                  <td className="px-[15px] py-2.5">
                    <TagCode>{serviceType.code}</TagCode>
                  </td>
                  <td className="px-[15px] py-2.5">{serviceType.label}</td>
                  <td className="px-[15px] py-2.5 text-ink-3">
                    {serviceType.categoryLabel}
                  </td>
                  <td className="px-[15px] py-2.5 tabular-nums text-ink-3">
                    {serviceType.accountCode ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel
        title="Spécialités prestataires"
        description="Codes 0 à 99, comptes 400xxx. Les prestataires eux-mêmes arrivent en phase 2."
        padded={false}
        tools={
          canWrite ? (
            <AddButton onClick={() => setDialog("specialty")}>
              Nouvelle spécialité
            </AddButton>
          ) : null
        }
      >
        {specialties.length === 0 ? (
          <EmptyState
            title="Aucune spécialité"
            description="À reprendre depuis WebLamps, ou à saisir au fil des conventions."
          />
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-y border-line bg-sub text-left text-[11.5px] text-ink-3">
                <th className="px-[15px] py-2 font-medium">Code</th>
                <th className="px-[15px] py-2 font-medium">Libellé</th>
                <th className="px-[15px] py-2 font-medium">Compte</th>
              </tr>
            </thead>
            <tbody>
              {specialties.map((specialty) => (
                <tr key={specialty.id} className="border-b border-line">
                  <td className="px-[15px] py-2.5">
                    <TagCode>{specialty.code}</TagCode>
                  </td>
                  <td className="px-[15px] py-2.5">{specialty.label}</td>
                  <td className="px-[15px] py-2.5 tabular-nums text-ink-3">
                    {specialty.accountCode ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {dialog === "category" ? (
        <CategoryDialog firmSlug={firmSlug} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "serviceType" ? (
        <ServiceTypeDialog
          firmSlug={firmSlug}
          categories={categories}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "specialty" ? (
        <SpecialtyDialog firmSlug={firmSlug} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  )
}

function AddButton({
  onClick,
  children,
}: {
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 items-center gap-1.5 rounded-control border border-line px-2.5 text-[13px] hover:bg-sub"
    >
      <HugeiconsIcon icon={PlusSignIcon} size={13} aria-hidden />
      {children}
    </button>
  )
}

function CategoryDialog({
  firmSlug,
  onClose,
}: {
  firmSlug: string
  onClose: () => void
}) {
  const router = useRouter()
  const form = useForm({
    resolver: zodResolver(createCategorySchema) as never,
    defaultValues: { firmSlug, code: "", label: "", sortOrder: 0 } as never,
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    (async (values: Record<string, unknown>) =>
      createCategory(values as never)) as never,
    {
      success: "Catégorie créée.",
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
          <DialogTitle>Nouvelle catégorie de soins</DialogTitle>
          <DialogDescription>
            Elle devient immédiatement disponible dans chaque barème — et tant
            qu&apos;aucun taux n&apos;y est saisi, aucune prise en charge ne
            peut être calculée pour elle.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <FieldGrid>
            <TextControl
              form={form}
              name={"code" as never}
              label="Code"
              required
              mono
              autoFocus
            />
            <TextControl
              form={form}
              name={"label" as never}
              label="Libellé"
              required
            />
            <TextControl
              form={form}
              name={"sortOrder" as never}
              label="Ordre d'affichage"
              type="number"
            />
          </FieldGrid>

          <FormMessage tone={tone}>{message}</FormMessage>

          <DialogFooter>
            <SubmitButton pending={pending}>Créer</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ServiceTypeDialog({
  firmSlug,
  categories,
  onClose,
}: {
  firmSlug: string
  categories: CategoryEntry[]
  onClose: () => void
}) {
  const router = useRouter()
  const form = useForm({
    resolver: zodResolver(createServiceTypeSchema) as never,
    defaultValues: {
      firmSlug,
      categoryId: categories[0]?.id ?? "",
      code: "",
      label: "",
      accountCode: "",
    } as never,
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    (async (values: Record<string, unknown>) =>
      createServiceType(values as never)) as never,
    {
      success: "Type de prestation créé.",
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
          <DialogTitle>Nouveau type de prestation</DialogTitle>
          <DialogDescription>
            Le code reprend celui de WebLamps, pour que la reprise puisse
            rapprocher les deux fichiers.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <FieldGrid>
            <TextControl
              form={form}
              name={"code" as never}
              label="Code"
              required
              mono
              autoFocus
            />
            <SelectControl
              form={form}
              name={"categoryId" as never}
              label="Catégorie"
              required
              options={categories.map((category) => ({
                value: category.id,
                label: category.label,
              }))}
            />
            <TextControl
              form={form}
              name={"label" as never}
              label="Libellé"
              required
            />
            <TextControl
              form={form}
              name={"accountCode" as never}
              label="Compte 602xxx"
              mono
            />
          </FieldGrid>

          <FormMessage tone={tone}>{message}</FormMessage>

          <DialogFooter>
            <SubmitButton pending={pending}>Créer</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SpecialtyDialog({
  firmSlug,
  onClose,
}: {
  firmSlug: string
  onClose: () => void
}) {
  const router = useRouter()
  const form = useForm({
    resolver: zodResolver(createSpecialtySchema) as never,
    defaultValues: { firmSlug, code: "", label: "", accountCode: "" } as never,
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    (async (values: Record<string, unknown>) =>
      createSpecialty(values as never)) as never,
    {
      success: "Spécialité créée.",
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
          <DialogTitle>Nouvelle spécialité</DialogTitle>
          <DialogDescription>
            Les spécialités classent les prestataires et portent leur compte
            fournisseur.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <FieldGrid>
            <TextControl
              form={form}
              name={"code" as never}
              label="Code"
              required
              mono
              autoFocus
            />
            <TextControl
              form={form}
              name={"label" as never}
              label="Libellé"
              required
            />
            <TextControl
              form={form}
              name={"accountCode" as never}
              label="Compte 400xxx"
              mono
            />
          </FieldGrid>

          <FormMessage tone={tone}>{message}</FormMessage>

          <DialogFooter>
            <SubmitButton pending={pending}>Créer</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
