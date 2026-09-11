"use client"

import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import { TextareaControl } from "@/components/forms/controls"
import { DangerButton, FormMessage } from "@/components/forms/form-field"
import { useActionForm } from "@/components/forms/use-action-form"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatCurrency } from "@/lib/format"
import {
  checkProviderInvoiceSchema,
  reviewReimbursementSchema,
} from "@/lib/forms/ipm-schemas"
import {
  checkProviderInvoice,
  reviewReimbursement,
} from "@/server/actions/ipm-disbursements"

/**
 * Rejets motivés.
 *
 * Both of these replaced a `window.prompt`. A browser prompt cannot show the
 * écart being disputed, cannot validate that a reason was actually given, and
 * looks nothing like the rest of the product — and rejecting a prestataire's
 * invoice is a letter somebody has to justify later.
 *
 * The reason is required by the schema rather than by the handler, so an empty
 * motif fails on the field, in the form, before anything is sent.
 */
export function RejectInvoiceDialog({
  firmSlug,
  invoice,
  onClose,
}: {
  firmSlug: string
  invoice: { id: string; number: string; providerName: string; variance: number }
  onClose: () => void
}) {
  const router = useRouter()

  const form = useForm({
    resolver: zodResolver(checkProviderInvoiceSchema) as never,
    defaultValues: {
      firmSlug,
      invoiceId: invoice.id,
      decision: "REJECTED",
      rejectReason: "",
    } as never,
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    (async (values: Record<string, unknown>) =>
      checkProviderInvoice(values as never)) as never,
    {
      success: "Facture rejetée.",
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
          <DialogTitle>
            Rejeter la facture {invoice.number}
          </DialogTitle>
          <DialogDescription>
            {invoice.providerName}
            {invoice.variance !== 0 ? (
              <>
                {" "}
                — écart de{" "}
                <span className="font-medium text-alert">
                  {invoice.variance > 0 ? "+" : ""}
                  {formatCurrency(invoice.variance)}
                </span>{" "}
                entre le montant réclamé et les bons rapprochés.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <TextareaControl
            form={form}
            name={"rejectReason" as never}
            label="Motif du rejet"
            rows={3}
            required
          />

          <FormMessage tone={tone}>{message}</FormMessage>

          <DialogFooter>
            <DangerButton pending={pending}>Rejeter la facture</DangerButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function RejectReimbursementDialog({
  firmSlug,
  reimbursement,
  onClose,
}: {
  firmSlug: string
  reimbursement: { id: string; number: string; memberName: string }
  onClose: () => void
}) {
  const router = useRouter()

  const form = useForm({
    resolver: zodResolver(reviewReimbursementSchema) as never,
    defaultValues: {
      firmSlug,
      reimbursementId: reimbursement.id,
      decision: "REJECTED",
      rejectReason: "",
    } as never,
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    (async (values: Record<string, unknown>) =>
      reviewReimbursement(values as never)) as never,
    {
      success: "Remboursement rejeté.",
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
          <DialogTitle>Rejeter {reimbursement.number}</DialogTitle>
          <DialogDescription>
            {reimbursement.memberName} — le motif est communiqué au
            participant, qui a payé de sa poche.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <TextareaControl
            form={form}
            name={"rejectReason" as never}
            label="Motif du rejet"
            rows={3}
            required
          />

          <FormMessage tone={tone}>{message}</FormMessage>

          <DialogFooter>
            <DangerButton pending={pending}>Rejeter la demande</DangerButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
