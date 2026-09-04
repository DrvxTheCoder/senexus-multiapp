import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"

import { Panel } from "@/components/panel"
import { StatusPill } from "@/components/primitives"
import { TopBar } from "@/components/shell/top-bar"
import { formatDays, formatNumber } from "@/lib/format"
import { requireFirmPage } from "@/server/auth/firm-page"
import type { FirmContext } from "@/server/auth/require-firm-access"
import { listDecisions, type Decision } from "@/server/queries/decisions"

export const metadata: Metadata = { title: "Décisions" }

const CATEGORY_ORDER: Decision["category"][] = [
  "Plafond légal",
  "Contrat",
  "Dossier",
  "Document",
]

const CATEGORY_DESCRIPTION: Record<Decision["category"], string> = {
  "Plafond légal": "Employés au-delà de la zone d'alerte des 730 jours.",
  Contrat: "Échéances proches et visas de l'inspection du travail en attente.",
  Dossier: "Informations obligatoires manquantes sur la fiche employé.",
  Document: "Pièces expirées ou en attente de vérification.",
}

/**
 * Q10 — the Décisions queue.
 *
 * Everything demanding this caller's attention, grouped by what it is about and
 * sorted by urgency inside each group. Access-filtered like every other query: a
 * responsable sees only their own portfolio's alerts.
 */
export default async function DecisionsPage({
  params,
}: PageProps<"/[firmSlug]/decisions">) {
  const { firmSlug } = await params
  const ctx = await requireFirmPage(firmSlug)

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/dashboard`}
        crumbs={[
          { label: ctx.firm.name, href: `/${firmSlug}/dashboard` },
          { label: "Décisions" },
        ]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1420px] p-4.5">
          <div className="mb-3.5 flex items-center gap-3">
            <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
              Décisions
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
            <DecisionGroups ctx={ctx} />
          </Suspense>
        </div>
      </div>
    </>
  )
}

async function DecisionGroups({ ctx }: { ctx: FirmContext }) {
  const decisions = await listDecisions(ctx, 500)

  if (decisions.length === 0) {
    return (
      <Panel
        title="Rien à traiter"
        description="Aucune alerte ne concerne votre périmètre."
      >
        <p className="text-[13px] text-ink-2">
          Les dépassements du plafond légal, les échéances de contrat, les
          dossiers incomplets et les documents expirés apparaîtront ici.
        </p>
      </Panel>
    )
  }

  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    items: decisions.filter((decision) => decision.category === category),
  })).filter((group) => group.items.length > 0)

  return (
    <div className="flex flex-col gap-3.5">
      {groups.map((group) => {
        const urgent = group.items.filter((item) => item.tone === "alert").length
        return (
          <Panel
            key={group.category}
            title={group.category}
            description={CATEGORY_DESCRIPTION[group.category]}
            stats={[
              {
                label: "À traiter",
                value: formatNumber(group.items.length),
                tone: urgent > 0 ? "alert" : "default",
              },
            ]}
            padded={false}
            footer={{
              summary:
                urgent > 0
                  ? `${formatNumber(urgent)} urgente${urgent > 1 ? "s" : ""} sur ${formatNumber(group.items.length)}.`
                  : `${formatNumber(group.items.length)} élément${group.items.length > 1 ? "s" : ""} à traiter.`,
            }}
          >
            <ul className="border-t border-line">
              {group.items.map((decision) => (
                <li key={decision.id}>
                  <Link
                    href={decision.href}
                    className="flex items-center gap-3 border-b border-line px-[15px] py-2.5 last:border-b-0 hover:bg-brand-wash"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">
                        {decision.title}
                      </span>
                      <span className="block truncate text-[11.5px] text-ink-3">
                        {decision.detail}
                      </span>
                    </span>
                    {decision.tone === "alert" ? (
                      <StatusPill tone="alert">Urgent</StatusPill>
                    ) : null}
                    <span
                      className={`num shrink-0 text-[11.5px] ${
                        decision.tone === "alert"
                          ? "font-medium text-alert"
                          : "text-ink-3"
                      }`}
                    >
                      {formatDays(decision.ageDays)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        )
      })}
    </div>
  )
}
