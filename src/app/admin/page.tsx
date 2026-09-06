import type { Metadata } from "next"
import Link from "next/link"

import { AdminPageHeader } from "@/app/admin/admin-page-header"
import { Panel } from "@/components/panel"
import { FirmLogo } from "@/components/firm-logo"
import { StatusPill, TagCode } from "@/components/primitives"
import { db } from "@/lib/db"
import { formatDateProse, formatNumber } from "@/lib/format"
import { requireHoldingAccess } from "@/server/auth/require-firm-access"

export const metadata: Metadata = { title: "Administration" }

/**
 * §3.4 — the console overview.
 *
 * The gate lives in `src/app/admin/layout.tsx`, but a layout and its page
 * render in parallel, so this page calls `requireHoldingAccess` too rather than
 * trusting that the layout got there first.
 */
export default async function AdminPage() {
  const holdingIds = await requireHoldingAccess()

  const [holdings, modules, recentUsers] = await Promise.all([
    db.holding.findMany({
      where: { id: { in: holdingIds } },
      orderBy: { name: "asc" },
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
            logo: true,
            themeColor: true,
            _count: {
              select: {
                employees: true,
                clients: true,
                contracts: true,
                userFirms: true,
              },
            },
            firmModules: {
              where: { isEnabled: true },
              select: { module: { select: { slug: true } } },
            },
          },
        },
      },
    }),
    db.module.findMany({
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
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
    }),
    db.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        userFirms: { select: { role: true }, take: 1 },
      },
    }),
  ])

  const firms = holdings.flatMap((holding) => holding.firms)
  const totals = firms.reduce(
    (accumulator, firm) => ({
      employees: accumulator.employees + firm._count.employees,
      contracts: accumulator.contracts + firm._count.contracts,
      clients: accumulator.clients + firm._count.clients,
      members: accumulator.members + firm._count.userFirms,
    }),
    { employees: 0, contracts: 0, clients: 0, members: 0 }
  )

  const documentsModule = modules.find((module) => module.slug === "documents")

  return (
    <>
      <AdminPageHeader
        title="Vue d'ensemble"

      />

      <div className="flex-1 overflow-y-auto">
        <div className=" p-4.5">
          <div className="flex flex-col gap-3.5">
            <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Entreprises" value={firms.length} href="/admin/firms" />
              <Metric label="Employés" value={totals.employees} />
              <Metric label="Contrats" value={totals.contracts} />
              <Metric label="Comptes rattachés" value={totals.members} href="/admin/users" />
            </div>

            {/*
              The single most common cause of "the Documents page is missing":
              the module row does not exist, so the nav entry and the employee
              tab are hidden everywhere. Say so here rather than leaving it to
              be discovered.
            */}
            {!documentsModule ? (
              <Panel
                title="Le module Documents n'est pas installé"
                description="La rubrique Documents et l'onglet Documents des fiches employés restent masqués tant qu'il manque."
                footer={{
                  summary: "Installation en un clic depuis la page Modules.",
                  action: (
                    <Link
                      href="/admin/modules"
                      className="text-[12.5px] font-medium text-brand hover:underline"
                    >
                      Aller aux modules →
                    </Link>
                  ),
                }}
              >
                <p className="text-[13px] text-ink-2">
                  Les pièces existent déjà en base et restent rattachées aux
                  employés ; seule leur interface est masquée.
                </p>
              </Panel>
            ) : null}

            {holdings.map((holding) => (
              <Panel
                key={holding.id}
                title={holding.name}
                description={holding.description ?? "Holding du groupe Senexus."}
                stats={[
                  { label: "Filiales", value: formatNumber(holding.firms.length) },
                ]}
                padded={false}
                footer={{
                  summary: `Créée le ${formatDateProse(holding.createdAt)}.`,
                  action: (
                    <Link
                      href="/admin/firms"
                      className="text-[12.5px] font-medium text-brand hover:underline"
                    >
                      Gérer les entreprises →
                    </Link>
                  ),
                }}
              >
                <ul className="border-t border-line">
                  {holding.firms.map((firm) => (
                    <li
                      key={firm.id}
                      className="flex flex-wrap items-center gap-3 border-b border-line px-[15px] py-3 last:border-b-0"
                    >
                      <FirmLogo
                        name={firm.name}
                        logo={firm.logo}
                        themeColor={firm.themeColor}
                        size={28}
                      />
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/${firm.slug}/dashboard`}
                          className="text-[13px] font-medium hover:text-brand"
                        >
                          {firm.name}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-3">
                          <span className="mono">{firm.slug}</span>
                          {firm.firmModules.length === 0 ? (
                            <span className="text-alert">aucun module activé</span>
                          ) : (
                            firm.firmModules.map((entry) => (
                              <TagCode key={entry.module.slug}>
                                {entry.module.slug}
                              </TagCode>
                            ))
                          )}
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

            <div className="grid gap-3.5 xl:grid-cols-2">
              <Panel
                title="Modules"
                description="Un module désactivé masque sa navigation et renvoie 404 sur ses routes."
                padded={false}
                footer={{
                  summary:
                    "Activer un module pour une entreprise est une écriture de données, pas une migration.",
                  action: (
                    <Link
                      href="/admin/modules"
                      className="text-[12.5px] font-medium text-brand hover:underline"
                    >
                      Gérer →
                    </Link>
                  ),
                }}
              >
                <ul className="border-t border-line">
                  {modules.map((module) => (
                    <li
                      key={module.id}
                      className="flex items-center gap-3 border-b border-line px-[15px] py-2.5 last:border-b-0"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
                          {module.name}
                          <TagCode>{module.basePath}</TagCode>
                          {module.isSystem ? (
                            <StatusPill tone="brand">système</StatusPill>
                          ) : null}
                        </div>
                        <p className="mt-px text-[11.5px] text-ink-3">
                          version {module.version} · activé dans{" "}
                          {formatNumber(module._count.firmModules)} entreprise
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

              <Panel
                title="Derniers comptes créés"
                padded={false}
                footer={{
                  summary: "Rôles et clients assignés se règlent sur la page Utilisateurs.",
                  action: (
                    <Link
                      href="/admin/users"
                      className="text-[12.5px] font-medium text-brand hover:underline"
                    >
                      Gérer →
                    </Link>
                  ),
                }}
              >
                <ul className="border-t border-line">
                  {recentUsers.map((user) => (
                    <li
                      key={user.id}
                      className="flex items-center gap-3 border-b border-line px-[15px] py-2.5 last:border-b-0"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium">
                          {user.name ?? user.email}
                        </div>
                        <div className="truncate text-[11.5px] text-ink-3">
                          {user.email}
                        </div>
                      </div>
                      {user.userFirms[0] ? (
                        <StatusPill tone="muted">{user.userFirms[0].role}</StatusPill>
                      ) : (
                        <StatusPill tone="alert">sans entreprise</StatusPill>
                      )}
                      <span className="num shrink-0 text-[11.5px] text-ink-3">
                        {formatDateProse(user.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function Metric({
  label,
  value,
  href,
}: {
  label: string
  value: number
  href?: string
}) {
  const body = (
    <>
      <div className="text-[11.5px] text-ink-3">{label}</div>
      <div className="num mt-0.5 text-[22px] leading-none font-semibold tracking-[-0.02em]">
        {formatNumber(value)}
      </div>
    </>
  )

  if (href) {
    return (
      <Link
        href={href}
        className="rounded-panel border border-line bg-surface px-[15px] py-3 transition-colors hover:border-ink-3"
      >
        {body}
      </Link>
    )
  }

  return (
    <div className="rounded-panel border border-line bg-surface px-[15px] py-3">
      {body}
    </div>
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
