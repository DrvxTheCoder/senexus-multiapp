"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { ComboboxField } from "@/components/forms/combobox-field"
import { DateField, SelectField } from "@/components/forms/controls"
import { Field, FormMessage, fieldProps, inputClass } from "@/components/forms/form-field"
import { useAction } from "@/components/forms/use-action"
import { EmptyState, StatusPill, TagCode } from "@/components/primitives"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatCurrency, formatDate, formatNumber } from "@/lib/format"
import {
  createDisbursementFromInvoice,
  generateProviderInvoice,
  previewProviderInvoice,
  type ProviderInvoicePreview,
} from "@/server/actions/ipm-disbursements"
import type { ProviderInvoiceRow } from "@/server/queries/ipm/disbursements"

/**
 * Éditer une facture, puis la régler.
 *
 * Two dialogs for the two halves of the flow the institution did not have: it
 * could only ever *receive* an invoice and look for the écart. Now it can bill
 * its own figures from the consommation constatée, and turn the result into a
 * bon de décaissement without retyping any of it.
 */

/* ==========================================================================
 * Éditer la facture
 * ========================================================================== */

/** The first and last day of the month before this one. */
function lastMonth(): { from: string; to: string } {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const to = new Date(now.getFullYear(), now.getMonth(), 0)
  const iso = (value: Date) =>
    `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(
      value.getDate()
    ).padStart(2, "0")}`
  return { from: iso(from), to: iso(to) }
}

export function GenerateInvoiceDialog({
  firmSlug,
  providers,
  onClose,
}: {
  firmSlug: string
  providers: { id: string; name: string; accountCode: string | null }[]
  onClose: () => void
}) {
  const router = useRouter()
  const period = React.useMemo(() => lastMonth(), [])

  const [providerId, setProviderId] = React.useState("")
  const [from, setFrom] = React.useState(period.from)
  const [to, setTo] = React.useState(period.to)

  /**
   * The answer, tagged with the question it answers.
   *
   * Storing the key alongside the result is what lets the render derive
   * "stale" instead of an effect having to clear state the moment the period
   * changes — a `setState` in an effect body cascades a render, and the
   * cleared-then-refilled panel flickers on every keystroke in the date field.
   * A result whose key no longer matches is simply not shown.
   */
  const [answer, setAnswer] = React.useState<{
    key: string
    data: ProviderInvoicePreview | null
    error: string | null
  } | null>(null)

  const generate = useAction(generateProviderInvoice, {
    success: (data) =>
      `Facture ${data.number} éditée — ${formatNumber(data.vouchers)} bons, ${formatCurrency(data.amount)}.`,
    onSuccess: () => {
      onClose()
      router.refresh()
    },
  })

  const askable = Boolean(providerId && from && to && to >= from)
  const key = `${providerId}|${from}|${to}`

  /**
   * The preview runs as the period changes, not on a button.
   *
   * Choosing a period is the whole decision, and an operator cannot make it
   * without seeing which bons it catches — the same reason the bon issuance
   * screen runs its pre-flight live rather than at submit. Debounced, so
   * dragging through a date picker does not fire one request per keystroke,
   * and an answer that arrives after the question changed is discarded by the
   * key rather than shown against the wrong period.
   */
  React.useEffect(() => {
    if (!askable) return

    let live = true
    const timer = setTimeout(async () => {
      const result = await previewProviderInvoice({
        firmSlug,
        providerId,
        periodFrom: from,
        periodTo: to,
      })
      if (!live) return
      setAnswer(
        result.ok
          ? { key, data: result.data, error: null }
          : { key, data: null, error: result.message }
      )
    }, 250)

    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [askable, firmSlug, providerId, from, to, key])

  const current = answer?.key === key ? answer : null
  const preview = current?.data ?? null
  const previewError = current?.error ?? null
  const loading = askable && current === null
  const empty = preview !== null && preview.lines.length === 0

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(680px,calc(100%-2rem))] max-w-none sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Éditer une facture prestataire</DialogTitle>
          <DialogDescription>
            La facture reprend les bons <b>réglés</b> chez ce prestataire sur la
            période et pas encore facturés. Son montant est la somme des parts
            IPM : il n&apos;y a rien à saisir.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <ComboboxField
            id="providerId"
            label="Prestataire"
            required
            value={providerId}
            onChange={setProviderId}
            options={providers.map((provider) => ({
              value: provider.id,
              label: provider.name,
              hint: provider.accountCode ?? undefined,
            }))}
            placeholder="Choisir un prestataire"
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <DateField
              id="periodFrom"
              label="Début de période"
              required
              value={from}
              onChange={setFrom}
            />
            <DateField
              id="periodTo"
              label="Fin de période"
              required
              value={to}
              onChange={setTo}
              error={to < from ? "La période se termine avant de commencer." : undefined}
            />
          </div>

          <div className="rounded-[9px] border border-line bg-sub p-3">
            {!providerId ? (
              <p className="text-[12.5px] text-ink-3">
                Choisissez un prestataire pour voir ce qui serait facturé.
              </p>
            ) : loading ? (
              <p className="text-[12.5px] text-ink-3">Calcul en cours…</p>
            ) : previewError ? (
              <p className="text-[12.5px] text-alert">{previewError}</p>
            ) : empty ? (
              <EmptyState
                title="Rien à facturer"
                description="Aucun bon réglé et non encore facturé chez ce prestataire sur cette période."
              />
            ) : preview ? (
              <>
                <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
                  <Figure
                    label="Net à facturer"
                    value={formatCurrency(preview.insurerShare)}
                    strong
                  />
                  <Figure
                    label="Montant des soins"
                    value={formatCurrency(preview.grossAmount)}
                  />
                  <Figure
                    label="Réglé au comptoir"
                    value={formatCurrency(preview.memberShare)}
                  />
                  <Figure
                    label="Bons"
                    value={formatNumber(preview.lines.length)}
                  />
                </div>

                <ul className="mt-2.5 max-h-44 overflow-y-auto border-t border-line">
                  {preview.lines.slice(0, 40).map((line) => (
                    <li
                      key={line.voucherNumber}
                      className="flex items-center gap-2 border-b border-line py-1.5 text-[12px] last:border-b-0"
                    >
                      <span className="num w-[62px] shrink-0 text-ink-3">
                        {formatDate(line.serviceDate)}
                      </span>
                      <TagCode>{line.voucherNumber}</TagCode>
                      <span className="min-w-0 flex-1 truncate">
                        {line.beneficiaryName}
                      </span>
                      <span className="num shrink-0 font-medium">
                        {formatCurrency(line.insurerShare)}
                      </span>
                    </li>
                  ))}
                </ul>

                {preview.lines.length > 40 ? (
                  <p className="mt-1.5 text-[11.5px] text-ink-3">
                    et {formatNumber(preview.lines.length - 40)} autres — toutes
                    figureront sur la facture.
                  </p>
                ) : null}
              </>
            ) : null}
          </div>

          <FormMessage tone="error">{generate.error}</FormMessage>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Annuler
          </Button>
          <Button
            size="sm"
            disabled={generate.pending || !preview || empty}
            onClick={() =>
              void generate.run({
                firmSlug,
                providerId,
                periodFrom: from,
                periodTo: to,
              })
            }
          >
            {generate.pending ? "Édition…" : "Éditer la facture"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Figure({
  label,
  value,
  strong,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <span className="flex flex-col">
      <span className="text-[11px] text-ink-3">{label}</span>
      <span
        className={`num ${strong ? "text-[17px] leading-none font-semibold" : "text-[13px]"}`}
      >
        {value}
      </span>
    </span>
  )
}

/* ==========================================================================
 * Convertir en bon de décaissement
 * ========================================================================== */

const JOURNALS = [
  { value: "B1", label: "B1 — Banque" },
  { value: "02", label: "02 — Caisse" },
  { value: "OM", label: "OM — Orange Money" },
]

const METHODS = [
  { value: "TRANSFER", label: "Virement" },
  { value: "CHEQUE", label: "Chèque" },
  { value: "CASH", label: "Espèces" },
  { value: "ORANGE_MONEY", label: "Orange Money" },
]

/**
 * Une facture approuvée devient un bon en un geste.
 *
 * The payee, the amount and the motif are not on this form, because they are
 * on the facture. What is asked for is only what the facture cannot know: the
 * journal the entry lands in, how it is paid and when.
 */
export function ConvertInvoiceDialog({
  firmSlug,
  invoice,
  onClose,
  onConverted,
}: {
  firmSlug: string
  invoice: ProviderInvoiceRow
  onClose: () => void
  onConverted?: () => void
}) {
  const router = useRouter()
  const [journalCode, setJournalCode] = React.useState("B1")
  const [paymentMethod, setPaymentMethod] = React.useState("TRANSFER")
  const [date, setDate] = React.useState(() =>
    new Date().toISOString().slice(0, 10)
  )
  const [reference, setReference] = React.useState("")

  const convert = useAction(createDisbursementFromInvoice, {
    success: (data) =>
      `Bon n° ${data.number} établi — ${formatCurrency(data.amount)}.`,
    onSuccess: () => {
      onClose()
      onConverted?.()
      router.refresh()
    },
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(560px,calc(100%-2rem))] max-w-none sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Établir le bon de décaissement</DialogTitle>
          <DialogDescription>
            Pour la facture {invoice.number} de {invoice.providerName}. Le
            bénéficiaire, le montant et le motif sont repris de la facture.
          </DialogDescription>
        </DialogHeader>

        <div className="mb-1 flex items-baseline gap-2.5 rounded-[7px] border border-line bg-sub px-3 py-2.5">
          <span className="num text-[19px] leading-none font-semibold">
            {formatCurrency(invoice.totalAmount)}
          </span>
          <StatusPill tone="brand">
            {formatDate(invoice.periodFrom)} → {formatDate(invoice.periodTo)}
          </StatusPill>
        </div>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              id="journalCode"
              label="Journal"
              required
              value={journalCode}
              onChange={setJournalCode}
              options={JOURNALS}
            />
            <SelectField
              id="paymentMethod"
              label="Mode de règlement"
              required
              value={paymentMethod}
              onChange={setPaymentMethod}
              options={METHODS}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <DateField
              id="date"
              label="Date du bon"
              required
              value={date}
              onChange={setDate}
            />
            <Field
              label="Référence de règlement"
              htmlFor="paymentReference"
              hint="N° de chèque ou de virement, si connu."
            >
              <input
                {...fieldProps("paymentReference")}
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                className={inputClass}
                placeholder="VIR-2026-0912"
              />
            </Field>
          </div>

          <FormMessage tone="error">{convert.error}</FormMessage>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Annuler
          </Button>
          <Button
            size="sm"
            disabled={convert.pending}
            onClick={() =>
              void convert.run({
                firmSlug,
                invoiceId: invoice.id,
                journalCode: journalCode as "B1" | "02" | "OM",
                date,
                paymentMethod: paymentMethod as
                  | "CHEQUE"
                  | "TRANSFER"
                  | "CASH"
                  | "ORANGE_MONEY",
                paymentReference: reference,
              })
            }
          >
            {convert.pending ? "Établissement…" : "Établir le bon"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
