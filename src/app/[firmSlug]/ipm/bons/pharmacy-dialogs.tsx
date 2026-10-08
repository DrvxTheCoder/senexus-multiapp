"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import { TextareaControl, TextControl } from "@/components/forms/controls"
import { DangerButton, FormMessage, SubmitButton } from "@/components/forms/form-field"
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
import { voidVoucherSchema, voucherAmountSchema } from "@/lib/forms/ipm-schemas"
import {
  adjustVoucherAmount,
  previewVoucherAmount,
  validateVoucherAmount,
  voidPharmacyVoucher,
} from "@/server/actions/ipm-pharmacy"
import { formatRate } from "@/server/domain/ipm/rates"

/**
 * Bon de pharmacie — the gestionnaire's three acts: enter the amount for a
 * pharmacy that does not use the portal, correct a validated amount, void the
 * bon. Each one takes a reason, and each one reaches the participant's
 * balance, the pharmacy's list and the invoice through the same server
 * function as a validation at the counter.
 *
 * The split is previewed as the amount is typed, by the same pricing the
 * write uses — taux frozen on the bon, plafond remaining — so what is shown
 * before confirming is what gets written.
 */

type Preview = {
  amount: number
  ipmShare: number
  participantShare: number
  rate: number
  remainingCeiling: number | null
  flags: string[]
}

export function VoucherAmountDialog({
  firmSlug,
  voucher,
  mode,
  onClose,
}: {
  firmSlug: string
  voucher: { id: string; number: string; totalAmount: number | null }
  mode: "validate" | "adjust"
  onClose: () => void
}) {
  const router = useRouter()
  const form = useForm({
    resolver: zodResolver(voucherAmountSchema) as never,
    defaultValues: {
      firmSlug,
      voucherId: voucher.id,
      amount: (voucher.totalAmount ?? "") as never,
      reason: "",
    } as never,
  })

  const action = mode === "validate" ? validateVoucherAmount : adjustVoucherAmount
  const { submit, pending, message, tone } = useActionForm(
    form,
    (async (values: Record<string, unknown>) => action(values as never)) as never,
    {
      success: mode === "validate" ? "Montant validé." : "Montant corrigé.",
      onSuccess: () => {
        onClose()
        router.refresh()
      },
    }
  )

  // `useWatch`, not `form.watch`: the subscription the React Compiler can keep.
  const typed = useWatch({ control: form.control, name: "amount" as never }) as unknown
  const [preview, setPreview] = React.useState<{ data: Preview | null; error: string | null }>({
    data: null,
    error: null,
  })

  React.useEffect(() => {
    const amount = Number(typed)
    if (!Number.isInteger(amount) || amount <= 0) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const result = await previewVoucherAmount({ firmSlug, voucherId: voucher.id, amount })
      if (cancelled) return
      setPreview(
        result.ok ? { data: result.data, error: null } : { data: null, error: result.message }
      )
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [typed, firmSlug, voucher.id])

  const amountValid = Number.isInteger(Number(typed)) && Number(typed) > 0

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(520px,calc(100%-2rem))] max-w-none sm:max-w-none">
        <DialogHeader>
          <DialogTitle>
            {mode === "validate" ? "Saisir le montant" : "Corriger le montant"} — {voucher.number}
          </DialogTitle>
          <DialogDescription>
            {mode === "validate"
              ? "À la place de la pharmacie, sur la foi de son reçu. Le bon compte dès la validation : plafond, solde du participant, facture du prestataire."
              : "Le nouveau montant remplace l'ancien partout : solde du participant, liste et total du prestataire, facture non encore approuvée. L'ancien reste dans l'historique."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <TextControl
            form={form}
            name={"amount" as never}
            label="Montant global (FCFA)"
            type="number"
            required
            autoFocus
          />

          <div className="rounded-[7px] border border-line bg-sub px-3 py-2 text-[12.5px]">
            {amountValid && preview.data ? (
              <dl className="space-y-1">
                <div className="flex justify-between">
                  <dt className="text-ink-3">Part IPM ({formatRate(preview.data.rate)})</dt>
                  <dd className="num font-semibold">{formatCurrency(preview.data.ipmShare)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-3">Reste à charge participant</dt>
                  <dd className="num">{formatCurrency(preview.data.participantShare)}</dd>
                </div>
                {preview.data.remainingCeiling !== null ? (
                  <div className="flex justify-between">
                    <dt className="text-ink-3">Plafond restant</dt>
                    <dd className="num">{formatCurrency(preview.data.remainingCeiling)}</dd>
                  </div>
                ) : null}
                {preview.data.flags.includes("CEILING_CAPPED") ? (
                  <p className="pt-1 text-signal">
                    Part IPM limitée au plafond restant : le participant paie la différence.
                  </p>
                ) : null}
                {preview.data.flags.includes("AMOUNT_ABOVE_THRESHOLD") ? (
                  <p className="pt-1 text-signal">
                    Au-dessus du seuil de revue : le bon sera signalé.
                  </p>
                ) : null}
              </dl>
            ) : amountValid && preview.error ? (
              <p className="text-alert">{preview.error}</p>
            ) : (
              <p className="text-ink-3">La répartition s&apos;affiche dès que le montant est saisi.</p>
            )}
          </div>

          <TextareaControl
            form={form}
            name={"reason" as never}
            label="Motif"
            rows={2}
            required
          />

          <FormMessage tone={tone}>{message}</FormMessage>

          <DialogFooter>
            <SubmitButton pending={pending}>
              {mode === "validate" ? "Valider le montant" : "Enregistrer la correction"}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function VoidPharmacyVoucherDialog({
  firmSlug,
  voucher,
  onClose,
}: {
  firmSlug: string
  voucher: { id: string; number: string; validated: boolean }
  onClose: () => void
}) {
  const router = useRouter()
  const form = useForm({
    resolver: zodResolver(voidVoucherSchema) as never,
    defaultValues: { firmSlug, voucherId: voucher.id, reason: "" } as never,
  })
  const { submit, pending, message, tone } = useActionForm(
    form,
    (async (values: Record<string, unknown>) => voidPharmacyVoucher(values as never)) as never,
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
            {voucher.validated
              ? "Le bon cesse de compter : son montant est repris au solde du participant, retiré du plafond, de la liste du prestataire et de la facture non encore approuvée."
              : "Le bon n'a pas encore de montant : rien n'est à reprendre. Son QR cesse d'être reconnu par la pharmacie."}
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
