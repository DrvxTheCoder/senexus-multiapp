"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import {
  CheckboxControl,
  DateControl,
  FieldGrid,
  SelectControl,
  TextControl,
  TextareaControl,
} from "@/components/forms/controls"
import { FormMessage, SubmitButton } from "@/components/forms/form-field"
import { Spinner } from "@/components/spinner"
import { useAction } from "@/components/forms/use-action"
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
  rejectLeaveSchema,
  requestLeaveSchema,
  rolloverLeaveSchema,
} from "@/lib/forms/hr-schemas"
import { formatNumber } from "@/lib/format"
import {
  approveLeave,
  rejectLeave,
  rolloverLeaveBalances,
} from "@/server/actions/leaves"
import { requestLeave } from "@/server/actions/leaves"

/**
 * Leave dialogs.
 *
 * The count of days is deliberately **not** computed in the browser: business
 * days are a domain rule, the server owns it, and a number shown here that
 * disagreed with the one stored would be worse than no number at all. The
 * dialog states the rule instead.
 */

const today = () => new Date().toISOString().slice(0, 10)

export const LEAVE_TYPE_OPTIONS = [
  { value: "ANNUAL", label: "Congé annuel" },
  { value: "SICK", label: "Maladie" },
  { value: "MATERNITY", label: "Maternité" },
  { value: "PATERNITY", label: "Paternité" },
  { value: "UNPAID", label: "Sans solde" },
  { value: "SPECIAL", label: "Congé exceptionnel" },
  { value: "COMPENSATORY", label: "Récupération" },
] as const

export function RequestLeaveDialog({
  firmSlug,
  employees,
  onClose,
}: {
  firmSlug: string
  employees: { id: string; name: string; matricule: string }[]
  onClose: () => void
}) {
  const router = useRouter()

  const form = useForm({
    resolver: zodResolver(requestLeaveSchema) as never,
    defaultValues: {
      firmSlug,
      employeeId: employees[0]?.id ?? "",
      leaveType: "ANNUAL",
      startDate: today(),
      endDate: today(),
      isPaid: true,
      reason: "",
    } as never,
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    requestLeave as never,
    {
      success: "Demande de congé enregistrée.",
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
          <DialogTitle>Nouvelle demande de congé</DialogTitle>
          <DialogDescription>
            Les jours sont comptés du lundi au vendredi, bornes incluses. Le
            solde annuel n&apos;est débité qu&apos;à l&apos;approbation.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <SelectControl
            form={form}
            name={"employeeId" as never}
            label="Employé"
            required
            options={employees.map((employee) => ({
              value: employee.id,
              label: `${employee.name} · ${employee.matricule}`,
            }))}
          />

          <FieldGrid>
            <SelectControl
              form={form}
              name={"leaveType" as never}
              label="Type"
              required
              options={LEAVE_TYPE_OPTIONS}
            />
            <div />
            <DateControl
              form={form}
              name={"startDate" as never}
              label="Du"
              required
            />
            <DateControl
              form={form}
              name={"endDate" as never}
              label="Au"
              required
            />
          </FieldGrid>

          <CheckboxControl
            form={form}
            name={"isPaid" as never}
            label="Congé payé"
          />

          <TextareaControl
            form={form}
            name={"reason" as never}
            label="Motif"
            rows={2}
          />

          <FormMessage tone={tone}>{message}</FormMessage>

          <DialogFooter>
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-[7px] border border-line bg-surface px-3 text-[13px] hover:bg-sub"
            >
              Annuler
            </button>
            <SubmitButton pending={pending}>Enregistrer la demande</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* -------------------------------------------------------------------------- */

export function RejectLeaveDialog({
  firmSlug,
  request,
  onClose,
}: {
  firmSlug: string
  request: { id: string; employeeName: string }
  onClose: () => void
}) {
  const router = useRouter()
  const form = useForm({
    resolver: zodResolver(rejectLeaveSchema) as never,
    defaultValues: { firmSlug, id: request.id, rejectionReason: "" } as never,
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    rejectLeave as never,
    {
      success: "Demande refusée.",
      onSuccess: () => {
        onClose()
        router.refresh()
      },
    }
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Refuser la demande</DialogTitle>
          <DialogDescription>
            Le motif est conservé sur la demande de {request.employeeName}.
            Aucun jour n&apos;est débité.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <TextareaControl
            form={form}
            name={"rejectionReason" as never}
            label="Motif du refus"
            required
            rows={3}
          />
          <FormMessage tone={tone}>{message}</FormMessage>
          <DialogFooter>
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-[7px] border border-line bg-surface px-3 text-[13px] hover:bg-sub"
            >
              Annuler
            </button>
            <SubmitButton pending={pending} className="bg-alert">
              Refuser
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* -------------------------------------------------------------------------- */

export function RolloverDialog({
  firmSlug,
  onClose,
}: {
  firmSlug: string
  onClose: () => void
}) {
  const router = useRouter()
  const [result, setResult] = React.useState<{
    targetYear: number
    created: number
    skipped: number
    carriedTotal: number
  } | null>(null)

  const form = useForm({
    resolver: zodResolver(rolloverLeaveSchema) as never,
    defaultValues: {
      firmSlug,
      year: new Date().getFullYear(),
      maxCarryOver: 10,
    } as never,
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    rolloverLeaveBalances as never,
    {
      loading: "Report des soldes…",
      success: "Soldes reportés.",
      onSuccess: (data) => {
        setResult(
          data as {
            targetYear: number
            created: number
            skipped: number
            carriedTotal: number
          }
        )
        router.refresh()
      },
    }
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reporter les soldes de congés</DialogTitle>
          <DialogDescription>
            Ouvre le solde de l&apos;année suivante pour chaque employé actif, en
            reportant au plus le nombre de jours indiqué. Relancer l&apos;opération
            ne crée jamais de double solde.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <p className="rounded-md bg-ok-tint px-2.5 py-1.5 text-[12.5px] text-ok">
              {formatNumber(result.created)} solde
              {result.created > 1 ? "s" : ""} ouvert
              {result.created > 1 ? "s" : ""} pour {result.targetYear},{" "}
              {formatNumber(result.carriedTotal)} jour
              {result.carriedTotal > 1 ? "s" : ""} reporté
              {result.carriedTotal > 1 ? "s" : ""}.
            </p>
            {result.skipped > 0 ? (
              <p className="rounded-md bg-sub px-2.5 py-1.5 text-[12.5px] text-ink-2">
                {formatNumber(result.skipped)} employé
                {result.skipped > 1 ? "s avaient" : " avait"} déjà un solde pour{" "}
                {result.targetYear} — laissé{result.skipped > 1 ? "s" : ""}{" "}
                intact{result.skipped > 1 ? "s" : ""}.
              </p>
            ) : null}
            <DialogFooter>
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-[7px] bg-ink px-3 text-[13px] font-medium text-paper"
              >
                Fermer
              </button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <FieldGrid>
              <TextControl
                form={form}
                name={"year" as never}
                label="Année de départ"
                type="number"
                required
              />
              <TextControl
                form={form}
                name={"maxCarryOver" as never}
                label="Report maximum (jours)"
                type="number"
                required
              />
            </FieldGrid>
            <FormMessage tone={tone}>{message}</FormMessage>
            <DialogFooter>
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-[7px] border border-line bg-surface px-3 text-[13px] hover:bg-sub"
              >
                Annuler
              </button>
              <SubmitButton pending={pending}>Reporter</SubmitButton>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* -------------------------------------------------------------------------- */

/** Approve is one click; there is nothing to ask. */
export function ApproveLeaveButton({
  firmSlug,
  id,
}: {
  firmSlug: string
  id: string
}) {
  const { run, pending, error } = useAction(approveLeave, {
    success: "Congé approuvé.",
  })

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => run({ firmSlug, id })}
        className="inline-flex h-7 items-center gap-1.5 rounded-[7px] bg-ink px-2.5 text-[12px] font-medium text-paper disabled:opacity-50"
      >
        {pending ? "Approbation…" : "Approuver"}
        {pending ? <Spinner className="h-3.5" /> : null}
      </button>
      {error ? (
        <span role="alert" className="max-w-[260px] text-right text-[11px] text-alert">
          {error}
        </span>
      ) : null}
    </span>
  )
}
