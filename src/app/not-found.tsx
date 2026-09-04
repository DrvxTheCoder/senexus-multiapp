import Link from "next/link"

import { Panel } from "@/components/panel"

export default function NotFound() {
  return (
    <main className="grid min-h-svh place-items-center bg-paper p-6">
      <div className="w-full max-w-md">
        <Panel
          title="Page introuvable"
          description="Cette adresse ne correspond à aucune ressource."
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
            Le lien est peut-être obsolète, ou le module concerné n'est pas
            activé pour cette entreprise.
          </p>
        </Panel>
      </div>
    </main>
  )
}
