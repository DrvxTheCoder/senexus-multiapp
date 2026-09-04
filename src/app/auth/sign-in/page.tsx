import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { SignInForm } from "@/app/auth/sign-in/sign-in-form"
import { getSession } from "@/server/auth/require-firm-access"

export const metadata: Metadata = { title: "Connexion" }

export default async function SignInPage({
  searchParams,
}: PageProps<"/auth/sign-in">) {
  const { callbackUrl } = await searchParams
  const session = await getSession()

  if (session?.user) {
    redirect(typeof callbackUrl === "string" ? callbackUrl : "/")
  }

  return (
    <main className="grid min-h-svh place-items-center bg-paper p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid size-8 place-items-center rounded-lg bg-brand text-xs font-semibold text-brand-contrast"
          >
            SX
          </span>
          <div>
            <p className="text-sm font-semibold tracking-[-0.012em]">Senexus</p>
            <p className="-mt-0.5 text-[11px] text-ink-3">Senexus Group</p>
          </div>
        </div>

        <SignInForm
          callbackUrl={typeof callbackUrl === "string" ? callbackUrl : undefined}
        />
      </div>
    </main>
  )
}
