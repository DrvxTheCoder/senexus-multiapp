"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Edit02Icon,
  EyeIcon,
  File01Icon,
  UnlinkIcon,
  PlusSignIcon,
  RefreshIcon,
  StopIcon,
} from "@hugeicons/core-free-icons"

import {
  ContractDialog,
  RenewContractDialog,
  TerminateContractDialog,
  type ContractDefaults,
} from "@/app/[firmSlug]/hr/contracts/contract-dialogs"
import {
  DocumentPreviewDialog,
  type PreviewDocument,
} from "@/components/document-preview"
import { useAction } from "@/components/forms/use-action"
import { Panel } from "@/components/panel"
import { StatusPill, TagCode } from "@/components/primitives"
import { formatCurrency, formatDate, formatDays, formatNumber } from "@/lib/format"
import { linkContractDocument } from "@/server/actions/contract-crud"
import { cn } from "@/lib/utils"

/**
 * The employee record's Contrats tab.
 *
 * One card per contract, each carrying the four things HR actually does to a
 * contract — modify, renew, terminate, and attach its signed original. The
 * dialogs are the ones the contracts list already uses; nothing about the rules
 * is re-implemented here.
 *
 * **No cumulative figure on a card.** It used to appear on every row and was
 * wrong twice over — whole spans rather than elapsed days, summed naively so a
 * shared boundary day counted twice — which is how a record could read 999 j on
 * its rows and 889 j in its header. The legal cumulation is computed once by
 * `computeCeiling` and shown once, in the renewal-chain card beside this one.
 */

export type ContractCard = {
  id: string
  type: string
  status: string
  startDate: Date
  endDate: Date | null
  days: number
  position: string | null
  salary: number | null
  workingHours: number | null
  trialPeriodEnd: Date | null
  alertThreshold: number
  isAutoRenewal: boolean
  isVise: boolean
  notes: string | null
  terminationReason: string | null
  terminationDate: Date | null
  client: { id: string; name: string } | null
  document: PreviewDocument | null
}

export type LinkableDocument = {
  id: string
  fileName: string
  documentType: string
  mimeType: string | null
  fileSize: number | null
  expiryDate: Date | null
  isVerified: boolean
  /** Set when another contract already claims it. */
  linkedToContractId: string | null
}

const STATUS: Record<string, { label: string; tone: "ok" | "muted" | "signal" | "alert" }> = {
  ACTIVE: { label: "en cours", tone: "ok" },
  RENEWED: { label: "renouvelé", tone: "muted" },
  EXPIRED: { label: "expiré", tone: "signal" },
  TERMINATED: { label: "résilié", tone: "alert" },
}

const toInput = (value: Date | null) =>
  value ? new Date(value).toISOString().slice(0, 10) : ""

export function ContractsTab({
  firmSlug,
  employee,
  contracts,
  clients,
  documents,
  usedDays,
  canWrite,
}: {
  firmSlug: string
  employee: { id: string; name: string; matricule: string }
  contracts: ContractCard[]
  clients: { id: string; name: string }[]
  /** This employee's uploaded pieces, offered as the signed original. */
  documents: LinkableDocument[]
  /** The legal cumulation, as `computeCeiling` counts it. */
  usedDays: number
  canWrite: boolean
}) {
  const [dialog, setDialog] = React.useState<
    | { kind: "create" }
    | { kind: "edit"; contract: ContractDefaults }
    | { kind: "terminate"; contract: { id: string; employeeName: string } }
    | {
        kind: "renew"
        contract: { id: string; employeeName: string; usedDays: number }
      }
    | null
  >(null)
  const [preview, setPreview] = React.useState<PreviewDocument | null>(null)

  return (
    <>
      <Panel
        title="Contrats"
        description={`${formatNumber(contracts.length)} contrat${contracts.length > 1 ? "s" : ""} dans cette entreprise, du plus récent au plus ancien.`}
        padded={false}
        tools={
          canWrite ? (
            <button
              type="button"
              onClick={() => setDialog({ kind: "create" })}
              className="inline-flex h-[30px] items-center gap-1.5 rounded-[7px] bg-ink px-2.5 text-[12.5px] font-medium text-paper hover:opacity-90"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={13} />
              Nouveau contrat
            </button>
          ) : null
        }
        footer={{
          summary:
            contracts.length === 0
              ? "Aucun contrat enregistré pour cet employé."
              : "Résilier ramène la date de fin au jour de la résiliation, donc le cumul s'arrête là.",
        }}
      >
        {contracts.length === 0 ? (
          <p className="border-t border-line py-8 text-center text-[13px] text-ink-3">
            Aucun contrat. Le premier est normalement créé avec la fiche.
          </p>
        ) : (
          <ul className="border-t border-line">
            {contracts.map((contract) => (
              <ContractRowCard
                key={contract.id}
                firmSlug={firmSlug}
                employeeName={employee.name}
                contract={contract}
                documents={documents}
                canWrite={canWrite}
                onEdit={() =>
                  setDialog({
                    kind: "edit",
                    contract: {
                      id: contract.id,
                      employeeId: employee.id,
                      type: contract.type,
                      startDate: toInput(contract.startDate),
                      endDate: toInput(contract.endDate),
                      clientId: contract.client?.id ?? "",
                      position: contract.position ?? "",
                      salary:
                        contract.salary === null
                          ? ""
                          : String(Math.round(contract.salary)),
                      workingHours:
                        contract.workingHours === null
                          ? ""
                          : String(contract.workingHours),
                      trialPeriodEnd: toInput(contract.trialPeriodEnd),
                      alertThreshold: contract.alertThreshold,
                      isAutoRenewal: contract.isAutoRenewal,
                      isVise: contract.isVise,
                      notes: contract.notes ?? "",
                    },
                  })
                }
                onRenew={() =>
                  setDialog({
                    kind: "renew",
                    contract: {
                      id: contract.id,
                      employeeName: employee.name,
                      usedDays,
                    },
                  })
                }
                onTerminate={() =>
                  setDialog({
                    kind: "terminate",
                    contract: { id: contract.id, employeeName: employee.name },
                  })
                }
                onPreview={setPreview}
              />
            ))}
          </ul>
        )}
      </Panel>

      {dialog?.kind === "create" || dialog?.kind === "edit" ? (
        <ContractDialog
          firmSlug={firmSlug}
          contract={dialog.kind === "edit" ? dialog.contract : null}
          employees={[employee]}
          clients={clients}
          lockEmployee
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === "terminate" ? (
        <TerminateContractDialog
          firmSlug={firmSlug}
          contract={dialog.contract}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === "renew" ? (
        <RenewContractDialog
          firmSlug={firmSlug}
          contract={dialog.contract}
          onClose={() => setDialog(null)}
        />
      ) : null}

      <DocumentPreviewDialog
        document={preview}
        firmSlug={firmSlug}
        onClose={() => setPreview(null)}
      />
    </>
  )
}

/* -------------------------------------------------------------------------- */

function ContractRowCard({
  firmSlug,
  employeeName,
  contract,
  documents,
  canWrite,
  onEdit,
  onRenew,
  onTerminate,
  onPreview,
}: {
  firmSlug: string
  employeeName: string
  contract: ContractCard
  documents: LinkableDocument[]
  canWrite: boolean
  onEdit: () => void
  onRenew: () => void
  onTerminate: () => void
  onPreview: (document: PreviewDocument) => void
}) {
  const status = STATUS[contract.status] ?? { label: contract.status, tone: "muted" as const }
  const closed = contract.status === "TERMINATED" || contract.status === "RENEWED"

  return (
    <li className="border-b border-line px-[15px] py-3 last:border-b-0">
      <div className="flex flex-wrap items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <TagCode>{contract.type}</TagCode>
            <StatusPill dot tone={status.tone}>
              {status.label}
            </StatusPill>
            <span className="num text-[13px] font-medium">
              {formatDate(contract.startDate)} →{" "}
              {contract.endDate ? formatDate(contract.endDate) : "indéterminée"}
            </span>
            <span className="num text-[12px] text-ink-3">
              {formatDays(contract.days)}
            </span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-ink-3">
            {contract.position ? <span>{contract.position}</span> : null}
            {contract.client ? <span>· {contract.client.name}</span> : null}
            <span className={contract.isVise ? "text-ok" : "text-signal"}>
              ·{" "}
              {contract.isVise
                ? "visé par l'inspection du travail"
                : "visa en attente"}
            </span>
            {contract.workingHours ? (
              <span className="num">· {contract.workingHours} h/sem.</span>
            ) : null}
          </div>

          {contract.terminationReason ? (
            <p className="mt-1 text-[12px] text-alert">
              Résilié
              {contract.terminationDate
                ? ` le ${formatDate(contract.terminationDate)}`
                : ""}{" "}
              · {contract.terminationReason}
            </p>
          ) : null}
        </div>

        {contract.salary !== null ? (
          <span className="mono num shrink-0 text-[13px] text-ink-2">
            {formatCurrency(contract.salary)}
          </span>
        ) : null}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <SignedDocument
          firmSlug={firmSlug}
          contract={contract}
          documents={documents}
          canWrite={canWrite}
          onPreview={onPreview}
        />

        {canWrite ? (
          <div className="ml-auto flex items-center gap-1.5">
            <Action
              label="Modifier"
              icon={Edit02Icon}
              disabled={closed}
              title={closed ? "Un contrat clos ne se modifie plus" : undefined}
              onClick={onEdit}
              ariaLabel={`Modifier le contrat de ${employeeName}`}
            />
            <Action
              label="Renouveler"
              icon={RefreshIcon}
              disabled={closed}
              title={
                closed ? "Un contrat clos ne se renouvelle plus" : undefined
              }
              onClick={onRenew}
              ariaLabel={`Renouveler le contrat de ${employeeName}`}
            />
            <Action
              label="Résilier"
              icon={StopIcon}
              tone="alert"
              disabled={closed}
              onClick={onTerminate}
              ariaLabel={`Résilier le contrat de ${employeeName}`}
            />
          </div>
        ) : null}
      </div>
    </li>
  )
}

function Action({
  label,
  icon,
  onClick,
  disabled,
  title,
  tone = "default",
  ariaLabel,
}: {
  label: string
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"]
  onClick: () => void
  disabled?: boolean
  title?: string
  tone?: "default" | "alert"
  ariaLabel: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-label={ariaLabel}
      className={cn(
        "cursor-pointer disabled:cursor-not-allowed inline-flex h-7 items-center gap-1.5 rounded-[7px] border border-line bg-surface px-2 text-[12px] transition-colors disabled:opacity-40",
        tone === "alert"
          ? "hover:border-alert hover:bg-alert-tint hover:text-alert"
          : "hover:bg-sub"
      )}
    >
      <HugeiconsIcon icon={icon} size={13} strokeWidth={1.8} />
      {label}
    </button>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * The signed original: a chip with an eye when one is linked, a picker when it
 * is not.
 *
 * The picker lists only this employee's pieces, and the server refuses anything
 * belonging to someone else regardless of what is sent.
 */
function SignedDocument({
  firmSlug,
  contract,
  documents,
  canWrite,
  onPreview,
}: {
  firmSlug: string
  contract: ContractCard
  documents: LinkableDocument[]
  canWrite: boolean
  onPreview: (document: PreviewDocument) => void
}) {
  const [picking, setPicking] = React.useState(false)

  // `defineAction` types every action as `(raw: unknown) => …`, so the input
  // shape is stated here for the sake of the success message below.
  const { run, pending, error } = useAction<
    { firmSlug: string; contractId: string; documentId: string | null },
    unknown
  >(linkContractDocument, {
    // Detaching and attaching go through the same action; the message follows
    // what was actually asked for rather than the action's name.
    success: (_data, input) =>
      input.documentId ? "Pièce rattachée au contrat." : "Pièce détachée.",
    onSuccess: () => setPicking(false),
  })

  function link(documentId: string | null) {
    run({ firmSlug, contractId: contract.id, documentId })
  }

  if (contract.document) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="inline-flex h-7 max-w-[260px] items-center gap-1.5 rounded-[7px] border border-line bg-sub px-2 text-[12px]">
          <HugeiconsIcon
            icon={File01Icon}
            size={13}
            strokeWidth={1.8}
            className="shrink-0 text-ink-3"
          />
          <span className="truncate">{contract.document.fileName}</span>
        </span>
        <button
          type="button"
          onClick={() => onPreview(contract.document!)}
          title="Aperçu"
          aria-label={`Aperçu de ${contract.document.fileName}`}
          className="grid size-7 place-items-center rounded-[7px] text-ink-3 hover:bg-sunken hover:text-ink"
        >
          <HugeiconsIcon icon={EyeIcon} size={14} strokeWidth={1.8} />
        </button>
        {canWrite ? (
          <button
            type="button"
            onClick={() => link(null)}
            disabled={pending}
            title="Détacher la pièce du contrat"
            aria-label="Détacher la pièce"
            className="grid size-7 place-items-center rounded-[7px] text-ink-3 hover:bg-sunken hover:text-ink disabled:opacity-40"
          >
            <HugeiconsIcon icon={UnlinkIcon} size={14} strokeWidth={1.8} />
          </button>
        ) : null}
        {error ? (
          <span role="alert" className="text-[11px] text-alert">
            {error}
          </span>
        ) : null}
      </span>
    )
  }

  if (!canWrite) {
    return <span className="text-[11.5px] text-ink-3">Aucune pièce liée</span>
  }

  if (!picking) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="inline-flex h-7 items-center gap-1.5 rounded-[7px] border border-dashed border-line-2 px-2 text-[12px] text-ink-3 hover:border-line hover:text-ink"
        >
          <HugeiconsIcon icon={File01Icon} size={13} strokeWidth={1.8} />
          Lier le contrat signé
        </button>
        {error ? (
          <span role="alert" className="text-[11px] text-alert">
            {error}
          </span>
        ) : null}
      </span>
    )
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <select
        autoFocus
        aria-label="Pièce à lier au contrat"
        defaultValue=""
        disabled={pending}
        onChange={(event) => {
          if (event.target.value) link(event.target.value)
        }}
        className="h-7 max-w-[300px] rounded-[7px] border border-line bg-surface px-2 text-[12px]"
      >
        <option value="">
          {documents.length === 0
            ? "Aucune pièce déposée pour cet employé"
            : "Choisir une pièce…"}
        </option>
        {documents.map((document) => (
          <option
            key={document.id}
            value={document.id}
            disabled={
              document.linkedToContractId !== null &&
              document.linkedToContractId !== contract.id
            }
          >
            {document.fileName}
            {document.linkedToContractId &&
            document.linkedToContractId !== contract.id
              ? " — déjà liée à un autre contrat"
              : ""}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => setPicking(false)}
        className="h-7 rounded-[7px] px-2 text-[12px] text-ink-3 hover:text-ink"
      >
        Annuler
      </button>
      {error ? (
        <span role="alert" className="text-[11px] text-alert">
          {error}
        </span>
      ) : null}
    </span>
  )
}
