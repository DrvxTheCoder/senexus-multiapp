import type { Metadata } from "next"

import { FieldList } from "@/components/field-list"
import { Panel } from "@/components/panel"
import { StatusPill } from "@/components/primitives"
import { TopBar } from "@/components/shell/top-bar"
import { ROLE_LABELS } from "@/components/shell/role-labels"
import { ChangePasswordForm, ProfileForm } from "@/app/[firmSlug]/settings/profile/profile-forms"
import { db } from "@/lib/db"
import { formatDateProse } from "@/lib/format"
import { requireFirmPage } from "@/server/auth/firm-page"
import { resolveUserFirms } from "@/server/firms/resolve-firm"

export const metadata: Metadata = { title: "Profil" }

/**
 * The account holder's own record.
 *
 * Nothing here is administration: a user edits their own name and photo and
 * changes their own password. Which firms they belong to, and in what role, is
 * shown read-only — that is an administrator's decision, not theirs.
 */
export default async function ProfilePage({
  params,
}: PageProps<"/[firmSlug]/settings/profile">) {
  const { firmSlug } = await params
  const ctx = await requireFirmPage(firmSlug)

  const [user, firms] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: ctx.userId },
      select: {
        name: true,
        email: true,
        image: true,
        emailVerified: true,
        createdAt: true,
        passwordHash: true,
      },
    }),
    resolveUserFirms(ctx.userId),
  ])

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/dashboard`}
        crumbs={[
          { label: ctx.firm.name, href: `/${firmSlug}/dashboard` },
          { label: "Compte" },
          { label: "Profil" },
        ]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1420px] p-4.5">
          <h1 className="mb-3.5 text-[21px] leading-tight font-semibold tracking-[-0.022em]">
            Profil
          </h1>

          <div className="grid items-start gap-3.5 lg:grid-cols-2">
            <div className="flex flex-col gap-3.5">
              <Panel
                title="Vos informations"
                description="Visibles par les autres membres du groupe."
              >
                <ProfileForm
                  defaultName={user.name ?? ""}
                  email={user.email}
                  image={user.image}
                />
              </Panel>

              <Panel
                title="Mot de passe"
                description="Changez votre mot de passe sans passer par un administrateur."
                footer={{
                  summary: user.passwordHash
                    ? "Le mot de passe actuel est demandé pour confirmer votre identité."
                    : "Aucun mot de passe n'est défini sur ce compte.",
                }}
              >
                {user.passwordHash ? (
                  <ChangePasswordForm />
                ) : (
                  <p className="text-[13px] text-ink-2">
                    Ce compte ne se connecte pas par mot de passe. Contactez un
                    administrateur.
                  </p>
                )}
              </Panel>
            </div>

            <div className="flex flex-col gap-3.5">
              <Panel title="Compte" description="Informations non modifiables ici.">
                <FieldList
                  fields={[
                    { label: "Email", value: user.email },
                    {
                      label: "Vérifié",
                      value: user.emailVerified ? "Oui" : "Non",
                    },
                    {
                      label: "Créé le",
                      value: formatDateProse(user.createdAt),
                    },
                  ]}
                />
              </Panel>

              <Panel
                title="Vos accès"
                description="Attribués par un administrateur."
                padded={false}
                footer={{
                  summary: `${firms.length} entreprise${firms.length > 1 ? "s" : ""}.`,
                }}
              >
                <ul className="border-t border-line">
                  {firms.map((firm) => (
                    <li
                      key={firm.firmId}
                      className="flex items-center gap-3 border-b border-line px-[15px] py-2.5 last:border-b-0"
                    >
                      <span className="min-w-0 flex-1 truncate text-[13px]">
                        {firm.firmName}
                      </span>
                      <StatusPill tone="muted">
                        {ROLE_LABELS[firm.role as keyof typeof ROLE_LABELS] ??
                          firm.role}
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
