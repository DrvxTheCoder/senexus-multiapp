import Link from "next/link"
import { redirect, unauthorized } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon } from "@hugeicons/core-free-icons"
import Image from "next/image"

import { FirmLogo } from "@/components/firm-logo"
import { Panel } from "@/components/panel"
import { getSession } from "@/server/auth/require-firm-access"
import { resolveUserFirms } from "@/server/firms/resolve-firm"

/**
 * The firm chooser.
 *
 * One membership goes straight through. Several offer a choice. None is a real
 * state in this data model — a user with no `UserFirm` row can sign in but has
 * nothing to see — and it says so plainly rather than showing an empty grid.
 *
 * Anyone who is OWNER or ADMIN of any firm also gets the **Administration**
 * card, first in the grid. It is not a firm: it is a role-derived shortcut into
 * the holding-level console, exactly as the previous application presented it.
 */
export default async function RootPage() {
  const session = await getSession()
  if (!session?.user?.id) {
    unauthorized()
  }

  // Read the firms rather than the JWT: this page shows logos and brand
  // colours, which are deliberately not carried in the session cookie.
  const firms = await resolveUserFirms(session.user.id)
  const canAdminister = firms.some(
    (firm) => firm.role === "OWNER" || firm.role === "ADMIN"
  )

  if (firms.length === 1 && !canAdminister) {
    redirect(`/${firms[0].firmSlug}/dashboard`)
  }

  if (firms.length === 0 && !canAdminister) {
    return (
      <main className="grid min-h-svh place-items-center bg-paper p-6">
        <div className="w-full max-w-md">
          <Panel
            title="Aucune entreprise"
            description="Votre compte n'est rattaché à aucune entreprise du groupe."
            titleAs="h1"
            footer={{
              summary: "Contactez un administrateur pour obtenir un accès.",
            }}
          >
            <p className="text-[13px] text-ink-2">
              Un administrateur doit vous ajouter à une entreprise avant que
              vous puissiez consulter des données.
            </p>
          </Panel>
        </div>
      </main>
    )
  }

  return (
    <main className="grid min-h-svh place-items-center bg-paper p-6">
      <div className="w-full max-w-4xl">
        <div className="mb-8 text-center">
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.024em]">
            Sélectionnez votre entreprise
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-3">
            Choisissez l&apos;entreprise à laquelle vous souhaitez vous
            connecter
          </p>
        </div>

        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {canAdminister ? (
            <li>
              <Link
                href="/admin"
                className="flex h-full items-center gap-3 rounded-panel border border-line bg-surface px-4 py-3.5 transition-colors hover:border-line-2 hover:bg-sub"
              >
                <Image
                  src="/icons/icon-512.png"
                  alt="Senexus Group"
                  width={36}
                  height={36}
                  priority
                  className="size-9 rounded-xs"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">
                    Administration
                  </span>
                  <span className="block truncate text-[11.5px] text-ink-3">
                    Entreprises, utilisateurs et modules
                  </span>
                </span>
                <Chevron />
              </Link>
            </li>
          ) : null}

          {firms.map((firm) => (
            <li key={firm.firmId}>
              <Link
                href={`/${firm.firmSlug}/dashboard`}
                className="flex h-full items-center gap-3 rounded-panel border border-line bg-surface px-4 py-3.5 transition-colors hover:border-line-2 hover:bg-sub"
              >
                <FirmLogo
                  name={firm.firmName}
                  logo={firm.logo}
                  themeColor={firm.themeColor}
                  size={36}
                  radius={8}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">
                    {firm.firmName}
                  </span>
                  <span className="mono block truncate text-[11.5px] text-ink-3">
                    {firm.firmSlug}
                  </span>
                </span>
                <Chevron />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  )
}

function Chevron() {
  return (
    <span
      aria-hidden
      className="grid size-6 shrink-0 place-items-center rounded-full border border-line text-ink-3"
    >
      <HugeiconsIcon icon={ArrowRight01Icon} size={13} />
    </span>
  )
}
