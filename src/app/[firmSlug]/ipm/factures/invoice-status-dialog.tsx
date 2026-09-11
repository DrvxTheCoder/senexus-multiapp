"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import { FieldGrid, SelectControl, TextControl } from "@/components/forms/controls"
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
import { formatCurrency } from "@/lib/format"
import { setInvoiceStatusSchema } from "@/lib/forms/ipm-schemas"
import { setInvoiceStatus } from "@/server/actions/ipm-ledger"

const STATUS_OPTIONS = [
  { value: "DRAFT", label: "Brouillon" },
  { value: "ISSUED", label: "Émise" },
  { value: "PARTIALLY_PAID", label: "Partiellement réglée" },
  { value: "PAID", label: "Réglée" },
  { value: "CANCELLED", label: "Annulée" },
] as const

const METHOD_OPTIONS = [
  { value: "Virement", label: "Virement" },
  { value: "Chèque", label: "Chèque" },
  { value: "Espèces", label: "Espèces" },
  { value: "Orange Money", label: "Orange Money" },
] as const

/**
 * Statut et règlement d'une facture employeur.
 *
 * This replaced a `<select>` sitting in the table row, which marked an invoice
 * fully paid the instant somebody brushed the arrow keys over it — no amount,
 * no mode de règlement, no référence, and no chance to reconsider.
 *
 * "En retard" is deliberately absent from the choices: it is derived from the
 * due date, not set by hand. A row does not become overdue because somebody
 * wrote to it; it becomes overdue because a date passed.
 */
export function InvoiceStatusDialog({
  firmSlug,
  invoice,
  onClose,
}: {
  firmSlug: string
  invoice: {
    id: string
    number: string
    employerName: string
    status: string
    totalAmount: number
    paidAmount: number
  }
  onClose: () => void
}) {
  const form = useForm({
    resolver: zodResolver(setInvoiceStatusSchema) as never,
    defaultValues: {
      firmSlug,
      invoiceId: invoice.id,
      // OVERDUE is derived; offering it back as the current value would let it
      // be written by hand through the very field that must not own it.
      status: invoice.status === "OVERDUE" ? "ISSUED" : invoice.status,
      paidAmount: invoice.paidAmount ? String(invoice.paidAmount) : "",
      paymentMethod: "",
      paymentReference: "",
    } as never,
  })

  const status = form.watch("status" as never) as unknown as string
  const settling = status === "PAID" || status === "PARTIALLY_PAID"

  // Marking it réglée means the whole total, so the figure is filled in rather
  // than left for the user to retype — and stays editable if it was short.
  React.useEffect(() => {
    if (status !== "PAID") return
    form.setValue("paidAmount" as never, String(invoice.totalAmount) as never)
  }, [status, form, invoice.totalAmount])

  const { submit, pending, message, tone } = useActionForm(
    form,
    (async (values: Record<string, unknown>) =>
      setInvoiceStatus(values as never)) as never,
    { success: "Facture mise à jour.", onSuccess: onClose }
  )

  const remaining = invoice.totalAmount - invoice.paidAmount

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(560px,calc(100%-2rem))] max-w-none sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Facture {invoice.number}</DialogTitle>
          <DialogDescription>
            {invoice.employerName} — {formatCurrency(invoice.totalAmount)}
            {remaining > 0 && invoice.paidAmount > 0
              ? `, dont ${formatCurrency(remaining)} restant dû`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <SelectControl
            form={form}
            name={"status" as never}
            label="Statut"
            options={STATUS_OPTIONS}
          />

          {settling ? (
            <FieldGrid columns={2}>
              <TextControl
                form={form}
                name={"paidAmount" as never}
                label="Montant réglé"
                hint="En francs CFA."
              />
              <SelectControl
                form={form}
                name={"paymentMethod" as never}
                label="Mode de règlement"
                options={METHOD_OPTIONS}
                placeholder="Non précisé"
              />
              <TextControl
                form={form}
                name={"paymentReference" as never}
                label="Référence"
                hint="N° de chèque, de virement ou de transaction."
                className="col-span-2"
              />
            </FieldGrid>
          ) : null}

          <p className="text-[12px] text-ink-3">
            Le changement est enregistré avec votre nom et l&apos;horodatage :
            un règlement sans trace de qui l&apos;a saisi n&apos;a pas de valeur
            probante.
          </p>

          <FormMessage tone={tone}>{message}</FormMessage>

          <DialogFooter>
            <SubmitButton pending={pending}>Enregistrer</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
