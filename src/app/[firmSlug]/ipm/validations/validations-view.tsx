"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import { TextareaControl } from "@/components/forms/controls"
import { DangerButton, FormMessage } from "@/components/forms/form-field"
import { useAction } from "@/components/forms/use-action"
import { useActionForm } from "@/components/forms/use-action-form"
import { Panel } from "@/components/panel"
import { EmptyState, StatusPill, TagCode } from "@/components/primitives"
import { announceValidationsChanged } from "@/components/shell/validations-badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatCurrency, formatDate } from "@/lib/format"
import { rejectPortalVoucherSchema } from "@/lib/forms/ipm-schemas"
import {
  VOUCHER_STATUS_LABELS,
  VOUCHER_STATUS_TONES,
  VOUCHER_TYPE_LABELS,
} from "@/lib/queries/ipm/voucher-query"
import {
  acknowledgePortalVoucher,
  approvePortalVoucher,
  rejectPortalVoucher,
} from "@/server/actions/ipm-validations"
import { FLAG_LABELS } from "@/server/domain/ipm/portal-review"
import { formatRate } from "@/server/domain/ipm/rates"
import type { ReviewItem } from "@/server/queries/ipm/validations"

/**
 * La file de validation.
 *
 * Each bon is laid out the way the decision is taken: the receipt beside the
 * figures typed from it, the reasons it was held in plain words, and the
 * beneficiary's recent bons in the same category — "is this usual for them?"
 * is the question every flag is really asking.
 */

const FLAGS: Record<string, string> = FLAG_LABELS

const timeFormat = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
})

export function ValidationsView({
  firmSlug,
  pending,
  toVerify,
}: {
  firmSlug: string
  pending: ReviewItem[]
  toVerify: ReviewItem[]
}) {
  const [enlarged, setEnlarged] = React.useState<ReviewItem | null>(null)
  const [rejecting, setRejecting] = React.useState<ReviewItem | null>(null)

  const approve = useAction(approvePortalVoucher, {
    success: "Bon validé. Le participant est prévenu.",
    onSuccess: announceValidationsChanged,
  })
  const acknowledge = useAction(acknowledgePortalVoucher, {
    success: "Bon marqué comme vu.",
    onSuccess: announceValidationsChanged,
  })

  return (
    <div className="space-y-4">
      <Panel
        title={`En attente${pending.length ? ` · ${pending.length}` : ""}`}
        description="Au-dessus du seuil ou avec un avertissement : le bon ne circule pas tant qu'il n'est pas validé. Sa part est déjà réservée sur le plafond."
        padded={false}
      >
        {pending.length === 0 ? (
          <EmptyState
            title="Aucun bon en attente"
            description="Les bons soumis depuis le portail au-dessus du seuil de validation apparaîtront ici."
          />
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {pending.map((item) => (
              <ReviewCard
                key={item.id}
                firmSlug={firmSlug}
                item={item}
                onEnlarge={() => setEnlarged(item)}
                actions={
                  <>
                    <Button
                      size="sm"
                      disabled={approve.pending}
                      onClick={() => approve.run({ firmSlug, voucherId: item.id })}
                    >
                      Valider
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setRejecting(item)}
                    >
                      Refuser
                    </Button>
                  </>
                }
              />
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title={`À vérifier${toVerify.length ? ` · ${toVerify.length}` : ""}`}
        description="Émis aussitôt, sous le seuil, mais signalés. Le bon circule déjà : il s'agit d'y jeter un œil."
        padded={false}
      >
        {toVerify.length === 0 ? (
          <EmptyState
            title="Rien à vérifier"
            description="Les bons émis depuis le portail avec un signalement apparaîtront ici jusqu'à ce qu'ils soient vus."
          />
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {toVerify.map((item) => (
              <ReviewCard
                key={item.id}
                firmSlug={firmSlug}
                item={item}
                onEnlarge={() => setEnlarged(item)}
                actions={
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={acknowledge.pending}
                    onClick={() => acknowledge.run({ firmSlug, voucherId: item.id })}
                  >
                    Marquer comme vu
                  </Button>
                }
              />
            ))}
          </ul>
        )}
      </Panel>

      {enlarged?.receiptUrl ? (
        <Dialog open onOpenChange={(open) => !open && setEnlarged(null)}>
          <DialogContent className="w-[min(720px,calc(100%-2rem))] max-w-none sm:max-w-none">
            <DialogHeader>
              <DialogTitle>Reçu du bon {enlarged.number}</DialogTitle>
              <DialogDescription>
                {enlarged.providerName} · total saisi {formatCurrency(enlarged.totalAmount)}
                {enlarged.ocrTotal !== null
                  ? ` · lu sur le reçu ${formatCurrency(enlarged.ocrTotal)}`
                  : ""}
              </DialogDescription>
            </DialogHeader>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={enlarged.receiptUrl}
              alt={`Reçu du bon ${enlarged.number}`}
              className="max-h-[70vh] w-full rounded-[7px] border border-line object-contain"
            />
            <DialogFooter>
              <a
                href={enlarged.receiptUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[12.5px] text-brand hover:underline"
              >
                Ouvrir dans un nouvel onglet
              </a>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {rejecting ? (
        <RejectDialog
          firmSlug={firmSlug}
          item={rejecting}
          onClose={() => setRejecting(null)}
        />
      ) : null}
    </div>
  )
}

function ReviewCard({
  firmSlug,
  item,
  onEnlarge,
  actions,
}: {
  firmSlug: string
  item: ReviewItem
  onEnlarge: () => void
  actions: React.ReactNode
}) {
  return (
    <li className="grid gap-4 px-[15px] py-4 lg:grid-cols-[96px_minmax(0,1fr)_minmax(0,320px)]">
      <Receipt item={item} onEnlarge={onEnlarge} />

      <div className="min-w-0 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <TagCode>{item.number}</TagCode>
          <span className="text-[12px] text-ink-3">
            {VOUCHER_TYPE_LABELS[item.type as keyof typeof VOUCHER_TYPE_LABELS] ?? item.type}
            {" · soumis le "}
            {timeFormat.format(new Date(item.createdAt))}
            {item.entryMode === "SCAN" ? " · reçu scanné" : " · saisie manuelle"}
          </span>
        </div>

        <div>
          <p className="text-[14px] font-semibold">{item.beneficiaryName}</p>
          <p className="text-[12.5px] text-ink-3">
            <Link
              href={`/${firmSlug}/ipm/participants/${item.memberId}`}
              className="text-brand hover:underline"
            >
              {item.memberMatricule}
            </Link>
            {" · "}
            {item.providerName}
            {" · "}
            {item.serviceTypeLabel} ({item.categoryLabel})
          </p>
        </div>

        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px]">
          <Figure label="Total" value={formatCurrency(item.totalAmount)} strong />
          <Figure label="Part IPM" value={formatCurrency(item.insurerShare)} />
          <Figure label="Ticket" value={formatCurrency(item.memberShare)} />
          <Figure label="Taux" value={formatRate(item.appliedRate)} />
          {item.ocrTotal !== null ? (
            <Figure label="Lu sur le reçu" value={formatCurrency(item.ocrTotal)} />
          ) : null}
        </dl>

        {item.flags.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {item.flags.map((flag) => (
              <li key={flag}>
                <StatusPill tone={flag === "ABOVE_THRESHOLD" ? "signal" : "alert"} dot>
                  {FLAGS[flag] ?? flag}
                </StatusPill>
              </li>
            ))}
          </ul>
        ) : null}

        <details className="text-[12.5px]">
          <summary className="cursor-pointer text-ink-3 hover:text-ink">
            {item.lines.length} ligne{item.lines.length > 1 ? "s" : ""}
          </summary>
          <table className="mt-1.5 w-full">
            <tbody>
              {item.lines.map((line) => (
                <tr key={line.id} className="border-b border-line last:border-0">
                  <td className="py-1 pr-3">{line.label}</td>
                  <td className="num py-1 pr-3 text-right text-ink-3">
                    {line.quantity} × {formatCurrency(line.unitPrice)}
                  </td>
                  <td className="num py-1 text-right">{formatCurrency(line.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>

        <div className="flex flex-wrap gap-2 pt-1">{actions}</div>
      </div>

      <History item={item} />
    </li>
  )
}

function Receipt({ item, onEnlarge }: { item: ReviewItem; onEnlarge: () => void }) {
  if (!item.receiptUrl) {
    return (
      <div className="grid h-32 w-24 place-items-center rounded-[7px] border border-dashed border-line px-2 text-center text-[11px] text-ink-3">
        Reçu indisponible
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onEnlarge}
      className="h-32 w-24 overflow-hidden rounded-[7px] border border-line bg-sub transition-shadow hover:shadow-md"
      aria-label={`Agrandir le reçu du bon ${item.number}`}
    >
      {/* A plain <img>, as for participant photos: the Zipline host comes from
          an environment variable and cannot be allow-listed at build time. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={item.receiptUrl} alt="" className="h-full w-full object-cover object-top" />
    </button>
  )
}

function History({ item }: { item: ReviewItem }) {
  return (
    <div className="min-w-0 rounded-[7px] border border-line">
      <p className="border-b border-line bg-sub px-3 py-1.5 text-[11.5px] text-ink-3">
        Derniers bons · {item.categoryLabel}
      </p>
      {item.history.length === 0 ? (
        <p className="px-3 py-3 text-[12px] text-ink-3">
          Premier bon de ce bénéficiaire dans cette catégorie.
        </p>
      ) : (
        <table className="w-full text-[12px]">
          <tbody>
            {item.history.map((row) => (
              <tr key={row.id} className="border-b border-line last:border-0">
                <td className="px-3 py-1.5">
                  <span className="font-mono text-[11.5px]">{row.number}</span>
                  <span className="block text-[11px] text-ink-3">
                    {formatDate(row.issueDate)} · {row.providerName}
                  </span>
                </td>
                <td className="num px-2 py-1.5 text-right">{formatCurrency(row.totalAmount)}</td>
                <td className="px-2 py-1.5 text-right">
                  <StatusPill
                    tone={
                      VOUCHER_STATUS_TONES[row.status as keyof typeof VOUCHER_STATUS_TONES] ??
                      "muted"
                    }
                  >
                    {VOUCHER_STATUS_LABELS[row.status as keyof typeof VOUCHER_STATUS_LABELS] ??
                      row.status}
                  </StatusPill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
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
    <div>
      <dt className="text-[11px] text-ink-3">{label}</dt>
      <dd className={strong ? "num font-semibold" : "num"}>{value}</dd>
    </div>
  )
}

function RejectDialog({
  firmSlug,
  item,
  onClose,
}: {
  firmSlug: string
  item: ReviewItem
  onClose: () => void
}) {
  const router = useRouter()
  const form = useForm({
    resolver: zodResolver(rejectPortalVoucherSchema) as never,
    defaultValues: { firmSlug, voucherId: item.id, reason: "" } as never,
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    (async (values: Record<string, unknown>) =>
      rejectPortalVoucher(values as never)) as never,
    {
      success: "Bon refusé. Le participant est prévenu.",
      onSuccess: () => {
        onClose()
        announceValidationsChanged()
        router.refresh()
      },
    }
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(520px,calc(100%-2rem))] max-w-none sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Refuser le bon {item.number}</DialogTitle>
          <DialogDescription>
            Le participant voit ce motif sur le portail. La part réservée (
            {formatCurrency(item.insurerShare)}) est rendue au plafond et le QR
            du bon cesse de vérifier.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <TextareaControl
            form={form}
            name={"reason" as never}
            label="Motif du refus"
            rows={3}
            placeholder="Ex. : le montant saisi ne correspond pas au reçu."
            required
          />
          <FormMessage tone={tone}>{message}</FormMessage>
          <DialogFooter>
            <DangerButton pending={pending}>Refuser le bon</DangerButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
