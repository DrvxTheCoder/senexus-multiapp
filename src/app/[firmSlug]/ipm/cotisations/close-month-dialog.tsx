"use client"

import * as React from "react"

import { useAction } from "@/components/forms/use-action"
import { selectTriggerClass } from "@/components/forms/form-field"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatCurrency, formatNumber } from "@/lib/format"
import { closeMonth } from "@/server/actions/ipm-ledger"

const MONTHS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
]

/**
 * Clôture d'une période.
 *
 * A dialog rather than two controls wedged into the panel header, because the
 * closing is the consequential act on this screen and it deserves to say what
 * it is about to do: one écriture de cotisation per participant actif, then
 * one facture per employeur.
 *
 * It is idempotent by construction — a participant already credited for the
 * period is skipped, and an existing facture is not reissued — so the dialog
 * says so instead of asking for a confirmation it does not need.
 */
export function CloseMonthDialog({
  firmSlug,
  activeMembers,
  monthlyDue,
  onClose,
}: {
  firmSlug: string
  activeMembers: number
  monthlyDue: number
  onClose: () => void
}) {
  const now = new Date()
  // The month just ended, not the one in progress: nobody closes a period
  // before it is over, and defaulting to the current month is a click nobody
  // wants to have to undo.
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const [year, setYear] = React.useState(previous.getFullYear())
  const [month, setMonth] = React.useState(previous.getMonth() + 1)

  const close = useAction(closeMonth, {
    loading: "Clôture en cours…",
    success: (data: { posted: number; invoiced: number; skipped: number }) =>
      `${formatNumber(data.posted)} cotisations portées, ${formatNumber(data.invoiced)} factures émises${
        data.skipped ? `, ${formatNumber(data.skipped)} période(s) déjà close` : ""
      }.`,
    onSuccess: onClose,
  })

  const years = Array.from({ length: 6 }, (_, index) => now.getFullYear() - 4 + index)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(520px,calc(100%-2rem))] max-w-none sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Clôturer une période</DialogTitle>
          <DialogDescription>
            Une écriture de cotisation par participant actif, puis une facture
            par employeur.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2.5">
            <label className="block">
              <span className="mb-1 block text-[12px] text-ink-3">Mois</span>
              <Select
                value={String(month)}
                onValueChange={(next) => setMonth(Number(next ?? month))}
                items={MONTHS.map((label, index) => ({
                  value: String(index + 1),
                  label,
                }))}
              >
                <SelectTrigger className={selectTriggerClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {MONTHS.map((label, index) => (
                      <SelectItem key={label} value={String(index + 1)}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[12px] text-ink-3">Exercice</span>
              <Select
                value={String(year)}
                onValueChange={(next) => setYear(Number(next ?? year))}
                items={years.map((value) => ({
                  value: String(value),
                  label: String(value),
                }))}
              >
                <SelectTrigger className={selectTriggerClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {years.map((value) => (
                      <SelectItem key={value} value={String(value)}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </label>
          </div>

          <dl className="rounded-[7px] border border-line bg-sub px-3 py-2.5 text-[12.5px]">
            <div className="flex items-baseline justify-between">
              <dt className="text-ink-3">Participants actifs</dt>
              <dd className="num font-medium">{formatNumber(activeMembers)}</dd>
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <dt className="text-ink-3">Cotisations attendues</dt>
              <dd className="num font-medium">{formatCurrency(monthlyDue)}</dd>
            </div>
          </dl>

          <p className="text-[12px] text-ink-3">
            La clôture est idempotente : un participant déjà crédité pour{" "}
            {MONTHS[month - 1]} {year} est ignoré, et une facture existante
            n&apos;est pas réémise. La relancer ne double rien.
          </p>

          {close.error ? (
            <p className="text-[12.5px] text-alert">{close.error}</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            disabled={close.pending}
            onClick={() => void close.run({ firmSlug, year, month })}
          >
            Clôturer {MONTHS[month - 1]} {year}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
