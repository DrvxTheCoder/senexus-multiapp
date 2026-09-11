import type { Metadata } from "next"

import { Panel } from "@/components/panel"
import { TopBar } from "@/components/shell/top-bar"
import { requireFirmPage } from "@/server/auth/firm-page"

export const metadata: Metadata = { title: "IPM" }

/**
 * Phase 0 — the boundary, and nothing else.
 *
 * IPM Tawfeikh is a filiale of the same holding as Connect Interim and
 * Synergie Pro, but its data is health data: §7 of the plan requires that none
 * of it be readable from the other firms. The mechanism is the one the rest of
 * the application already uses — `requireModule` — so the guarantee is the
 * single `{ module: "ipm" }` below: a firm without the module 404s this route,
 * and the sidebar never offers the link in the first place.
 *
 * The page carries no features on purpose. Affiliation, formules and cartes
 * are Phase 1 and depend on a data model that does not exist yet; scaffolding
 * screens ahead of it would mean writing them twice. What ships here is the
 * gate the Phase 1 screens will inherit, verified on its own.
 */
export default async function IpmPage({
  params,
}: PageProps<"/[firmSlug]/ipm">) {
  const { firmSlug } = await params
  const ctx = await requireFirmPage(firmSlug, { module: "ipm" })

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/dashboard`}
        crumbs={[
          { label: ctx.firm.name, href: `/${firmSlug}/dashboard` },
          { label: "IPM" },
        ]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="p-4.5">
          <div className="mb-3.5 flex items-center gap-3">
            <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
              Prévoyance maladie
            </h1>
          </div>

          <Panel
            title="Module en cours de construction"
            description="Le module est activé pour cette entreprise ; les écrans arrivent par phases."
          >
            <p className="max-w-prose text-[13px] leading-relaxed text-ink-3">
              L&apos;accès est déjà cloisonné : les données de santé ne sont
              lisibles que depuis {ctx.firm.name}, et aucune autre entreprise du
              groupe n&apos;atteint ces pages.
            </p>

            <ol className="mt-3.5 max-w-prose space-y-1.5 text-[13px] text-ink-3">
              <li>
                <span className="font-medium text-ink">Phase 1 — Affiliation.</span>{" "}
                Référentiels, employeurs, participants, ayants droit, formules et
                barèmes, cartes, documents, reprise WebLamps.
              </li>
              <li>
                <span className="font-medium text-ink">Phase 2 — Bons.</span>{" "}
                Prestataires et conventions, émission avec contrôle des droits,
                moteur de règlement, vérification QR.
              </li>
              <li>
                <span className="font-medium text-ink">
                  Phase 3 — Cotisations et comptes.
                </span>{" "}
                Registre participant, facturation employeur, relevés.
              </li>
              <li>
                <span className="font-medium text-ink">
                  Phase 4 — Décaissements.
                </span>{" "}
                Factures prestataires, remboursements, bons de décaissement,
                exports comptables.
              </li>
            </ol>
          </Panel>
        </div>
      </div>
    </>
  )
}
