"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import {
  DateControl,
  FieldGrid,
  TextareaControl,
  TextControl,
} from "@/components/forms/controls"
import { FormMessage, SubmitButton } from "@/components/forms/form-field"
import { useAction } from "@/components/forms/use-action"
import { useActionForm } from "@/components/forms/use-action-form"
import { Panel } from "@/components/panel"
import { StatusPill } from "@/components/primitives"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatCurrency, formatDate } from "@/lib/format"
import {
  setEmployerRateSchema,
  setMemberCeilingSchema,
} from "@/lib/forms/ipm-schemas"
import { removeEmployerRate, setEmployerRate } from "@/server/actions/ipm"
import { endMemberCeiling, setMemberCeiling } from "@/server/actions/ipm-ceilings"
import { formatRate } from "@/server/domain/ipm/rates"
import type {
  CategoryCoverage,
  CeilingCell,
  LevelValues,
} from "@/server/queries/ipm/ceilings"

/**
 * Taux et plafonds, at the three levels — participant > employeur > formule.
 *
 * Every figure on these screens is resolved by the server through
 * `resolveRate`, the function issuance uses, and carries where it came from.
 * Nothing here works out a precedence of its own: a screen that did would
 * eventually disagree with the bon it is meant to explain.
 */

const SOURCE_LABEL = {
  MEMBER: "Particulier",
  EMPLOYER: "Employeur",
  PLAN: "Formule",
} as const

const SOURCE_TONE = {
  MEMBER: "brand",
  EMPLOYER: "signal",
  PLAN: "muted",
} as const

export function SourceTag({
  source,
}: {
  source: keyof typeof SOURCE_LABEL | null
}) {
  if (!source) return null
  return <StatusPill tone={SOURCE_TONE[source]}>{SOURCE_LABEL[source]}</StatusPill>
}

function Cell({ cell }: { cell: CeilingCell | undefined }) {
  if (!cell || cell.value === null) return <span className="text-ink-3">—</span>
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className="tabular-nums">{formatCurrency(cell.value)}</span>
      <SourceTag source={cell.source} />
    </span>
  )
}

const money = (value: number | null | undefined) =>
  value === null || value === undefined ? "aucun" : formatCurrency(value)

const asInput = (value: number | null | undefined) =>
  value === null || value === undefined ? "" : String(value)

function CoverageTable({
  rows,
  action,
}: {
  rows: CategoryCoverage[]
  action?: (row: CategoryCoverage) => React.ReactNode
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-y border-line bg-sub text-left text-[11.5px] text-ink-3">
            <th className="px-[15px] py-2 font-medium">Catégorie</th>
            <th className="px-[15px] py-2 font-medium">Taux</th>
            <th className="px-[15px] py-2 font-medium">Par acte</th>
            <th className="px-[15px] py-2 font-medium">Mensuel</th>
            <th className="px-[15px] py-2 font-medium">Annuel</th>
            <th className="px-[15px] py-2 font-medium">Carence</th>
            {action ? <th className="px-[15px] py-2" /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const effective = row.effective
            return (
              <tr key={row.categoryId} className="border-b border-line align-top last:border-0">
                <td className="px-[15px] py-2.5">{row.categoryLabel}</td>
                <td className="px-[15px] py-2.5">
                  {effective ? (
                    <span className="inline-flex flex-col items-start gap-0.5">
                      <span className="tabular-nums">{formatRate(effective.rate)}</span>
                      <SourceTag source={effective.rateSource} />
                    </span>
                  ) : (
                    // Never 0 %: nobody has entered this barème yet, which is a
                    // different statement from "rien n'est couvert".
                    <span className="text-alert">Barème manquant</span>
                  )}
                </td>
                <td className="px-[15px] py-2.5"><Cell cell={effective?.perAct} /></td>
                <td className="px-[15px] py-2.5"><Cell cell={effective?.monthly} /></td>
                <td className="px-[15px] py-2.5"><Cell cell={effective?.annual} /></td>
                <td className="px-[15px] py-2.5 tabular-nums text-ink-3">
                  {effective?.waitingPeriodDays ? `${effective.waitingPeriodDays} j` : "—"}
                </td>
                {action ? (
                  <td className="px-[15px] py-2.5 text-right whitespace-nowrap">{action(row)}</td>
                ) : null}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ==========================================================================
 * Participant — plafonds particuliers
 * ========================================================================== */

export function MemberCoveragePanel({
  firmSlug,
  memberId,
  rows,
  canWrite,
}: {
  firmSlug: string
  memberId: string
  rows: CategoryCoverage[]
  canWrite: boolean
}) {
  const [editing, setEditing] = React.useState<CategoryCoverage | null>(null)
  const end = useAction(endMemberCeiling, { success: "Plafond particulier retiré." })
  const particular = rows.filter((row) => row.member)

  return (
    <>
      <Panel
        titleAs="h2"
        title="Taux et plafonds"
        description="Chaque plafond est résolu séparément : plafond particulier, puis employeur, puis formule."
        padded={false}
      >
        <CoverageTable
          rows={rows}
          action={
            canWrite
              ? (row) =>
                  row.effective ? (
                    <Button size="sm" variant="outline" onClick={() => setEditing(row)}>
                      {row.member ? "Modifier" : "Plafond particulier"}
                    </Button>
                  ) : null
              : undefined
          }
        />
        {particular.length ? (
          <ul className="space-y-2 border-t border-line px-[15px] py-3 text-[12.5px]">
            {particular.map((row) => (
              <li key={row.categoryId} className="flex flex-wrap items-start gap-x-3 gap-y-1">
                <SourceTag source="MEMBER" />
                <span className="font-medium">{row.categoryLabel}</span>
                <span className="text-ink-2">
                  {row.member!.reason}
                  <span className="text-ink-3">
                    {" "}— depuis le {formatDate(row.member!.validFrom)}
                    {row.member!.authorName ? `, par ${row.member!.authorName}` : ""}
                  </span>
                </span>
                {canWrite ? (
                  <button
                    type="button"
                    className="ml-auto text-alert hover:underline disabled:opacity-50"
                    disabled={end.pending}
                    onClick={() => end.run({ firmSlug, ceilingId: row.member!.id })}
                  >
                    Retirer
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      {editing ? (
        <MemberCeilingDialog
          firmSlug={firmSlug}
          memberId={memberId}
          row={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  )
}

function MemberCeilingDialog({
  firmSlug,
  memberId,
  row,
  onClose,
}: {
  firmSlug: string
  memberId: string
  row: CategoryCoverage
  onClose: () => void
}) {
  const router = useRouter()
  const inherited = row.inherited
  const form = useForm({
    resolver: zodResolver(setMemberCeilingSchema) as never,
    defaultValues: {
      firmSlug,
      memberId,
      categoryId: row.categoryId,
      ceilingPerAct: asInput(row.member?.ceilingPerAct),
      ceilingMonthly: asInput(row.member?.ceilingMonthly),
      ceilingAnnual: asInput(row.member?.ceilingAnnual),
      reason: "",
      validFrom: new Date().toISOString().slice(0, 10),
    } as never,
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    (async (values: Record<string, unknown>) =>
      setMemberCeiling(values as never)) as never,
    {
      success: "Plafond particulier enregistré.",
      onSuccess: () => {
        onClose()
        router.refresh()
      },
    }
  )

  const hint = (cell: CeilingCell | undefined) =>
    `Vide = hérité : ${money(cell?.value)}${cell?.source ? ` (${SOURCE_LABEL[cell.source].toLowerCase()})` : ""}`

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(600px,calc(100%-2rem))] max-w-none sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Plafond particulier — {row.categoryLabel}</DialogTitle>
          <DialogDescription>
            S&apos;applique à toute la famille, au-dessus des plafonds de
            l&apos;employeur et de la formule. Le taux ne change pas. Un champ
            vide garde la valeur héritée.
            {row.member
              ? " Le plafond en cours sera clos à la date d'effet du nouveau."
              : ""}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <FieldGrid>
            <TextControl
              form={form}
              name={"ceilingPerAct" as never}
              label="Plafond par acte"
              hint={hint(inherited?.perAct)}
            />
            <TextControl
              form={form}
              name={"ceilingMonthly" as never}
              label="Plafond mensuel"
              hint={hint(inherited?.monthly)}
            />
            <TextControl
              form={form}
              name={"ceilingAnnual" as never}
              label="Plafond annuel"
              hint={hint(inherited?.annual)}
            />
            <DateControl form={form} name={"validFrom" as never} label="À partir du" required />
          </FieldGrid>
          <TextareaControl
            form={form}
            name={"reason" as never}
            label="Motif"
            rows={2}
            placeholder="Ex. : traitement chronique, décision du conseil du 15/09/2026."
            required
          />
          <FormMessage tone={tone}>{message}</FormMessage>
          <DialogFooter>
            <SubmitButton pending={pending}>Enregistrer</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ==========================================================================
 * Employeur — dérogations
 * ========================================================================== */

export function EmployerRatesPanel({
  firmSlug,
  employerId,
  hasPlan,
  rows,
  canWrite,
}: {
  firmSlug: string
  employerId: string
  hasPlan: boolean
  rows: CategoryCoverage[]
  canWrite: boolean
}) {
  const [editing, setEditing] = React.useState<CategoryCoverage | null>(null)
  const remove = useAction(removeEmployerRate, {
    success: "Dérogation retirée : la formule s'applique.",
  })

  return (
    <>
      <Panel
        titleAs="h2"
        title="Taux et plafonds de l'employeur"
        description={
          hasPlan
            ? "Une dérogation s'applique à tous les participants de l'employeur. Un plafond laissé vide reprend celui de la formule."
            : "Employeur sans formule : son barème est entièrement le sien."
        }
        padded={false}
      >
        <CoverageTable
          rows={rows}
          action={
            canWrite
              ? (row) => (
                  <span className="inline-flex gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => setEditing(row)}>
                      {row.employer ? "Modifier" : "Déroger"}
                    </Button>
                    {row.employer ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={remove.pending}
                        onClick={() => remove.run({ firmSlug, rateId: row.employer!.id })}
                      >
                        {hasPlan ? "Revenir à la formule" : "Retirer"}
                      </Button>
                    ) : null}
                  </span>
                )
              : undefined
          }
        />
      </Panel>

      {editing ? (
        <EmployerRateDialog
          firmSlug={firmSlug}
          employerId={employerId}
          row={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  )
}

function EmployerRateDialog({
  firmSlug,
  employerId,
  row,
  onClose,
}: {
  firmSlug: string
  employerId: string
  row: CategoryCoverage
  onClose: () => void
}) {
  const router = useRouter()
  const own: LevelValues | null = row.employer
  const plan = row.plan
  // The taux is required on a dérogation row; start from the employer's own,
  // else the formule's, so a ceiling-only dérogation does not move the taux.
  const startRate = own?.rate ?? plan?.rate ?? null

  const form = useForm({
    // raw: validate here, but submit what was typed. The schema turns 80 into
    // 0.8, and the action parses again — a parsed value would arrive as 0.008.
    resolver: zodResolver(setEmployerRateSchema, undefined, { raw: true }) as never,
    defaultValues: {
      firmSlug,
      employerId,
      categoryId: row.categoryId,
      beneficiaryType: "ALL",
      rate: startRate === null ? "" : String(Math.round(startRate * 1000) / 10),
      ceilingPerAct: asInput(own?.ceilingPerAct),
      ceilingMonthly: asInput(own?.ceilingMonthly),
      ceilingAnnual: asInput(own?.ceilingAnnual),
      waitingPeriodDays: own?.waitingPeriodDays ?? "",
    } as never,
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    (async (values: Record<string, unknown>) =>
      setEmployerRate(values as never)) as never,
    {
      success: "Dérogation enregistrée.",
      onSuccess: () => {
        onClose()
        router.refresh()
      },
    }
  )

  const fromPlan = (value: number | null | undefined) =>
    plan ? `Formule : ${money(value)}` : "Pas de formule"

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(600px,calc(100%-2rem))] max-w-none sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Dérogation — {row.categoryLabel}</DialogTitle>
          <DialogDescription>
            S&apos;applique à tous les participants de l&apos;employeur, sauf
            plafond particulier. Un plafond vide reprend celui de la formule.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <FieldGrid>
            <TextControl
              form={form}
              name={"rate" as never}
              label="Taux (%)"
              required
              hint={plan?.rate != null ? `Formule : ${formatRate(plan.rate)}` : undefined}
            />
            <TextControl
              form={form}
              name={"waitingPeriodDays" as never}
              label="Carence (jours)"
              type="number"
              hint={plan ? `Vide = formule : ${plan.waitingPeriodDays ?? 0} j` : undefined}
            />
            <TextControl
              form={form}
              name={"ceilingPerAct" as never}
              label="Plafond par acte"
              hint={fromPlan(plan?.ceilingPerAct)}
            />
            <TextControl
              form={form}
              name={"ceilingMonthly" as never}
              label="Plafond mensuel"
              hint={fromPlan(plan?.ceilingMonthly)}
            />
            <TextControl
              form={form}
              name={"ceilingAnnual" as never}
              label="Plafond annuel"
              hint={fromPlan(plan?.ceilingAnnual)}
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
