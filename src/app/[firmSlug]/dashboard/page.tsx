import type { Metadata } from "next"

import { Panel } from "@/components/panel"
import { TopBar } from "@/components/shell/top-bar"
import { requireFirmPage } from "@/server/auth/firm-page"
import { db } from "@/lib/db"
import { formatNumber } from "@/lib/format"

export const metadata: Metadata = { title: "Tableau de bord" }

/**
 * Phase 1 placeholder for the real dashboard (§5.3, phase 5).
 *
 * It is deliberately thin, but every number on it is a firm-scoped SQL
 * aggregate rather than a fetched row set — the shape the real dashboard keeps.
 * No fixture data appears anywhere: on an empty database this honestly reads 0.
 */
export default async function DashboardPage({
  params,
}: PageProps<"/[firmSlug]/dashboard">) {
  const { firmSlug } = await params
  const ctx = await requireFirmPage(firmSlug)

  const [employees, activeContracts, clients] = await Promise.all([
    db.employee.count({ where: { firmId: ctx.firmId, status: "ACTIVE" } }),
    db.contract.count({ where: { firmId: ctx.firmId, status: "ACTIVE" } }),
    db.client.count({ where: { firmId: ctx.firmId, status: "ACTIVE" } }),
  ])

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/dashboard`}
        crumbs={[{ label: ctx.firm.name }, { label: "Tableau de bord" }]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1420px] p-4.5">
          <div className="mb-3.5 flex items-center gap-3">
            <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
              Tableau de bord
            </h1>
          </div>

          <Panel
            title="Vue d'ensemble de l'effectif"
            description="Effectif, charge contractuelle et portefeuille client."
            padded={false}
            footer={{
              summary: `${employees} employés actifs, ${activeContracts} contrats en cours, ${clients} clients actifs.`,
            }}
          >
            <dl className="grid grid-cols-3 border-t border-line">
              <Kpi label="Effectif actif" value={employees} />
              <Kpi label="Contrats actifs" value={activeContracts} />
              <Kpi label="Clients actifs" value={clients} />
            </dl>
          </Panel>
        </div>
      </div>
    </>
  )
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-l border-line px-4 py-3.5 first:border-l-0">
      <dt className="text-xs text-ink-2">{label}</dt>
      <dd className="num mt-1.5 text-[26px] leading-none font-semibold tracking-[-0.028em]">
        {formatNumber(value)}
      </dd>
    </div>
  )
}
