"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { HugeiconsIcon } from "@hugeicons/react"
import { PlusSignIcon } from "@hugeicons/core-free-icons"

import {
  DateControl,
  FieldGrid,
  SelectControl,
  TextControl,
} from "@/components/forms/controls"
import { FormMessage, SubmitButton } from "@/components/forms/form-field"
import { useActionForm } from "@/components/forms/use-action-form"
import { Panel } from "@/components/panel"
import { EmptyState, StatusPill } from "@/components/primitives"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatCurrency, formatNumber } from "@/lib/format"
import { createPlanSchema, setPlanRateSchema } from "@/lib/forms/ipm-schemas"
import { createPlan, setPlanRate } from "@/server/actions/ipm"
import { formatRate } from "@/server/domain/ipm/rates"
import type { CategoryRef, PlanRow } from "@/server/queries/ipm/plans"

/**
 * Formules et barèmes — a matrix, formules down and catégories across.
 *
 * The design decision that matters is the empty cell. Optique and
 * hospitalisation have no taux: theirs is on the 23 non-exportable WebLamps
 * pages awaiting manual re-entry (§8). Rendering those as `0 %` would be a
 * lie the settlement engine then acts on, so an empty cell reads "à saisir"
 * and is clickable — this screen is the tool for that re-entry.
 */
export function PlansView({
  firmSlug,
  plans,
  categories,
  canWrite,
}: {
  firmSlug: string
  plans: PlanRow[]
  categories: CategoryRef[]
  canWrite: boolean
}) {
  const [creating, setCreating] = React.useState(false)
  const [editingCell, setEditingCell] = React.useState<{
    plan: PlanRow
    category: CategoryRef
    current: number | null
  } | null>(null)

  const activeCategories = categories.filter((category) => category.active)
  const missingTotal = plans.reduce(
    (sum, plan) => sum + plan.missingCategoryIds.length,
    0
  )

  return (
    <>
      <Panel
        title="Formules"
        description="Un taux par catégorie. La dérogation d'un employeur, quand elle existe, prime sur ces valeurs."
        padded={false}
        stats={[
          { label: "Formules", value: formatNumber(plans.length) },
          {
            label: "Taux à saisir",
            value: formatNumber(missingTotal),
            tone: missingTotal > 0 ? "alert" : undefined,
          },
        ]}
        tools={
          canWrite ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex h-8 items-center gap-1.5 rounded-control bg-brand px-2.5 text-[13px] font-medium text-on-brand hover:opacity-90"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={13} aria-hidden />
              Nouvelle formule
            </button>
          ) : null
        }
        footer={
          missingTotal > 0
            ? {
                summary:
                  "Une cellule vide n'est pas un taux de 0 % : aucune prise en charge ne peut être calculée tant qu'elle n'est pas saisie.",
              }
            : undefined
        }
      >
        {plans.length === 0 ? (
          <EmptyState
            title="Aucune formule"
            description="Créez les formules du dépliant : Tawfeikh, Xeweul, Teranga, Noflay."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead>
                <tr className="border-y border-line bg-sub text-left text-[11.5px] text-ink-3">
                  <th className="px-[15px] py-2 font-medium">Formule</th>
                  <th className="px-[15px] py-2 font-medium">Prix / mois</th>
                  {activeCategories.map((category) => (
                    <th key={category.id} className="px-[15px] py-2 font-medium">
                      {category.label}
                    </th>
                  ))}
                  <th className="px-[15px] py-2 font-medium">Souscripteurs</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.id} className="border-b border-line">
                    <td className="px-[15px] py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{plan.name}</span>
                        {!plan.active ? (
                          <StatusPill tone="muted">Inactive</StatusPill>
                        ) : null}
                      </div>
                      <div className="mt-px text-[11.5px] text-ink-3">
                        {plan.code}
                      </div>
                    </td>
                    <td className="px-[15px] py-2.5 tabular-nums">
                      {formatCurrency(plan.monthlyPrice)}
                    </td>
                    {activeCategories.map((category) => {
                      const cell = plan.rates.find(
                        (rate) =>
                          rate.categoryId === category.id &&
                          rate.beneficiaryType === "ALL"
                      )
                      return (
                        <td key={category.id} className="px-[15px] py-2.5">
                          {cell ? (
                            canWrite ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setEditingCell({
                                    plan,
                                    category,
                                    current: cell.rate,
                                  })
                                }
                                className="tabular-nums hover:text-brand hover:underline"
                              >
                                {formatRate(cell.rate)}
                              </button>
                            ) : (
                              <span className="tabular-nums">
                                {formatRate(cell.rate)}
                              </span>
                            )
                          ) : canWrite ? (
                            <button
                              type="button"
                              onClick={() =>
                                setEditingCell({
                                  plan,
                                  category,
                                  current: null,
                                })
                              }
                              className="text-[12.5px] text-alert hover:underline"
                            >
                              à saisir
                            </button>
                          ) : (
                            <span className="text-[12.5px] text-alert">
                              à saisir
                            </span>
                          )}
                        </td>
                      )
                    })}
                    <td className="px-[15px] py-2.5 tabular-nums text-ink-3">
                      {formatNumber(plan.employerCount)} empl. ·{" "}
                      {formatNumber(plan.memberCount)} part.
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {creating ? (
        <PlanDialog firmSlug={firmSlug} onClose={() => setCreating(false)} />
      ) : null}

      {editingCell ? (
        <RateDialog
          firmSlug={firmSlug}
          plan={editingCell.plan}
          category={editingCell.category}
          current={editingCell.current}
          onClose={() => setEditingCell(null)}
        />
      ) : null}
    </>
  )
}

const today = () => new Date().toISOString().slice(0, 10)

function PlanDialog({
  firmSlug,
  onClose,
}: {
  firmSlug: string
  onClose: () => void
}) {
  const router = useRouter()

  const form = useForm({
    resolver: zodResolver(createPlanSchema) as never,
    defaultValues: {
      firmSlug,
      code: "",
      name: "",
      monthlyPrice: "",
      validFrom: today(),
    } as never,
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    (async (values: Record<string, unknown>) =>
      createPlan(values as never)) as never,
    {
      success: "Formule créée.",
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
          <DialogTitle>Nouvelle formule</DialogTitle>
          <DialogDescription>
            Une formule est datée. Changer un prix, c&apos;est créer une
            nouvelle version — pas modifier celle qui a déjà tarifé des
            cotisations.
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
            <TextControl form={form} name={"name" as never} label="Nom" required />
            <TextControl
              form={form}
              name={"monthlyPrice" as never}
              label="Prix mensuel (FCFA)"
              required
            />
            <DateControl
              form={form}
              name={"validFrom" as never}
              label="En vigueur à partir du"
              required
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

const BENEFICIARY_OPTIONS = [
  { value: "ALL", label: "Tous les bénéficiaires" },
  { value: "MEMBER", label: "Participant" },
  { value: "SPOUSE_F", label: "Épouse" },
  { value: "SPOUSE_M", label: "Époux" },
  { value: "CHILD", label: "Enfant" },
  { value: "ASCENDANT", label: "Ascendant" },
  { value: "OTHER", label: "Autre" },
] as const

function RateDialog({
  firmSlug,
  plan,
  category,
  current,
  onClose,
}: {
  firmSlug: string
  plan: PlanRow
  category: CategoryRef
  current: number | null
  onClose: () => void
}) {
  const router = useRouter()

  const form = useForm({
    resolver: zodResolver(setPlanRateSchema) as never,
    defaultValues: {
      firmSlug,
      planId: plan.id,
      categoryId: category.id,
      beneficiaryType: "ALL",
      // Shown as a percentage; the schema converts it to the stored fraction.
      rate: current === null ? "" : String(Math.round(current * 1000) / 10),
      ceilingPerAct: "",
      ceilingMonthly: "",
      ceilingAnnual: "",
      waitingPeriodDays: 0,
    } as never,
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    (async (values: Record<string, unknown>) =>
      setPlanRate(values as never)) as never,
    {
      success: "Barème enregistré.",
      onSuccess: () => {
        onClose()
        router.refresh()
      },
    }
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(600px,calc(100%-2rem))] max-w-none sm:max-w-none">
        <DialogHeader>
          <DialogTitle>
            {plan.name} — {category.label}
          </DialogTitle>
          <DialogDescription>
            Le taux s&apos;entend en pourcentage du montant total. Le délai de
            carence est une fréquence minimale entre deux prises en charge, pas
            un plafond.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <FieldGrid>
            <TextControl
              form={form}
              name={"rate" as never}
              label="Taux (%)"
              required
              autoFocus
            />
            <SelectControl
              form={form}
              name={"beneficiaryType" as never}
              label="Bénéficiaire"
              required
              options={BENEFICIARY_OPTIONS}
            />
            <TextControl
              form={form}
              name={"ceilingPerAct" as never}
              label="Plafond par acte"
            />
            <TextControl
              form={form}
              name={"ceilingAnnual" as never}
              label="Plafond annuel"
            />
            <TextControl
              form={form}
              name={"waitingPeriodDays" as never}
              label="Carence (jours)"
              type="number"
            />
          </FieldGrid>

          <FormMessage tone={tone}>{message}</FormMessage>

          <DialogFooter>
            <SubmitButton pending={pending}>Enregistrer</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
