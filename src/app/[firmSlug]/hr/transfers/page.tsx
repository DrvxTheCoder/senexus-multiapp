import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"

import {
  NewTransferButton,
  TransferRowActions,
} from "@/app/[firmSlug]/hr/transfers/transfers-actions"
import { Panel } from "@/components/panel"
import { Avatar, StatusPill, TwoFacts } from "@/components/primitives"
import { TopBar } from "@/components/shell/top-bar"
import { db } from "@/lib/db"
import { formatDate, formatDays, formatNumber, initials } from "@/lib/format"
import { requireFirmPage } from "@/server/auth/firm-page"
import type { FirmContext } from "@/server/auth/require-firm-access"
import { roleAtLeast } from "@/types/auth"

export const metadata: Metadata = { title: "Transferts" }

const STATUS: Record<string, { label: string; tone: "ok" | "signal" | "alert" | "muted" | "brand" }> = {
  PENDING: { label: "En attente", tone: "signal" },
  APPROVED: { label: "Approuvé", tone: "brand" },
  COMPLETED: { label: "Effectif", tone: "ok" },
  REJECTED: { label: "Refusé", tone: "alert" },
  CANCELLED: { label: "Annulé", tone: "muted" },
}

/**
 * §5.6 — transfers between group firms.
 *
 * `EmployeeTransfer` is the only model with two firm columns rather than one,
 * so this list is scoped on either side: a firm sees the moves it is sending
 * *and* receiving. Which direction a row represents is stated explicitly,
 * because "transfert" alone is ambiguous when you are on one end of it.
 */
export default async function TransfersPage({
  params,
}: PageProps<"/[firmSlug]/hr/transfers">) {
  const { firmSlug } = await params
  const ctx = await requireFirmPage(firmSlug, { module: "hr" })

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/dashboard`}
        crumbs={[
          { label: ctx.firm.name, href: `/${firmSlug}/dashboard` },
          { label: "RH" },
          { label: "Transferts" },
        ]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1420px] p-4.5">
          <div className="mb-3.5 flex items-center gap-3">
            <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
              Transferts
            </h1>
          </div>

          <Suspense
            fallback={
              <div
                aria-hidden
                className="h-64 animate-pulse rounded-panel border border-line bg-surface"
              />
            }
          >
            <TransfersPanel ctx={ctx} firmSlug={firmSlug} />
          </Suspense>
        </div>
      </div>
    </>
  )
}

/**
 * Fetching and shaping happen here, not in the component: the age of a transfer
 * depends on the clock, and reading the clock during render is exactly the
 * impurity that makes a re-render produce a different answer.
 */
async function loadTransfers(ctx: FirmContext) {
  const rows = await db.employeeTransfer.findMany({
    where: {
      OR: [{ fromFirmId: ctx.firmId }, { toFirmId: ctx.firmId }],
      ...(ctx.assignedClientIds
        ? { employee: { assignedClientId: { in: ctx.assignedClientIds } } }
        : {}),
    },
    orderBy: [{ status: "asc" }, { effectiveDate: "desc" }],
    take: 100,
    select: {
      id: true,
      status: true,
      transferDate: true,
      effectiveDate: true,
      reason: true,
      newMatricule: true,
      rejectionReason: true,
      notes: true,
      employee: {
        select: { id: true, firstName: true, lastName: true, matricule: true },
      },
      fromFirm: { select: { id: true, name: true } },
      toFirm: { select: { id: true, name: true } },
      requester: { select: { name: true, email: true } },
    },
  })

  const now = Date.now()
  return rows.map((transfer) => ({
    ...transfer,
    outgoing: transfer.fromFirm.id === ctx.firmId,
    ageDays: Math.round((now - transfer.transferDate.getTime()) / 86_400_000),
    // The effective date is a gate on completion, so whether it has arrived is
    // decided here rather than by reading the clock during render.
    effectiveReached: transfer.effectiveDate.getTime() <= now,
    // `notes` carries the request's options as JSON — the schema is frozen and
    // has nowhere else to put them. A row written by the legacy application
    // holds free text, so this reads either.
    note: readNote(transfer.notes),
  }))
}

function readNote(notes: string | null): string | null {
  if (!notes) return null
  try {
    const parsed = JSON.parse(notes) as { note?: string | null }
    return parsed.note ?? null
  } catch {
    return notes
  }
}

async function TransfersPanel({
  ctx,
  firmSlug,
}: {
  ctx: FirmContext
  firmSlug: string
}) {
  const canWrite = roleAtLeast(ctx.role, "MANAGER")

  const [transfers, siblings, employees] = await Promise.all([
    loadTransfers(ctx),
    // Every other firm in the same holding — a transfer never leaves the group.
    canWrite
      ? db.firm.findMany({
          where: { holdingId: ctx.firm.holdingId, NOT: { id: ctx.firmId } },
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            clients: {
              where: { status: { in: ["ACTIVE", "PROSPECT"] } },
              orderBy: { name: "asc" },
              select: { id: true, name: true, firmId: true },
            },
          },
        })
      : Promise.resolve([]),
    canWrite
      ? db.employee.findMany({
          where: {
            firmId: ctx.firmId,
            status: { in: ["ACTIVE", "ON_LEAVE"] },
            ...(ctx.assignedClientIds
              ? { assignedClientId: { in: ctx.assignedClientIds } }
              : {}),
          },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          take: 1000,
          select: {
            id: true,
            firstName: true,
            lastName: true,
            matricule: true,
          },
        })
      : Promise.resolve([]),
  ])

  const pending = transfers.filter((transfer) => transfer.status === "PENDING")
  const awaitingUs = transfers.filter(
    (transfer) => transfer.status === "PENDING" && !transfer.outgoing
  )

  return (
    <Panel
      title="Mouvements entre filiales"
      description="Entrants et sortants. Le plafond de 730 jours repart à zéro dans la filiale de destination."
      stats={[
        { label: "Mouvements", value: formatNumber(transfers.length) },
        {
          label: "En attente",
          value: formatNumber(pending.length),
          tone: pending.length > 0 ? "signal" : "default",
        },
        {
          label: "À approuver",
          value: formatNumber(awaitingUs.length),
          tone: awaitingUs.length > 0 ? "alert" : "default",
        },
      ]}
      padded={false}
      tools={
        canWrite ? (
          <NewTransferButton
            firmSlug={firmSlug}
            employees={employees.map((employee) => ({
              id: employee.id,
              name: `${employee.firstName} ${employee.lastName}`,
              matricule: employee.matricule,
            }))}
            firms={siblings.map((firm) => ({ id: firm.id, name: firm.name }))}
            clients={siblings.flatMap((firm) => firm.clients)}
          />
        ) : null
      }
      footer={{
        summary:
          transfers.length === 0
            ? "Aucun transfert enregistré."
            : "Finaliser clôt les contrats de la filiale d'origine, attribue le nouveau matricule et ouvre le contrat d'arrivée.",
      }}
    >
      {transfers.length === 0 ? (
        <div className="border-t border-line px-[15px] py-10 text-center">
          <p className="text-[13px] font-semibold">Aucun transfert</p>
          <p className="mt-1 text-[12.5px] text-ink-3">
            Les mouvements entre filiales du groupe apparaissent ici.
          </p>
        </div>
      ) : (
        <ul className="border-t border-line">
          {transfers.map((transfer) => {
            const { outgoing, ageDays } = transfer

            return (
              <li
                key={transfer.id}
                className="flex flex-wrap items-center gap-3 border-b border-line px-[15px] py-2.5 last:border-b-0"
              >
                {/*
                  The row is no longer one big anchor: it holds buttons now, and
                  a button inside an anchor is neither valid nor operable. The
                  link is the employee, which is what it always meant.
                */}
                <Link
                  href={`/${firmSlug}/hr/employees/${transfer.employee.id}?tab=parcours`}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-[7px] hover:text-brand"
                >
                  <Avatar
                    initials={initials(
                      transfer.employee.firstName,
                      transfer.employee.lastName
                    )}
                  />
                  <TwoFacts
                    className="min-w-0 flex-1"
                    primary={
                      <span className="font-medium">
                        {transfer.employee.firstName} {transfer.employee.lastName}
                      </span>
                    }
                    secondary={
                      <>
                        <span className="mono">{transfer.employee.matricule}</span>
                        {transfer.newMatricule ? (
                          <>
                            {" → "}
                            <span className="mono">{transfer.newMatricule}</span>
                          </>
                        ) : null}
                        {" · "}
                        {transfer.reason}
                        {transfer.note ? ` · ${transfer.note}` : null}
                      </>
                    }
                  />
                </Link>

                <div className="hidden min-w-0 shrink-0 text-[12.5px] text-ink-2 sm:block">
                  <div className="truncate">
                    {outgoing ? "vers " : "depuis "}
                    <b className="font-medium">
                      {outgoing ? transfer.toFirm.name : transfer.fromFirm.name}
                    </b>
                  </div>
                  <div className="text-[11.5px] text-ink-3">
                    effet le {formatDate(transfer.effectiveDate)}
                  </div>
                </div>

                <StatusPill dot tone={STATUS[transfer.status]?.tone ?? "muted"}>
                  {STATUS[transfer.status]?.label ?? transfer.status}
                </StatusPill>

                {transfer.status === "REJECTED" && transfer.rejectionReason ? (
                  <span className="max-w-[240px] truncate text-[11.5px] text-alert">
                    {transfer.rejectionReason}
                  </span>
                ) : null}

                {canWrite ? (
                  <TransferRowActions
                    firmSlug={firmSlug}
                    transfer={{
                      id: transfer.id,
                      status: transfer.status,
                      outgoing,
                      employeeName: `${transfer.employee.firstName} ${transfer.employee.lastName}`,
                      effective: formatDate(transfer.effectiveDate),
                      effectiveReached: transfer.effectiveReached,
                    }}
                  />
                ) : null}

                <span
                  className={`num w-16 shrink-0 text-right text-[11.5px] ${
                    transfer.status === "PENDING" && ageDays > 14
                      ? "font-medium text-signal"
                      : "text-ink-3"
                  }`}
                >
                  {formatDays(ageDays)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
