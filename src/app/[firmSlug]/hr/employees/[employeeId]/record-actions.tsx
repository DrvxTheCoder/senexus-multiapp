"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDataTransferHorizontalIcon,
  Delete02Icon,
  Edit02Icon,
  ShieldCheckIcon,
  Upload04Icon,
} from "@hugeicons/core-free-icons"

import {
  EmployeeDialog,
  type EmployeeDefaults,
  type EmployeeOption,
} from "@/app/[firmSlug]/hr/employees/employee-dialogs"
import {
  TransferDialog,
  type TransferClient,
  type TransferFirm,
} from "@/app/[firmSlug]/hr/transfers/transfer-dialogs"
import {
  DateControl,
  FileControl,
  SelectControl,
  TextControl,
} from "@/components/forms/controls"
import { FormMessage, SubmitButton } from "@/components/forms/form-field"
import { useActionForm } from "@/components/forms/use-action-form"
import { DOCUMENT_TYPE_LABELS } from "@/components/document-preview"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DOCUMENT_TYPES, uploadDocumentSchema } from "@/lib/forms/hr-schemas"
import {
  deleteDocument,
  uploadEmployeeDocument,
  verifyDocument,
} from "@/server/actions/documents"

/**
 * The record's own controls.
 *
 * The page stays a server component; only these are client-side. The edit
 * dialog opens from the header **or** from `?edit=1`, which is what the row
 * action on the list navigates to — the list carries too few fields to open the
 * wizard safely, so it sends you here where the whole record is loaded.
 */

const DOCUMENT_TYPE_OPTIONS = DOCUMENT_TYPES.map((type) => ({
  value: type,
  label: DOCUMENT_TYPE_LABELS[type] ?? type,
}))

export function RecordHeaderActions({
  firmSlug,
  employee,
  clients,
  departments,
  transferTargets,
  transferClients,
  canWrite,
}: {
  firmSlug: string
  employee: EmployeeDefaults & { name: string }
  clients: EmployeeOption[]
  departments: EmployeeOption[]
  transferTargets: TransferFirm[]
  transferClients: TransferClient[]
  canWrite: boolean
}) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const wantsEdit = searchParams.get("edit") === "1"

  const [dialog, setDialog] = React.useState<"edit" | "transfer" | null>(null)

  // `?edit=1` is a request from the list, not a piece of local state: it is
  // read during render and cleared from the URL when the dialog closes.
  const open = dialog ?? (wantsEdit ? "edit" : null)

  function close() {
    setDialog(null)
    if (wantsEdit) {
      const next = new URLSearchParams(searchParams.toString())
      next.delete("edit")
      router.replace(
        `/${firmSlug}/hr/employees/${employee.id}${next.size ? `?${next}` : ""}`
      )
    }
  }

  if (!canWrite) return null

  return (
    <div className="ml-auto flex shrink-0 items-center gap-1.5">
      {transferTargets.length > 0 ? (
        <button
          type="button"
          onClick={() => setDialog("transfer")}
          className="inline-flex h-[30px] items-center gap-1.5 rounded-[7px] border border-line bg-surface px-2.5 text-[12.5px] hover:bg-sub"
        >
          <HugeiconsIcon icon={ArrowDataTransferHorizontalIcon} size={13} />
          Transférer
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => setDialog("edit")}
        className="inline-flex h-[30px] items-center gap-1.5 rounded-[7px] bg-ink px-2.5 text-[12.5px] font-medium text-paper hover:opacity-90"
      >
        <HugeiconsIcon icon={Edit02Icon} size={13} />
        Modifier
      </button>

      {open === "edit" ? (
        <EmployeeDialog
          firmSlug={firmSlug}
          employee={employee}
          clients={clients}
          departments={departments}
          onClose={close}
        />
      ) : null}

      {open === "transfer" ? (
        <TransferDialog
          firmSlug={firmSlug}
          employee={{
            id: employee.id,
            name: employee.name,
            matricule: employee.matricule,
          }}
          firms={transferTargets}
          clients={transferClients}
          onClose={close}
        />
      ) : null}
    </div>
  )
}

/* ==========================================================================
 * Documents
 * ========================================================================== */

export function UploadDocumentButton({
  firmSlug,
  employeeId,
}: {
  firmSlug: string
  employeeId: string
}) {
  const [open, setOpen] = React.useState(false)
  const router = useRouter()

  const form = useForm({
    resolver: zodResolver(uploadDocumentSchema) as never,
    defaultValues: {
      firmSlug,
      employeeId,
      documentType: "CONTRACT",
      description: "",
      expiryDate: "",
    } as never,
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    uploadEmployeeDocument as never,
    {
      onSuccess: () => {
        setOpen(false)
        form.reset()
        router.refresh()
      },
    }
  )

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-[30px] items-center gap-1.5 rounded-[7px] bg-ink px-2.5 text-[12.5px] font-medium text-paper hover:opacity-90"
      >
        <HugeiconsIcon icon={Upload04Icon} size={13} />
        Déposer une pièce
      </button>

      {open ? (
        <Dialog open onOpenChange={(next) => !next && setOpen(false)}>
          <DialogContent className="w-[min(560px,calc(100%-2rem))] max-w-none sm:max-w-none">
            <DialogHeader>
              <DialogTitle>Déposer une pièce</DialogTitle>
              <DialogDescription>
                PDF, JPEG ou PNG, 2 Mo au maximum. Le fichier est servi par
                l&apos;application, jamais par une URL de stockage publique.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={submit} className="space-y-3">
              <FileControl
                form={form}
                name={"file" as never}
                label="Fichier"
                required
                accept="application/pdf,image/jpeg,image/png"
              />
              <SelectControl
                form={form}
                name={"documentType" as never}
                label="Type"
                required
                options={DOCUMENT_TYPE_OPTIONS}
              />
              <TextControl
                form={form}
                name={"description" as never}
                label="Description"
              />
              <DateControl
                form={form}
                name={"expiryDate" as never}
                label="Date d'expiration"
                hint="Une pièce expirée remonte dans les Décisions."
              />

              <FormMessage tone={tone}>{message}</FormMessage>

              <DialogFooter>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="h-9 rounded-[7px] border border-line bg-surface px-3 text-[13px] hover:bg-sub"
                >
                  Annuler
                </button>
                <SubmitButton pending={pending} pendingLabel="Envoi…">
                  Déposer
                </SubmitButton>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Verify and delete, next to a document.
 *
 * Deleting removes the stored file as well as the row — the legacy application
 * removed only the row, so every deleted document leaked its blob.
 */
export function DocumentActions({
  firmSlug,
  document,
  canVerify,
}: {
  firmSlug: string
  document: { id: string; isVerified: boolean; fileName: string }
  canVerify: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [confirming, setConfirming] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  if (!canVerify) return null

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        disabled={pending}
        title={document.isVerified ? "Retirer la vérification" : "Marquer vérifiée"}
        aria-label={
          document.isVerified
            ? `Retirer la vérification de ${document.fileName}`
            : `Marquer ${document.fileName} comme vérifiée`
        }
        onClick={() => {
          setError(null)
          startTransition(async () => {
            const result = await verifyDocument({
              firmSlug,
              id: document.id,
              isVerified: !document.isVerified,
            })
            if (!result.ok) {
              setError(result.message)
              return
            }
            router.refresh()
          })
        }}
        className={`grid size-7 place-items-center rounded-[7px] disabled:opacity-40 ${
          document.isVerified
            ? "text-ok hover:bg-ok-tint"
            : "text-ink-3 hover:bg-sunken hover:text-ink"
        }`}
      >
        <HugeiconsIcon icon={ShieldCheckIcon} size={14} strokeWidth={1.8} />
      </button>

      <button
        type="button"
        disabled={pending}
        title="Supprimer"
        aria-label={`Supprimer ${document.fileName}`}
        onClick={() => setConfirming(true)}
        className="grid size-7 place-items-center rounded-[7px] text-ink-3 hover:bg-alert-tint hover:text-alert disabled:opacity-40"
      >
        <HugeiconsIcon icon={Delete02Icon} size={14} strokeWidth={1.8} />
      </button>

      {error ? (
        <span role="alert" className="text-[11px] text-alert">
          {error}
        </span>
      ) : null}

      {confirming ? (
        <Dialog open onOpenChange={(next) => !next && setConfirming(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Supprimer la pièce</DialogTitle>
              <DialogDescription>
                {document.fileName} sera retirée de la fiche et le fichier
                supprimé du stockage. C&apos;est irréversible.
              </DialogDescription>
            </DialogHeader>
            {error ? <FormMessage>{error}</FormMessage> : null}
            <DialogFooter>
              <button
                type="button"
                onClick={() => setConfirming(false)}
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
                    const result = await deleteDocument({
                      firmSlug,
                      id: document.id,
                    })
                    if (!result.ok) {
                      setError(result.message)
                      return
                    }
                    setConfirming(false)
                    router.refresh()
                  })
                }}
                className="h-9 rounded-[7px] bg-alert px-3 text-[13px] font-medium text-white disabled:opacity-50"
              >
                {pending ? "Suppression…" : "Supprimer"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}
