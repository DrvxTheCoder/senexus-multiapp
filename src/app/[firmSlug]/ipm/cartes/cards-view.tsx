"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { Refresh01Icon, ViewIcon } from "@hugeicons/core-free-icons"

import { useAction } from "@/components/forms/use-action"
import { Panel } from "@/components/panel"
import { EmptyState, SegmentedControl, StatusPill, TwoFacts } from "@/components/primitives"
import { formatDate, formatNumber } from "@/lib/format"
import { generateCard } from "@/server/actions/ipm"
import { CARD_STATE_LABELS, type CardState } from "@/server/domain/ipm/card"
import type { CardRow } from "@/server/queries/ipm/cards"

const STATE_TONES: Record<CardState, "ok" | "signal" | "alert" | "muted"> = {
  CURRENT: "ok",
  STALE: "alert",
  MISSING: "signal",
  REVOKED: "muted",
}

type Filter = "ALL" | "TODO"

/**
 * Cartes.
 *
 * The state of each card is computed from a digest of what it prints, so this
 * list answers "who needs a new card" without rendering a single image. That
 * is what makes the filter below useful rather than decorative: regenerating
 * is a physical act — somebody prints and hands over plastic — so the screen
 * is built around the queue of cards that are actually out of date.
 */
export function CardsView({
  firmSlug,
  cards,
  canWrite,
}: {
  firmSlug: string
  cards: CardRow[]
  canWrite: boolean
}) {
  const router = useRouter()
  const [filter, setFilter] = React.useState<Filter>("ALL")
  const [preview, setPreview] = React.useState<CardRow | null>(null)

  const { run, pending } = useAction(generateCard, {
    success: "Carte générée.",
    onSuccess: () => router.refresh(),
  })

  const todo = cards.filter(
    (card) => card.state === "STALE" || card.state === "MISSING"
  )
  const rows = filter === "TODO" ? todo : cards

  return (
    <>
      <Panel
        title="Cartes de tiers payant"
        description="54 × 85,6 mm, 300 ppi. Une carte est à regénérer dès que son contenu imprimé change."
        padded={false}
        stats={[
          { label: "Participants", value: formatNumber(cards.length) },
          {
            label: "À regénérer",
            value: formatNumber(todo.length),
            tone: todo.length > 0 ? "alert" : undefined,
          },
        ]}
        tools={
          <SegmentedControl
            ariaLabel="Filtrer les cartes"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "ALL", label: "Toutes" },
              { value: "TODO", label: `À faire (${todo.length})` },
            ]}
          />
        }
      >
        {rows.length === 0 ? (
          <EmptyState
            title={
              filter === "TODO"
                ? "Toutes les cartes sont à jour"
                : "Aucun participant"
            }
            description={
              filter === "TODO"
                ? "Rien à imprimer."
                : "Affiliez un participant pour pouvoir lui générer une carte."
            }
          />
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-y border-line bg-sub text-left text-[11.5px] text-ink-3">
                <th className="px-[15px] py-2 font-medium">Participant</th>
                <th className="px-[15px] py-2 font-medium">Employeur</th>
                <th className="px-[15px] py-2 font-medium">Ayants droit</th>
                <th className="px-[15px] py-2 font-medium">Version</th>
                <th className="px-[15px] py-2 font-medium">État</th>
                <th className="px-[15px] py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((card) => (
                <tr key={card.memberId} className="border-b border-line">
                  <td className="px-[15px] py-2.5">
                    <Link
                      href={`/${firmSlug}/ipm/participants/${card.memberId}`}
                      className="hover:text-brand"
                    >
                      <TwoFacts
                        primary={`${card.lastName.toUpperCase()} ${card.firstName}`}
                        secondary={card.matricule}
                      />
                    </Link>
                  </td>
                  <td className="px-[15px] py-2.5 text-ink-3">
                    {card.employerName}
                  </td>
                  <td className="px-[15px] py-2.5 tabular-nums text-ink-3">
                    {card.dependentCount > 9 ? (
                      // The verso holds nine. More than that is printed as a
                      // count on the card, and worth flagging here too.
                      <span title="Le verso affiche 9 ayants droit et mentionne le reste">
                        {card.dependentCount} ⚠
                      </span>
                    ) : (
                      card.dependentCount || "—"
                    )}
                  </td>
                  <td className="px-[15px] py-2.5 tabular-nums text-ink-3">
                    {card.version ? `v${card.version}` : "—"}
                    {card.generatedAt ? (
                      <span className="ml-1.5 text-[11.5px]">
                        {formatDate(card.generatedAt)}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-[15px] py-2.5">
                    <StatusPill tone={STATE_TONES[card.state]}>
                      {CARD_STATE_LABELS[card.state]}
                    </StatusPill>
                  </td>
                  <td className="px-[15px] py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setPreview(card)}
                        className="text-ink-3 hover:text-ink"
                        aria-label={`Aperçu de la carte de ${card.firstName}`}
                      >
                        <HugeiconsIcon icon={ViewIcon} size={14} />
                      </button>
                      {canWrite ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            void run({ firmSlug, memberId: card.memberId })
                          }
                          className="flex items-center gap-1 rounded-control border border-line px-2 py-1 text-[12.5px] hover:bg-sub disabled:opacity-50"
                        >
                          <HugeiconsIcon icon={Refresh01Icon} size={12} aria-hidden />
                          {card.state === "MISSING" ? "Générer" : "Regénérer"}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {preview ? (
        <CardPreview
          firmSlug={firmSlug}
          card={preview}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </>
  )
}

/**
 * Both faces, rendered on the server behind the authenticated route.
 *
 * The images are fetched from `/api/ipm/cards/...` rather than embedded, so no
 * card ever exists at a public URL — §6 requires the photo, the birth date and
 * the matricule to be served only to a signed-in caller, and a card carries
 * all three.
 */
function CardPreview({
  firmSlug,
  card,
  onClose,
}: {
  firmSlug: string
  card: CardRow
  onClose: () => void
}) {
  const base = `/${firmSlug}/api/ipm/cards/${card.memberId}`

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Carte de ${card.firstName} ${card.lastName}`}
      onClick={onClose}
    >
      <div
        className="max-h-[92svh] overflow-y-auto rounded-panel bg-surface p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-6">
          <div>
            <p className="text-[13px] font-semibold">
              {card.lastName.toUpperCase()} {card.firstName}
            </p>
            <p className="text-[11.5px] text-ink-3">{card.matricule}</p>
          </div>
          <div className="flex items-center gap-2 text-[12.5px]">
            <a
              href={`${base}/recto?format=tiff`}
              className="rounded-control border border-line px-2 py-1 hover:bg-sub"
            >
              Recto CMYK
            </a>
            <a
              href={`${base}/verso?format=tiff`}
              className="rounded-control border border-line px-2 py-1 hover:bg-sub"
            >
              Verso CMYK
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded-control border border-line px-2 py-1 hover:bg-sub"
            >
              Fermer
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          {(["recto", "verso"] as const).map((face) => (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={face}
              src={`${base}/${face}?preview=1`}
              alt={`Carte ${face}`}
              width={319}
              height={506}
              className="rounded border border-line"
            />
          ))}
        </div>

        <p className="mt-3 max-w-[680px] text-[11.5px] text-ink-3">
          Aperçu à 150 ppi. Les fichiers d&apos;impression sont en CMJN 300 ppi
          avec 3 mm de fond perdu ; le PNG reste en RVB, le format PNG ne
          pouvant pas contenir de CMJN.
        </p>
      </div>
    </div>
  )
}
