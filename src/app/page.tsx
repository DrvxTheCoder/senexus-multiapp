import Link from "next/link"
import { redirect, unauthorized } from "next/navigation"

import { Panel } from "@/components/panel"
import { getSession } from "@/server/auth/require-firm-access"

/**
 * Entry point. One membership goes straight through; several offer a choice;
 * none is a real state in this data model (a user with no `UserFirm` row can
 * sign in but has nothing to see) and says so plainly.
 */
export default async function RootPage() {
  const session = await getSession()

  if (!session?.user) {
    unauthorized()
  }

  const memberships = session.user.memberships

  if (memberships.length === 1) {
    redirect(`/${memberships[0].firmSlug}/dashboard`)
  }

  return (
    <main className="grid min-h-svh place-items-center bg-paper p-6">
      <div className="w-full max-w-md">
        {memberships.length === 0 ? (
          <Panel
            title="Aucune entreprise"
            description="Votre compte n'est rattaché à aucune entreprise du groupe."
            titleAs="h1"
            footer={{
              summary: "Contactez un administrateur pour obtenir un accès.",
            }}
          >
            <p className="text-[13px] text-ink-2">
              Un administrateur doit vous ajouter à une entreprise avant que vous
              puissiez consulter des données.
            </p>
          </Panel>
        ) : (
          <Panel
            title="Choisir une entreprise"
            description="Vous êtes membre de plusieurs entreprises du groupe."
            titleAs="h1"
            padded={false}
          >
            <ul className="border-t border-line">
              {memberships.map((membership) => (
                <li key={membership.firmId}>
                  <Link
                    href={`/${membership.firmSlug}/dashboard`}
                    className="flex items-center gap-3 border-b border-line px-[15px] py-3 last:border-b-0 hover:bg-brand-wash"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">
                        {membership.firmName}
                      </span>
                      <span className="mono block truncate text-ink-3">
                        {membership.firmSlug}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </main>
  )
}
