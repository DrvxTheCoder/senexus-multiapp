import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { Notification03Icon } from "@hugeicons/core-free-icons"

import { db } from "@/lib/db"
import { clientDotVar } from "@/lib/client-color"
import { formatNumber } from "@/lib/format"
import type { FirmContext } from "@/server/auth/require-firm-access"
import { employeesHref } from "@/lib/queries/employee-params"
import {
  INTERIM_CEILING_DAYS,
  INTERIM_WARNING_DAYS,
} from "@/server/domain/interim-ceiling"
import { countDecisions } from "@/server/queries/decisions"
import { interimCeilingCte } from "@/server/queries/ceiling-sql"
import { Prisma } from "@prisma/client"

/**
 * §5.1 — the contextual blocks in the sidebar.
 *
 * Both are server components rendered into slots on the client sidebar, so the
 * shell itself never fetches. Both are firm- and role-scoped, and both are
 * links into a pre-filtered list rather than decoration: the client group
 * doubles as a filter, and the risk card is the fastest route to the people who
 * need a decision.
 */

/**
 * The alert bell in the brand block.
 *
 * It counts the same queue the Décisions page lists, through the same
 * access-filtered resolver — so a responsable's badge counts only their own
 * portfolio. A bell that silently over-counted would be worse than no bell.
 */
export async function SidebarAlertBell({ ctx }: { ctx: FirmContext }) {
  const count = await countDecisions(ctx)

  return (
    <Link
      href={`/${ctx.firm.slug}/decisions`}
      aria-label={
        count > 0
          ? `Décisions, ${count} en attente`
          : "Décisions, rien en attente"
      }
      title="Décisions"
      className="relative grid size-7 shrink-0 place-items-center rounded-[7px] text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
    >
      <HugeiconsIcon icon={Notification03Icon} size={16} strokeWidth={1.8} />
      {count > 0 ? (
        // Tinted rather than solid: `--sx-signal` means the legal ceiling and
        // nothing else, and solid alert loses its contrast in the dark theme.
        // The exact figure is in the label; two glyphs is all this fits.
        <span className="num absolute -top-px -right-px grid h-[14px] min-w-[14px] place-items-center rounded-full bg-alert-tint px-[3px] text-[9px] leading-none font-semibold text-alert ring-1 ring-alert/20">
          {count > 9 ? "9+" : count}
        </span>
      ) : null}
    </Link>
  )
}

/** "Effectif par client" — the contextual filter group. */
export async function SidebarClientGroup({ ctx }: { ctx: FirmContext }) {
  if (!ctx.firm.modules.includes("hr")) return null

  const rows = await db.employee.groupBy({
    by: ["assignedClientId"],
    where: {
      firmId: ctx.firmId,
      status: "ACTIVE",
      assignedClientId: { not: null },
      ...(ctx.assignedClientIds
        ? { assignedClientId: { in: ctx.assignedClientIds } }
        : {}),
    },
    _count: { _all: true },
    orderBy: { _count: { id: "desc" } },
    take: 5,
  })

  if (rows.length === 0) return null

  const clients = await db.client.findMany({
    where: {
      id: { in: rows.map((row) => row.assignedClientId).filter((id): id is string => id !== null) },
    },
    select: { id: true, name: true },
  })
  const nameById = new Map(clients.map((client) => [client.id, client.name]))

  return (
    <>
      <p className="px-5 pt-3 pb-1.5 text-[11px] font-medium tracking-[0.02em] text-ink-3 uppercase">
        Effectif par client
      </p>
      <ul className="px-2">
        {rows.map((row) => {
          const id = row.assignedClientId
          if (!id) return null
          return (
            <li key={id}>
              <Link
                href={employeesHref(ctx.firm.slug, { clientId: [id] })}
                className="flex items-center gap-2.5 rounded-[7px] px-3 py-1.5 text-[13.5px] text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
              >
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: clientDotVar(id) }}
                />
                <span className="truncate">{nameById.get(id) ?? "—"}</span>
                <span className="num ml-auto text-[11.5px] text-ink-3">
                  {formatNumber(row._count._all)}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </>
  )
}

/** The pinned legal-ceiling risk card. */
export async function SidebarRiskCard({ ctx }: { ctx: FirmContext }) {
  if (!ctx.firm.modules.includes("hr")) return null

  const scope =
    ctx.assignedClientIds === null
      ? Prisma.empty
      : ctx.assignedClientIds.length
        ? Prisma.sql`AND e."assignedClientId" IN (${Prisma.join(ctx.assignedClientIds)})`
        : Prisma.sql`AND false`

  const [row] = await db.$queryRaw<
    { total: bigint; near: bigint; over: bigint }[]
  >(Prisma.sql`
    WITH ${interimCeilingCte(ctx.firmId)}
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (
        WHERE COALESCE(cl.used_days, 0) >= ${INTERIM_WARNING_DAYS}
          AND COALESCE(cl.used_days, 0) < ${INTERIM_CEILING_DAYS}
      ) AS near,
      COUNT(*) FILTER (WHERE COALESCE(cl.used_days, 0) >= ${INTERIM_CEILING_DAYS}) AS over
    FROM employees e
    LEFT JOIN ceiling cl ON cl.employee_id = e."id"
    WHERE e."firmId" = ${ctx.firmId}
      AND e."status" = 'ACTIVE'
      AND cl.employee_id IS NOT NULL
      ${scope}
  `)

  const total = Number(row?.total ?? 0)
  const near = Number(row?.near ?? 0)
  const over = Number(row?.over ?? 0)

  if (total === 0) return null

  const exposed = near + over
  const compliant = total === 0 ? 100 : Math.round(((total - exposed) / total) * 100)

  return (
    <div className="mx-3 mb-2.5 rounded-[9px] border border-line bg-surface p-2.5">
      <p className="text-xs font-semibold text-signal">
        Plafond légal {INTERIM_CEILING_DAYS} j
      </p>
      <p className="mt-1 mb-2 text-[11.5px] leading-snug text-ink-2">
        {formatNumber(exposed)} employé{exposed > 1 ? "s" : ""} au-delà de{" "}
        {INTERIM_WARNING_DAYS} jours cumulés.
        {over > 0 ? ` ${formatNumber(over)} en dépassement.` : ""}
      </p>
      <div
        className="relative h-1.5 w-full overflow-hidden rounded-sm bg-sunken"
        role="meter"
        aria-valuenow={compliant}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Part de l'effectif intérimaire conforme"
      >
        <div
          className="absolute inset-y-0 left-0 rounded-sm bg-signal"
          style={{ width: `${100 - compliant}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px]">
        <span className="num text-ink-3">{compliant} % conformes</span>
        <Link
          href={employeesHref(ctx.firm.slug, {
            contractType: ["INTERIM"],
            interimDaysMin: INTERIM_WARNING_DAYS,
          })}
          className="font-medium text-signal hover:underline"
        >
          Traiter
        </Link>
      </div>
    </div>
  )
}
