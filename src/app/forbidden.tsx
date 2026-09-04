import Link from "next/link"

import { Panel } from "@/components/panel"

/** Rendered with a 403 when `forbidden()` is called. */
export default function Forbidden() {
  return (
    <main className="grid min-h-svh place-items-center bg-paper p-6">
      <div className="w-full max-w-md">
        <Panel
          title="Accès refusé"
          description="Votre rôle ne donne pas accès à cette ressource."
          titleAs="h1"
          footer={{
            action: (
              <Link href="/" className="font-medium hover:text-brand">
                Retour
              </Link>
            ),
          }}
        >
          <p className="text-[13px] text-ink-2">
            Demandez un accès à un administrateur de cette entreprise.
          </p>
        </Panel>
      </div>
    </main>
  )
}
