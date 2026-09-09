"use client"

import * as React from "react"

import {
  previewBulkRenewal,
  runBulkRenewal,
  type RenewalPreflight,
} from "@/server/actions/contracts"
import type { ContractQuery } from "@/lib/queries/contract-query"
import type { Selection } from "@/server/queries/types"
import { InterimMeter } from "@/components/interim-meter"
import { StatusPill } from "@/components/primitives"
import { Spinner } from "@/components/spinner"
import { formatNumber } from "@/lib/format"
import { notify } from "@/lib/toast"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SegmentedControl } from "@/components/primitives"

const DURATIONS = [
  { value: "90", label: "3 mois" },
  { value: "180", label: "6 mois" },
  { value: "365", label: "12 mois" },
]

/**
 * §6 — the bulk renewal pre-flight.
 *
 * The ceiling is evaluated per employee and the blocked renewals are named,
 * with reasons, **before** anything is written. Nothing is ever silently
 * skipped: if 12 of 40 would breach the ceiling, the dialog says so and offers
 * to proceed with the 28 that are lawful.
 *
 * Changing the duration re-runs the check, because a renewal that fits at three
 * months may not fit at twelve.
 */
export function RenewalPreflightDialog({
  open,
  onOpenChange,
  firmSlug,
  selection,
  onDone,
  busy,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  firmSlug: string
  selection: Selection<ContractQuery>
  onDone: () => void
  busy?: boolean
}) {
  const [duration, setDuration] = React.useState("180")
  const [running, setRunning] = React.useState(false)
  const [result, setResult] = React.useState<string | null>(null)

  // Keyed by what the check was run for, so a stale result can never be shown
  // against a different duration, and so `loading` is derived rather than a
  // second piece of state that has to be kept in step.
  const checkKey = open ? `${duration}` : null
  const [checked, setChecked] = React.useState<{
    key: string
    value: RenewalPreflight
  } | null>(null)

  React.useEffect(() => {
    if (checkKey === null) return
    let cancelled = false
    void previewBulkRenewal(firmSlug, selection, Number(duration)).then((value) => {
      if (!cancelled) setChecked({ key: checkKey, value })
    })
    return () => {
      cancelled = true
    }
    // `selection` is a fresh object every render; the check re-runs when the
    // dialog opens or the duration changes, which is what the user perceives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkKey, firmSlug, duration])

  const preflight = checked?.key === checkKey ? checked.value : null
  const loading = checkKey !== null && preflight === null && result === null

  const allowed = preflight?.allowed.length ?? 0
  const blocked = preflight?.blocked.length ?? 0

  async function confirm() {
    setRunning(true)
    // Unlike the `defineAction` mutations, this one throws rather than
    // returning a result, and the `finally` below used to swallow the failure
    // entirely — the dialog simply stopped, with nothing said.
    const toastId = notify.loading("Renouvellement des contrats…")
    try {
      const outcome = await runBulkRenewal(firmSlug, selection, Number(duration))
      const renewed = `${formatNumber(outcome.renewed)} contrat${outcome.renewed > 1 ? "s" : ""} renouvelé${outcome.renewed > 1 ? "s" : ""}`
      const refused = outcome.refused.length
        ? `${formatNumber(outcome.refused.length)} refusé${outcome.refused.length > 1 ? "s" : ""}`
        : ""

      setResult(renewed + (refused ? `, ${refused}.` : "."))

      // A partial run is not a clean success: the refusals are the ceiling
      // doing its job, and they deserve to be read.
      if (outcome.refused.length) {
        notify.warning(`${renewed}.`, {
          id: toastId,
          // The ceiling constant lives in a `server-only` module, and the
          // dialog already states the figure above; the toast just points at it.
          description: `${refused} — plafond légal atteint.`,
        })
      } else {
        notify.success(`${renewed}.`, { id: toastId })
      }

      onDone()
    } catch {
      notify.error("Le renouvellement n'a pas pu être effectué.", {
        id: toastId,
      })
    } finally {
      setRunning(false)
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setChecked(null)
      setResult(null)
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Renouveler les contrats sélectionnés</DialogTitle>
          <DialogDescription>
            Le plafond légal de 730 jours est vérifié pour chaque employé avant
            toute écriture.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 border-y border-line py-3">
          <span className="text-[12.5px] text-ink-2">Durée du renouvellement</span>
          <SegmentedControl
            options={DURATIONS}
            value={duration}
            onChange={setDuration}
            ariaLabel="Durée du renouvellement"
          />
        </div>

        {loading ? (
          <p className="py-8 text-center text-[13px] text-ink-3">
            Vérification du plafond…
          </p>
        ) : result ? (
          <p className="py-8 text-center text-[13px]">{result}</p>
        ) : (
          <div className="max-h-[320px] overflow-y-auto">
            <p className="py-2 text-[13px]">
              <b className="num">{formatNumber(allowed)}</b> renouvelable
              {allowed > 1 ? "s" : ""}
              {blocked > 0 ? (
                <>
                  {" · "}
                  <b className="num text-signal">{formatNumber(blocked)}</b> bloqué
                  {blocked > 1 ? "s" : ""}
                </>
              ) : null}
            </p>

            {blocked > 0 ? (
              <table className="w-full border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="border-y border-line bg-sub px-2.5 py-1.5 text-left text-[11.5px] font-medium text-ink-3">
                      Employé
                    </th>
                    <th className="border-y border-line bg-sub px-2.5 py-1.5 text-left text-[11.5px] font-medium text-ink-3">
                      Plafond
                    </th>
                    <th className="border-y border-line bg-sub px-2.5 py-1.5 text-left text-[11.5px] font-medium text-ink-3">
                      Motif du blocage
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preflight?.blocked.map((row) => (
                    <tr key={row.contractId}>
                      <td className="border-b border-line px-2.5 py-2 text-[13px]">
                        <div>{row.employeeName}</div>
                        <div className="mono text-[11.5px] text-ink-3">
                          {row.matricule}
                        </div>
                      </td>
                      <td className="border-b border-line px-2.5 py-2">
                        <InterimMeter
                          usedDays={row.usedDays}
                          projectedDays={row.projectedDays}
                          applicable={row.type === "INTERIM"}
                        />
                      </td>
                      <td className="border-b border-line px-2.5 py-2 text-[12.5px] text-ink-2">
                        {row.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="py-6 text-center text-[13px] text-ink-3">
                Aucun blocage. Tous les contrats sélectionnés peuvent être
                renouvelés.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {blocked > 0 && !result ? (
            <StatusPill tone="signal">
              {formatNumber(blocked)} exclu{blocked > 1 ? "s" : ""} du
              renouvellement
            </StatusPill>
          ) : null}
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            className="h-8 rounded-[7px] border border-line bg-surface px-3 text-[12.5px] hover:bg-sub"
          >
            {result ? "Fermer" : "Annuler"}
          </button>
          {!result ? (
            <button
              type="button"
              disabled={allowed === 0 || running || busy}
              onClick={confirm}
              className="inline-flex h-8 flex-row items-center justify-center gap-2 rounded-[7px] bg-ink px-3 text-[12.5px] font-medium text-paper disabled:opacity-40"
            >
              {running
                ? "Renouvellement…"
                : `Renouveler ${formatNumber(allowed)} contrat${allowed > 1 ? "s" : ""}`}
              {running ? <Spinner className="h-3.5" /> : null}
            </button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
