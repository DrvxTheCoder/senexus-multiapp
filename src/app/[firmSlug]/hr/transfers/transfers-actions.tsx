"use client"

import * as React from "react"

import {
  RejectTransferDialog,
  TransferDialog,
  TransferStepButton,
  type TransferClient,
  type TransferFirm,
} from "@/app/[firmSlug]/hr/transfers/transfer-dialogs"
import { HugeiconsIcon } from "@hugeicons/react"
import { PlusSignIcon } from "@hugeicons/core-free-icons"

/**
 * The interactive parts of the transfers page.
 *
 * The list itself stays a server component — it reads two firms' worth of rows
 * and applies the client scope — and only the controls are client-side.
 */

export function NewTransferButton({
  firmSlug,
  employees,
  firms,
  clients,
}: {
  firmSlug: string
  employees: { id: string; name: string; matricule: string }[]
  firms: TransferFirm[]
  clients: TransferClient[]
}) {
  const [employeeId, setEmployeeId] = React.useState<string | null>(null)
  const [picking, setPicking] = React.useState(false)

  const employee = employees.find((row) => row.id === employeeId) ?? null

  if (firms.length === 0) {
    return (
      <span className="text-[11.5px] text-ink-3">
        Aucune autre filiale dans le groupe.
      </span>
    )
  }

  return (
    <>
      {picking ? (
        <select
          autoFocus
          aria-label="Employé à transférer"
          className="h-[30px] max-w-[260px] rounded-[7px] border border-line bg-surface px-2 text-[12.5px]"
          defaultValue=""
          onChange={(event) => {
            if (!event.target.value) return
            setEmployeeId(event.target.value)
            setPicking(false)
          }}
          onBlur={() => setPicking(false)}
        >
          <option value="">Choisir un employé…</option>
          {employees.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name} · {row.matricule}
            </option>
          ))}
        </select>
      ) : (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="inline-flex h-[30px] items-center gap-1.5 rounded-[7px] bg-ink px-2.5 text-[12.5px] font-medium text-paper hover:opacity-90"
        >
          <HugeiconsIcon icon={PlusSignIcon} size={13} />
          Nouveau transfert
        </button>
      )}

      {employee ? (
        <TransferDialog
          firmSlug={firmSlug}
          employee={employee}
          firms={firms}
          clients={clients}
          onClose={() => setEmployeeId(null)}
        />
      ) : null}
    </>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * What this row's viewer may do, given which side of the transfer they are on.
 *
 * Destination approves or refuses; source completes or cancels. The server
 * enforces the same rule — this only decides what to render.
 */
export function TransferRowActions({
  firmSlug,
  transfer,
}: {
  firmSlug: string
  transfer: {
    id: string
    status: string
    outgoing: boolean
    employeeName: string
    effective: string
    effectiveReached: boolean
  }
}) {
  const [rejecting, setRejecting] = React.useState(false)

  if (transfer.status === "PENDING") {
    return (
      <div className="flex shrink-0 items-center gap-1.5">
        {transfer.outgoing ? (
          <>
            <span className="text-[11.5px] text-ink-3">
              en attente de la filiale d&apos;accueil
            </span>
            <TransferStepButton
              firmSlug={firmSlug}
              transferId={transfer.id}
              step="cancel"
              label="Annuler"
              tone="quiet"
            />
          </>
        ) : (
          <>
            <TransferStepButton
              firmSlug={firmSlug}
              transferId={transfer.id}
              step="approve"
              label="Approuver"
              tone="primary"
            />
            <button
              type="button"
              onClick={() => setRejecting(true)}
              className="h-7 rounded-[7px] border border-line bg-surface px-2.5 text-[12px] hover:bg-sub"
            >
              Refuser
            </button>
          </>
        )}

        {rejecting ? (
          <RejectTransferDialog
            firmSlug={firmSlug}
            transfer={{ id: transfer.id, employeeName: transfer.employeeName }}
            onClose={() => setRejecting(false)}
          />
        ) : null}
      </div>
    )
  }

  if (transfer.status === "APPROVED") {
    return (
      <div className="flex shrink-0 items-center gap-1.5">
        {transfer.outgoing ? (
          <>
            {transfer.effectiveReached ? (
              <TransferStepButton
                firmSlug={firmSlug}
                transferId={transfer.id}
                step="complete"
                label="Finaliser"
                tone="primary"
              />
            ) : (
              <span className="text-[11.5px] text-ink-3">
                effet le {transfer.effective}
              </span>
            )}
            <TransferStepButton
              firmSlug={firmSlug}
              transferId={transfer.id}
              step="cancel"
              label="Annuler"
              tone="quiet"
            />
          </>
        ) : (
          <span className="text-[11.5px] text-ink-3">
            approuvé — la filiale d&apos;origine finalise
          </span>
        )}
      </div>
    )
  }

  return null
}
