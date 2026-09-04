"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { signIn } from "next-auth/react"

import { Panel } from "@/components/panel"

export function SignInForm({ callbackUrl }: { callbackUrl?: string }) {
  const router = useRouter()
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)

    const data = new FormData(event.currentTarget)
    const result = await signIn("credentials", {
      email: String(data.get("email") ?? ""),
      password: String(data.get("password") ?? ""),
      redirect: false,
    })

    setPending(false)

    if (!result || result.error) {
      // Deliberately does not say which of the two was wrong.
      setError("Identifiants incorrects.")
      return
    }

    router.push(callbackUrl ?? "/")
    router.refresh()
  }

  return (
    <Panel
      title="Connexion"
      description="Accès réservé aux collaborateurs du groupe."
      titleAs="h1"
    >
      <form onSubmit={onSubmit} className="mt-1 space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="email" className="block text-[12.5px] text-ink-2">
            Adresse email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            autoFocus
            className="h-9 w-full rounded-[7px] border border-line bg-surface px-2.5 text-[13px] outline-none focus:border-brand"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-[12.5px] text-ink-2">
            Mot de passe
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="h-9 w-full rounded-[7px] border border-line bg-surface px-2.5 text-[13px] outline-none focus:border-brand"
          />
        </div>

        {error ? (
          <p role="alert" className="text-[12.5px] text-alert">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="h-9 w-full rounded-[7px] bg-ink text-[13px] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Connexion…" : "Se connecter"}
        </button>
      </form>
    </Panel>
  )
}
