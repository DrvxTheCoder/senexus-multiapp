import type { Metadata } from "next"
import Link from "next/link"
import { forbidden, unauthorized } from "next/navigation"

import { Panel } from "@/components/panel"
import { StatusPill, TagCode } from "@/components/primitives"
import { db } from "@/lib/db"
import { formatDateProse, formatNumber } from "@/lib/format"
import { requireHoldingAccess } from "@/server/auth/require-firm-access"
import { ForbiddenError, UnauthorizedError } from "@/server/errors"

export const metadata: Metadata = { title: "Administration" }

/**
 * §3.4 — holding-level administration, deliberately outside `/[firmSlug]`.
 *
 * It is the one screen whose subject is the group rather than a firm, so it
 * sits at its own route with its own gate: `requireHoldingAccess`, which
 * demands an OWNER membership somewhere in the holding. Everything shown is
 * scoped to the holdings the caller actually owns.
 */
export default async function AdminPage() {
  let holdingIds: string[]
  try {
    holdingIds = await requireHoldingAccess()
  } catch (error) {
    if (error instanceof UnauthorizedError) unauthorized()
    if (error instanceof ForbiddenError) forbidden()
    throw error
  }

  const holdings = await db.holding.findMany({
    where: { id: { in: holdingIds } },
    select: {
      id: true,
      name: true,
      description: true,
      createdAt: true,
      firms: {
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          slug: true,
          themeColor: true,
          _count: {
            select: { employees: true, clients: true, contracts: true, userFirms: true },
          },
          firmModules: {
            where: { isEnabled: true },
            select: { module: { select: { slug: true } } },
          },
        },
      },
    },
  })

  const modules = await db.module.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      version: true,
      basePath: true,
      isActive: true,
      isSystem: true,
      _count: { select: { firmModules: true } },
    },
  })

  return (
    <main className="min-h-svh bg-paper">
      <header className="flex h-top items-center gap-3 border-b border-line bg-surface px-4.5">
        <span className="text-[13px] font-medium">Administration du groupe</span>
        <Link
          href="/"
          className="ml-auto text-[12.5px] text-ink-3 hover:text-ink"
        >
          Retour à l'application
        </Link>
      </header>

      <div className="mx-auto max-w-[1420px] p-4.5">
        <h1 className="mb-3.5 text-[21px] leading-tight font-semibold tracking-[-0.022em]">
          Administration
        </h1>

        <div className="flex flex-col gap-3.5">
          {holdings.map((holding) => (
            <Panel
              key={holding.id}
              title={holding.name}
              description={holding.description ?? "Holding du groupe Senexus."}
              stats={[{ label: "Filiales", value: formatNumber(holding.firms.length) }]}
              padded={false}
              footer={{
                summary: `Créée le ${formatDateProse(holding.createdAt)}.`,
              }}
            >
              <ul className="border-t border-line">
                {holding.firms.map((firm) => (
                  <li
                    key={firm.id}
                    className="flex flex-wrap items-center gap-3 border-b border-line px-[15px] py-3 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/${firm.slug}/dashboard`}
                        className="text-[13px] font-medium hover:text-brand"
                      >
                        {firm.name}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-3">
                        <span className="mono">{firm.slug}</span>
                        {firm.firmModules.map((entry) => (
                          <TagCode key={entry.module.slug}>{entry.module.slug}</TagCode>
                        ))}
                      </div>
                    </div>

                    <dl className="flex gap-4 text-[12.5px]">
                      <Stat label="Employés" value={firm._count.employees} />
                      <Stat label="Contrats" value={firm._count.contracts} />
                      <Stat label="Clients" value={firm._count.clients} />
                      <Stat label="Membres" value={firm._count.userFirms} />
                    </dl>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}

          <Panel
            title="Modules installés"
            description="Un module désactivé masque sa navigation et renvoie 404 sur ses routes."
            padded={false}
            footer={{
              summary:
                "Activer un module pour une filiale est une écriture de données, pas une migration : le schéma reste figé.",
            }}
          >
            <ul className="border-t border-line">
              {modules.map((module) => (
                <li
                  key={module.id}
                  className="flex items-center gap-3 border-b border-line px-[15px] py-2.5 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[13px] font-medium">
                      {module.name}
                      <TagCode>{module.basePath}</TagCode>
                      {module.isSystem ? (
                        <StatusPill tone="brand">système</StatusPill>
                      ) : null}
                    </div>
                    <p className="mt-px text-[11.5px] text-ink-3">
                      version {module.version} · activé dans{" "}
                      {formatNumber(module._count.firmModules)} filiale
                      {module._count.firmModules > 1 ? "s" : ""}
                    </p>
                  </div>
                  <StatusPill dot tone={module.isActive ? "ok" : "muted"}>
                    {module.isActive ? "Actif" : "Inactif"}
                  </StatusPill>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-right">
      <dt className="text-[11px] text-ink-3">{label}</dt>
      <dd className="num font-medium">{formatNumber(value)}</dd>
    </div>
  )
}
