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
import { createClientSchema, updateClientSchema } from "@/lib/forms/hr-schemas"
import { archiveClient, createClient, updateClient } from "@/server/actions/clients"

/**
 * Client dialogs.
 *
 * There is no delete, and the archive dialog says why: a client is referenced
 * by contracts, by employees' assignments and by the rows that define what a
 * responsable can see. `ARCHIVED` is the end state.
 */

export const CLIENT_STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Actif" },
  { value: "PROSPECT", label: "Prospect" },
  { value: "INACTIVE", label: "Inactif" },
  { value: "ARCHIVED", label: "Archivé" },
] as const

export type ClientDefaults = {
  id: string
  name: string
  status: string
  contactName: string
  contactEmail: string
  contactPhone: string
  taxNumber: string
  industry: string
  address: string
  contractStartDate: string
  contractEndDate: string
  notes: string
}

export function ClientDialog({
  firmSlug,
  client,
  onClose,
}: {
  firmSlug: string
  client: ClientDefaults | null
  onClose: () => void
}) {
  const router = useRouter()
  const isEdit = client !== null

  const form = useForm({
    resolver: zodResolver(
      isEdit ? updateClientSchema : createClientSchema
    ) as never,
    defaultValues: (client
      ? { firmSlug, ...client }
      : {
          firmSlug,
          name: "",
          status: "PROSPECT",
          contactName: "",
          contactEmail: "",
          contactPhone: "",
          taxNumber: "",
          industry: "",
          address: "",
          contractStartDate: "",
          contractEndDate: "",
          notes: "",
        }) as never,
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    (async (values: Record<string, unknown>) =>
      isEdit
        ? updateClient({ ...values, id: client.id } as never)
        : createClient(values as never)) as never,
    {
      onSuccess: () => {
        onClose()
        router.refresh()
      },
    }
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92svh] w-[min(660px,calc(100%-2rem))] max-w-none overflow-y-auto sm:max-w-none">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Modifier le client" : "Nouveau client"}</DialogTitle>
          <DialogDescription>
            Le client détermine aussi la visibilité : un responsable ne voit que
            les employés affectés aux clients qui lui sont assignés.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <FieldGrid>
            <TextControl
              form={form}
              name={"name" as never}
              label="Nom"
              required
              autoFocus
            />
            <SelectControl
              form={form}
              name={"status" as never}
              label="Statut"
              required
              options={CLIENT_STATUS_OPTIONS}
            />
            <TextControl form={form} name={"contactName" as never} label="Contact" />
            <TextControl
              form={form}
              name={"contactEmail" as never}
              label="Email du contact"
              type="email"
            />
            <TextControl
              form={form}
              name={"contactPhone" as never}
              label="Téléphone"
              type="tel"
            />
            <TextControl
              form={form}
              name={"taxNumber" as never}
              label="NINEA / n° fiscal"
              mono
            />
            <TextControl form={form} name={"industry" as never} label="Secteur" />
            <div />
            <DateControl
              form={form}
              name={"contractStartDate" as never}
              label="Début de collaboration"
            />
            <DateControl
              form={form}
              name={"contractEndDate" as never}
              label="Fin de collaboration"
            />
          </FieldGrid>

          <TextareaControl
            form={form}
            name={"address" as never}
            label="Adresse"
            rows={2}
          />
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
              {isEdit ? "Enregistrer" : "Créer le client"}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* -------------------------------------------------------------------------- */

export function ArchiveClientDialog({
  firmSlug,
  client,
  onClose,
}: {
  firmSlug: string
  client: { id: string; name: string }
  onClose: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Archiver {client.name}</DialogTitle>
          <DialogDescription>
            Un client n&apos;est jamais supprimé : contrats, affectations et
            historique le référencent. L&apos;archivage le retire des listes de
            sélection sans toucher au passé, et il est refusé tant qu&apos;un
            employé ou un contrat actif y est rattaché.
          </DialogDescription>
        </DialogHeader>

        {error ? <FormMessage>{error}</FormMessage> : null}

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-[7px] border border-line bg-surface px-3 text-[13px] hover:bg-sub"
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null)
              startTransition(async () => {
                const result = await archiveClient({ firmSlug, id: client.id })
                if (!result.ok) {
                  setError(result.message)
                  return
                }
                onClose()
                router.refresh()
              })
            }}
            className="h-9 rounded-[7px] bg-alert px-3 text-[13px] font-medium text-white disabled:opacity-50"
          >
            {pending ? "Archivage…" : "Archiver"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
