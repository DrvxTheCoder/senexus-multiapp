import type { Metadata } from "next"

import { FieldList } from "@/components/field-list"
import { Panel } from "@/components/panel"
import { StatusPill, TagCode } from "@/components/primitives"
import { TopBar } from "@/components/shell/top-bar"
import { db } from "@/lib/db"
import { formatDateProse, formatNumber } from "@/lib/format"
import { requireFirmPage } from "@/server/auth/firm-page"
import { buildFirmTheme, normaliseThemeColor } from "@/server/firms/theme"
import { INTERIM_CEILING_DAYS } from "@/server/domain/interim-ceiling"

export const metadata: Metadata = { title: "Paramètres" }

const ROLE_LABELS: Record<string, string> = {
  OWNER: "Propriétaire",
  ADMIN: "Administrateur",
  MANAGER: "Responsable RH",
  RESPONSABLE: "Responsable client",
  STAFF: "Collaborateur",
  VIEWER: "Lecture seule",
}

/**
 * Firm settings — read-only for now, and honest about it.
 *
 * It surfaces the values that actually govern behaviour, including the two the
 * brief singles out: the alert threshold (§6, stored per contract and read from
 * there) and the brand colour (§4.2, whose stored form is unreliable). Editing
 * comes with the write layer; showing what is in force is useful today and
 * makes the next step obvious.
 */
export default async function SettingsPage({
  params,
}: PageProps<"/[firmSlug]/settings">) {
  const { firmSlug } = await params
  const ctx = await requireFirmPage(firmSlug)

  const [firm, modules, members, thresholds] = await Promise.all([
    db.firm.findUniqueOrThrow({
      where: { id: ctx.firmId },
      select: {
        name: true,
        slug: true,
        logo: true,
        themeColor: true,
        createdAt: true,
        holding: { select: { name: true } },
        _count: { select: { employees: true, clients: true, contracts: true } },
      },
    }),
    db.firmModule.findMany({
      where: { firmId: ctx.firmId },
      select: {
        isEnabled: true,
        installedAt: true,
        module: {
          select: { slug: true, name: true, description: true, basePath: true, version: true },
        },
      },
      orderBy: { module: { name: "asc" } },
    }),
    db.userFirm.findMany({
      where: { firmId: ctx.firmId },
      select: {
        role: true,
        user: { select: { name: true, email: true } },
      },
      orderBy: { role: "asc" },
    }),
    // §6 — the alert threshold is stored per contract and never was read. This
    // shows what is actually in force across the firm.
    db.contract.groupBy({
      by: ["alertThreshold"],
      where: { firmId: ctx.firmId, status: "ACTIVE" },
      _count: { _all: true },
      orderBy: { alertThreshold: "asc" },
    }),
  ])

  const theme = buildFirmTheme(firm.themeColor)
  const rawColor = firm.themeColor
  const normalised = normaliseThemeColor(rawColor)

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/dashboard`}
        crumbs={[
          { label: ctx.firm.name, href: `/${firmSlug}/dashboard` },
          { label: "Paramètres" },
        ]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1420px] p-4.5">
          <div className="mb-3.5 flex items-center gap-3">
            <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
              Paramètres
            </h1>
          </div>

          <div className="grid items-start gap-3.5 lg:grid-cols-2">
            <div className="flex flex-col gap-3.5">
              <Panel
                title="Entreprise"
                description="Identité de la filiale dans le groupe."
                footer={{
                  summary: `Créée le ${formatDateProse(firm.createdAt)}.`,
                }}
              >
                <FieldList
                  fields={[
                    { label: "Nom", value: firm.name },
                    { label: "Identifiant", value: firm.slug, mono: true },
                    { label: "Holding", value: firm.holding.name },
                    {
                      label: "Effectif",
                      value: `${formatNumber(firm._count.employees)} employés · ${formatNumber(firm._count.contracts)} contrats`,
                    },
                    { label: "Clients", value: formatNumber(firm._count.clients) },
                  ]}
                />
              </Panel>

              <Panel
                title="Identité visuelle"
                description="La couleur de marque est rendue côté serveur, dès le premier affichage."
                footer={{
                  summary: normalised
                    ? "Validée et convertie en OKLCH à la frontière applicative."
                    : "Aucune couleur exploitable : la teinte par défaut du groupe est utilisée.",
                }}
              >
                <FieldList
                  fields={[
                    {
                      label: "Valeur stockée",
                      value: rawColor ? rawColor : "vide",
                      mono: true,
                      missing: !rawColor,
                    },
                    {
                      label: "Normalisée",
                      value: normalised ? (
                        <span className="inline-flex items-center gap-2">
                          <span
                            aria-hidden
                            className="size-3.5 rounded border border-line"
                            style={{ background: theme.hex ?? "var(--sx-brand)" }}
                          />
                          <span className="mono">{normalised}</span>
                        </span>
                      ) : (
                        "défaut du groupe"
                      ),
                    },
                    {
                      label: "Logo",
                      value: firm.logo ? firm.logo : "non défini",
                      missing: !firm.logo,
                    },
                  ]}
                />
              </Panel>
            </div>

            <div className="flex flex-col gap-3.5">
              <Panel
                title="Modules"
                description="Les modules désactivés masquent leur navigation et renvoient 404."
                padded={false}
                footer={{
                  summary: `${formatNumber(modules.filter((m) => m.isEnabled).length)} modules actifs sur ${formatNumber(modules.length)}.`,
                }}
              >
                <ul className="border-t border-line">
                  {modules.map((entry) => (
                    <li
                      key={entry.module.slug}
                      className="flex items-center gap-3 border-b border-line px-[15px] py-2.5 last:border-b-0"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-[13px] font-medium">
                          {entry.module.name}
                          <TagCode>{entry.module.basePath}</TagCode>
                        </div>
                        {entry.module.description ? (
                          <p className="mt-px truncate text-[11.5px] text-ink-3">
                            {entry.module.description}
                          </p>
                        ) : null}
                      </div>
                      <StatusPill dot tone={entry.isEnabled ? "ok" : "muted"}>
                        {entry.isEnabled ? "Actif" : "Désactivé"}
                      </StatusPill>
                    </li>
                  ))}
                </ul>
              </Panel>

              <Panel
                title="Seuil d'alerte des échéances"
                description="Stocké par contrat. La valeur enregistrée fait foi, 30 jours par défaut."
                footer={{
                  summary:
                    "Auparavant, trois valeurs différentes coexistaient dans l'application et la valeur stockée n'était jamais lue.",
                }}
              >
                <FieldList
                  fields={thresholds.map((entry) => ({
                    label: `${entry.alertThreshold} jours`,
                    value: `${formatNumber(entry._count._all)} contrats actifs`,
                  }))}
                />
              </Panel>

              <Panel
                title="Règle du plafond légal"
                description="Appliquée dans toute l'application depuis une seule définition."
              >
                <FieldList
                  fields={[
                    { label: "Plafond", value: `${INTERIM_CEILING_DAYS} jours par employeur` },
                    { label: "Types soumis", value: "INTERIM uniquement" },
                    { label: "Chevauchements", value: "comptés une seule fois" },
                    { label: "Interruptions", value: "non comptées" },
                  ]}
                />
              </Panel>

              <Panel
                title="Accès"
                description="Membres de cette filiale."
                padded={false}
                footer={{ summary: `${formatNumber(members.length)} membres.` }}
              >
                <ul className="border-t border-line">
                  {members.map((member) => (
                    <li
                      key={member.user.email}
                      className="flex items-center gap-3 border-b border-line px-[15px] py-2 last:border-b-0"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px]">
                          {member.user.name ?? member.user.email}
                        </div>
                        <div className="truncate text-[11.5px] text-ink-3">
                          {member.user.email}
                        </div>
                      </div>
                      <StatusPill tone="muted">
                        {ROLE_LABELS[member.role] ?? member.role}
                      </StatusPill>
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
