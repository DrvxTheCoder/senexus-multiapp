import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"

import { Panel } from "@/components/panel"
import { Avatar, StatusPill, TwoFacts } from "@/components/primitives"
import { TopBar } from "@/components/shell/top-bar"
import { db } from "@/lib/db"
import { formatDate, formatDays, formatNumber, initials } from "@/lib/format"
import { requireFirmPage } from "@/server/auth/firm-page"
import type { FirmContext } from "@/server/auth/require-firm-access"

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
  }))
}

async function TransfersPanel({
  ctx,
  firmSlug,
}: {
  ctx: FirmContext
  firmSlug: string
}) {
  const transfers = await loadTransfers(ctx)
  const pending = transfers.filter((transfer) => transfer.status === "PENDING")

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
      ]}
      padded={false}
      footer={{
        summary:
          transfers.length === 0
            ? "Aucun transfert enregistré."
            : "Un transfert finalisé clôt les contrats de la filiale d'origine et attribue un nouveau matricule.",
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
              <li key={transfer.id}>
                <Link
                  href={`/${firmSlug}/hr/employees/${transfer.employee.id}?tab=parcours`}
                  className="flex items-center gap-3 border-b border-line px-[15px] py-2.5 last:border-b-0 hover:bg-brand-wash"
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
                      </>
                    }
                  />

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

                  <span
                    className={`num w-16 shrink-0 text-right text-[11.5px] ${
                      transfer.status === "PENDING" && ageDays > 14
                        ? "font-medium text-signal"
                        : "text-ink-3"
                    }`}
                  >
                    {formatDays(ageDays)}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
