"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import { CONTRACT_TYPE_OPTIONS } from "@/app/[firmSlug]/hr/employees/employee-dialogs"
import {
  CheckboxControl,
  DateControl,
  FieldGrid,
  SelectControl,
  TextareaControl,
} from "@/components/forms/controls"
import { FormMessage, SubmitButton } from "@/components/forms/form-field"
import type { ActionResult } from "@/lib/forms/action-result"
import { useAction } from "@/components/forms/use-action"
import { useActionForm } from "@/components/forms/use-action-form"
import { Spinner } from "@/components/spinner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  bulkTransferSchema,
  rejectTransferSchema,
  requestTransferSchema,
} from "@/lib/forms/hr-schemas"
import { formatNumber } from "@/lib/format"
import {
  approveTransfer,
  cancelTransfer,
  completeTransfer,
  rejectTransfer,
  requestBulkTransfer,
  requestTransfer,
} from "@/server/actions/transfers"

/**
 * Transfer dialogs.
 *
 * The one field worth arguing about is **"ouvrir un contrat dans la filiale de
 * destination"**. The legacy dialog had this checkbox and never sent it, so
 * completion moved the employee and left them with no active contract anywhere
 * — visible in the live deployment today as people who belong to a firm and are
 * employed by nobody. It is checked by default and the copy says what it does.
 */

const today = () => new Date().toISOString().slice(0, 10)

export type TransferFirm = { id: string; name: string }
export type TransferClient = { id: string; name: string; firmId: string }

/* ==========================================================================
 * Request — one employee
 * ========================================================================== */

export function TransferDialog({
  firmSlug,
  employee,
  firms,
  clients,
  onClose,
}: {
  firmSlug: string
  employee: { id: string; name: string; matricule: string }
  firms: TransferFirm[]
  /** Clients of every destination firm; filtered to the chosen one. */
  clients: TransferClient[]
  onClose: () => void
}) {
  const router = useRouter()

  const form = useForm({
    resolver: zodResolver(requestTransferSchema) as never,
    defaultValues: {
      firmSlug,
      employeeId: employee.id,
      toFirmId: firms[0]?.id ?? "",
      transferDate: today(),
      effectiveDate: today(),
      reason: "",
      clientId: "",
      createDestinationContract: true,
      contractType: "INTERIM",
      notes: "",
    } as never,
  })

  const toFirmId = form.watch("toFirmId" as never) as unknown as string
  const destinationClients = clients.filter(
    (client) => client.firmId === toFirmId
  )

  const { submit, pending, message, tone } = useActionForm(
    form,
    requestTransfer as never,
    {
      success: "Transfert demandé.",
      onSuccess: () => {
        onClose()
        router.refresh()
      },
    }
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(620px,calc(100%-2rem))] max-w-none sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Transférer {employee.name}</DialogTitle>
          <DialogDescription>
            Un transfert n&apos;est possible qu&apos;entre filiales du même
            groupe. La filiale de destination approuve, la filiale d&apos;origine
            finalise. Le plafond de 730 jours repart à zéro à l&apos;arrivée.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <SelectControl
            form={form}
            name={"toFirmId" as never}
            label="Filiale de destination"
            required
            options={firms.map((firm) => ({ value: firm.id, label: firm.name }))}
          />

          <FieldGrid>
            <DateControl
              form={form}
              name={"transferDate" as never}
              label="Date de la demande"
              required
            />
            <DateControl
              form={form}
              name={"effectiveDate" as never}
              label="Prise d'effet"
              required
              hint="La finalisation est refusée avant cette date."
            />
          </FieldGrid>

          <SelectControl
            form={form}
            name={"clientId" as never}
            label="Client à l'arrivée"
            options={destinationClients.map((client) => ({
              value: client.id,
              label: client.name,
            }))}
            placeholder="Conserver l'affectation actuelle"
            hint="Laissé vide, le client actuel de l'employé n'est pas touché."
          />

          <TextareaControl
            form={form}
            name={"reason" as never}
            label="Motif"
            required
            rows={2}
          />

          <CheckboxControl
            form={form}
            name={"createDestinationContract" as never}
            label="Ouvrir un contrat dans la filiale de destination"
            hint="Sans cela, l'employé arrive dans la nouvelle filiale sans contrat actif."
          />

          <SelectControl
            form={form}
            name={"contractType" as never}
            label="Type du contrat d'arrivée"
            options={CONTRACT_TYPE_OPTIONS}
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
            <SubmitButton pending={pending}>Demander le transfert</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ==========================================================================
 * Request — a selection
 * ========================================================================== */

export function BulkTransferDialog({
  firmSlug,
  employeeIds,
  firms,
  onClose,
}: {
  firmSlug: string
  employeeIds: string[]
  firms: TransferFirm[]
  onClose: () => void
}) {
  const router = useRouter()
  const [result, setResult] = React.useState<{
    created: number
    skipped: number
    unreachable: number
  } | null>(null)

  const form = useForm({
    resolver: zodResolver(bulkTransferSchema) as never,
    defaultValues: {
      firmSlug,
      employeeIds,
      toFirmId: firms[0]?.id ?? "",
      transferDate: today(),
      effectiveDate: today(),
      reason: "",
      clientId: "",
      createDestinationContract: true,
      contractType: "INTERIM",
    } as never,
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    requestBulkTransfer as never,
    {
      loading: "Création des transferts…",
      success: "Transferts demandés.",
      onSuccess: (data) => {
        setResult(
          data as { created: number; skipped: number; unreachable: number }
        )
        router.refresh()
      },
    }
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(620px,calc(100%-2rem))] max-w-none sm:max-w-none">
        <DialogHeader>
          <DialogTitle>
            Transférer {formatNumber(employeeIds.length)} employé
            {employeeIds.length > 1 ? "s" : ""}
          </DialogTitle>
          <DialogDescription>
            Une seule transaction : soit toutes les demandes sont créées, soit
            aucune. Les employés ayant déjà un transfert en cours sont écartés et
            comptés.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <p className="rounded-md bg-ok-tint px-2.5 py-1.5 text-[12.5px] text-ok">
              {formatNumber(result.created)} demande
              {result.created > 1 ? "s" : ""} créée
              {result.created > 1 ? "s" : ""}.
            </p>
            {result.skipped > 0 ? (
              <p className="rounded-md bg-signal-tint px-2.5 py-1.5 text-[12.5px] text-signal">
                {formatNumber(result.skipped)} écarté
                {result.skipped > 1 ? "s" : ""} : un transfert est déjà en cours.
              </p>
            ) : null}
            {result.unreachable > 0 ? (
              <p className="rounded-md bg-alert-tint px-2.5 py-1.5 text-[12.5px] text-alert">
                {formatNumber(result.unreachable)} hors de votre portée.
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
            <SelectControl
              form={form}
              name={"toFirmId" as never}
              label="Filiale de destination"
              required
              options={firms.map((firm) => ({
                value: firm.id,
                label: firm.name,
              }))}
            />

            <FieldGrid>
              <DateControl
                form={form}
                name={"transferDate" as never}
                label="Date de la demande"
                required
              />
              <DateControl
                form={form}
                name={"effectiveDate" as never}
                label="Prise d'effet"
                required
              />
            </FieldGrid>

            <TextareaControl
              form={form}
              name={"reason" as never}
              label="Motif"
              required
              rows={2}
            />

            <CheckboxControl
              form={form}
              name={"createDestinationContract" as never}
              label="Ouvrir un contrat dans la filiale de destination"
            />

            <SelectControl
              form={form}
              name={"contractType" as never}
              label="Type des contrats d'arrivée"
              options={CONTRACT_TYPE_OPTIONS}
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
              <SubmitButton pending={pending}>
                Créer les demandes
              </SubmitButton>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ==========================================================================
 * Reject
 * ========================================================================== */

export function RejectTransferDialog({
  firmSlug,
  transfer,
  onClose,
}: {
  firmSlug: string
  transfer: { id: string; employeeName: string }
  onClose: () => void
}) {
  const router = useRouter()
  const form = useForm({
    resolver: zodResolver(rejectTransferSchema) as never,
    defaultValues: { firmSlug, id: transfer.id, rejectionReason: "" } as never,
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    rejectTransfer as never,
    {
      success: "Transfert refusé.",
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
          <DialogTitle>Refuser le transfert</DialogTitle>
          <DialogDescription>
            {transfer.employeeName} restera dans sa filiale actuelle. Le motif
            est visible par la filiale d&apos;origine.
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

/* ==========================================================================
 * The one-click steps
 * ========================================================================== */

const STEP_SUCCESS = {
  approve: "Transfert approuvé.",
  complete: "Transfert finalisé.",
  cancel: "Transfert annulé.",
} as const

const STEP_PENDING = {
  approve: "Approbation…",
  complete: "Finalisation…",
  cancel: "Annulation…",
} as const

export function TransferStepButton({
  firmSlug,
  transferId,
  step,
  label,
  tone = "default",
}: {
  firmSlug: string
  transferId: string
  step: "approve" | "complete" | "cancel"
  label: string
  tone?: "default" | "primary" | "quiet"
}) {
  // The three steps return different payloads and this button uses none of
  // them, so the shared type is widened rather than unioned.
  const action: (input: {
    firmSlug: string
    id: string
  }) => Promise<ActionResult<unknown>> =
    step === "approve"
      ? approveTransfer
      : step === "complete"
        ? completeTransfer
        : cancelTransfer

  const { run, pending, error } = useAction(action, {
    success: STEP_SUCCESS[step],
  })

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => run({ firmSlug, id: transferId })}
        disabled={pending}
        className={
          tone === "primary"
            ? "inline-flex h-7 items-center gap-1.5 rounded-[7px] bg-ink px-2.5 text-[12px] font-medium text-paper disabled:opacity-50"
            : tone === "quiet"
              ? "inline-flex h-7 items-center gap-1.5 rounded-[7px] px-2 text-[12px] text-ink-3 hover:text-ink disabled:opacity-50"
              : "inline-flex h-7 items-center gap-1.5 rounded-[7px] border border-line bg-surface px-2.5 text-[12px] hover:bg-sub disabled:opacity-50"
        }
      >
        {pending ? STEP_PENDING[step] : label}
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
