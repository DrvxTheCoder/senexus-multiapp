import Link from "next/link"

import { Panel } from "@/components/panel"

/** Rendered with a 401 when `unauthorized()` is called. */
export default function Unauthorized() {
  return (
    <main className="grid min-h-svh place-items-center bg-paper p-6">
      <div className="w-full max-w-md">
        <Panel
          title="Session expirée"
          description="Votre session n'est plus valide."
          titleAs="h1"
          footer={{
            action: (
              <Link href="/auth/sign-in" className="font-medium hover:text-brand">
                Se connecter
              </Link>
            ),
          }}
        >
          <p className="text-[13px] text-ink-2">
            Reconnectez-vous pour accéder à cette page.
          </p>
        </Panel>
      </div>
    </main>
  )
}
