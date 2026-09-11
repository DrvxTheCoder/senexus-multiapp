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
import { cancelVoucherSchema } from "@/lib/forms/ipm-schemas"
import { cancelVoucher } from "@/server/actions/ipm-vouchers"

/**
 * Annulation d'un bon.
 *
 * A real dialog rather than `window.prompt`, which this screen used to call.
 * The browser prompt cannot be styled, cannot be dismissed with the keyboard
 * the way the rest of the application can, gives no field-level validation and
 * renders the product's chrome irrelevant — and a cancellation is a
 * consequential act: it releases the plafond the bon was holding and rotates
 * its QR so a printed copy stops verifying.
 *
 * The motif is required by the schema, so an empty reason is refused with a
 * message on the field instead of silently cancelling nothing.
 */
export function CancelVoucherDialog({
  firmSlug,
  voucher,
  onClose,
}: {
  firmSlug: string
  voucher: { id: string; number: string }
  onClose: () => void
}) {
  const router = useRouter()

  const form = useForm({
    resolver: zodResolver(cancelVoucherSchema) as never,
    defaultValues: {
      firmSlug,
      voucherId: voucher.id,
      reason: "",
    } as never,
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    (async (values: Record<string, unknown>) =>
      cancelVoucher(values as never)) as never,
    {
      success: "Bon annulé.",
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
          <DialogTitle>Annuler le bon {voucher.number}</DialogTitle>
          <DialogDescription>
            Le bon reste consultable avec son motif. La part IPM qu&apos;il
            retenait est rendue au plafond, et son QR cesse de vérifier — une
            copie déjà imprimée ne sera plus reconnue au comptoir.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <TextareaControl
            form={form}
            name={"reason" as never}
            label="Motif de l'annulation"
            rows={3}
            required
          />

          <FormMessage tone={tone}>{message}</FormMessage>

          <DialogFooter>
            <DangerButton pending={pending}>Annuler le bon</DangerButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
