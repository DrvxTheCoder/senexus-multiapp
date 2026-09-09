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
  TextControl,
  TextareaControl,
} from "@/components/forms/controls"
import { FormMessage, SubmitButton } from "@/components/forms/form-field"
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
  createContractSchema,
  renewContractSchema,
  terminateContractSchema,
  updateContractSchema,
} from "@/lib/forms/hr-schemas"
import {
  createContract,
  renewContract,
  terminateContract,
  updateContract,
} from "@/server/actions/contract-crud"

/**
 * Contract dialogs.
 *
 * Every one of them can be refused by the server for the same reason — the
 * 730-day ceiling — and that refusal is a sentence the user needs to read, not
 * a field error. `useActionForm` puts it above the buttons, and the message
 * names the remedy (requalification or transfer) rather than only the problem.
 */

const today = () => new Date().toISOString().slice(0, 10)

export type ContractDefaults = {
  id: string
  employeeId: string
  type: string
  startDate: string
  endDate: string
  clientId: string
  position: string
  salary: string
  workingHours: string
  trialPeriodEnd: string
  alertThreshold: number
  isAutoRenewal: boolean
  isVise: boolean
  notes: string
}

export function ContractDialog({
  firmSlug,
  contract,
  employees,
  clients,
  lockEmployee = false,
  onClose,
}: {
  firmSlug: string
  contract: ContractDefaults | null
  employees: { id: string; name: string; matricule: string }[]
  clients: { id: string; name: string }[]
  /**
   * On an employee record the subject is not in question, so the picker
   * renders as fixed text. The id still travels in the form, and the server
   * re-resolves it against the caller's firm either way.
   */
  lockEmployee?: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const isEdit = contract !== null

  const form = useForm({
    resolver: zodResolver(
      isEdit ? updateContractSchema : createContractSchema
    ) as never,
    defaultValues: (contract
      ? { firmSlug, ...contract }
      : {
          firmSlug,
          employeeId: employees[0]?.id ?? "",
          type: "INTERIM",
          startDate: today(),
          endDate: "",
          clientId: "",
          position: "",
          salary: "",
          workingHours: "",
          trialPeriodEnd: "",
          alertThreshold: 30,
          isAutoRenewal: false,
          isVise: false,
          notes: "",
        }) as never,
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    (async (values: Record<string, unknown>) =>
      isEdit
        ? updateContract({ ...values, id: contract.id } as never)
        : createContract(values as never)) as never,
    {
      success: isEdit ? "Contrat modifié." : "Contrat créé.",
      onSuccess: () => {
        onClose()
        router.refresh()
      },
    }
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92svh] w-[min(680px,calc(100%-2rem))] max-w-none overflow-y-auto sm:max-w-none">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Modifier le contrat" : "Nouveau contrat"}
          </DialogTitle>
          <DialogDescription>
            Un contrat d&apos;intérim est refusé s&apos;il porte le cumul de
            l&apos;employé au-delà de 730 jours dans cette entreprise.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          {lockEmployee ? (
            <div className="rounded-[7px] border border-line bg-sub px-2.5 py-2 text-[13px]">
              <span className="text-ink-3">Employé — </span>
              {employees[0]?.name}{" "}
              <span className="mono text-ink-3">{employees[0]?.matricule}</span>
            </div>
          ) : (
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
          )}

          <FieldGrid>
            <SelectControl
              form={form}
              name={"type" as never}
              label="Type"
              required
              options={CONTRACT_TYPE_OPTIONS}
            />
            <SelectControl
              form={form}
              name={"clientId" as never}
              label="Client"
              options={clients.map((client) => ({
                value: client.id,
                label: client.name,
              }))}
              placeholder="Aucun"
            />
            <DateControl
              form={form}
              name={"startDate" as never}
              label="Début"
              required
            />
            <DateControl
              form={form}
              name={"endDate" as never}
              label="Fin"
              hint="Vide pour une durée indéterminée."
            />
            <TextControl form={form} name={"position" as never} label="Poste" />
            <TextControl
              form={form}
              name={"salary" as never}
              label="Salaire (FCFA)"
            />
            <TextControl
              form={form}
              name={"workingHours" as never}
              label="Heures hebdomadaires"
              type="number"
            />
            <DateControl
              form={form}
              name={"trialPeriodEnd" as never}
              label="Fin de période d'essai"
            />
            <TextControl
              form={form}
              name={"alertThreshold" as never}
              label="Alerte avant échéance (jours)"
              type="number"
            />
          </FieldGrid>

          <div className="flex flex-wrap gap-4">
            <CheckboxControl
              form={form}
              name={"isVise" as never}
              label="Visé par l'inspection du travail"
            />
            <CheckboxControl
              form={form}
              name={"isAutoRenewal" as never}
              label="Renouvellement automatique"
            />
          </div>

          <TextareaControl
            form={form}
            name={"notes" as never}
            label="Notes"
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
            <SubmitButton pending={pending}>
              {isEdit ? "Enregistrer" : "Créer le contrat"}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* -------------------------------------------------------------------------- */

export function TerminateContractDialog({
  firmSlug,
  contract,
  onClose,
}: {
  firmSlug: string
  contract: { id: string; employeeName: string }
  onClose: () => void
}) {
  const router = useRouter()
  const form = useForm({
    resolver: zodResolver(terminateContractSchema) as never,
    defaultValues: {
      firmSlug,
      id: contract.id,
      terminationDate: today(),
      terminationReason: "",
    } as never,
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    terminateContract as never,
    {
      success: "Contrat rompu.",
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
          <DialogTitle>Résilier le contrat</DialogTitle>
          <DialogDescription>
            La date de fin est ramenée à la résiliation, donc le cumul des 730
            jours s&apos;arrête ce jour-là. Si {contract.employeeName} n&apos;a
            plus aucun contrat actif, sa fiche passe en inactif.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <DateControl
            form={form}
            name={"terminationDate" as never}
            label="Date de résiliation"
            required
          />
          <TextareaControl
            form={form}
            name={"terminationReason" as never}
            label="Motif"
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
              Résilier
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* -------------------------------------------------------------------------- */

export function RenewContractDialog({
  firmSlug,
  contract,
  onClose,
}: {
  firmSlug: string
  contract: { id: string; employeeName: string; usedDays: number }
  onClose: () => void
}) {
  const router = useRouter()
  const form = useForm({
    resolver: zodResolver(renewContractSchema) as never,
    defaultValues: { firmSlug, id: contract.id, durationDays: 90 } as never,
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    renewContract as never,
    {
      success: "Contrat renouvelé.",
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
          <DialogTitle>Renouveler le contrat</DialogTitle>
          <DialogDescription>
            {contract.employeeName} cumule {contract.usedDays} jours
            d&apos;intérim dans cette entreprise. Le renouvellement est refusé
            s&apos;il franchit les 730.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <TextControl
            form={form}
            name={"durationDays" as never}
            label="Durée (jours)"
            type="number"
            required
            hint="Le nouveau contrat démarre le lendemain de l'échéance actuelle."
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
            <SubmitButton pending={pending}>Renouveler</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
