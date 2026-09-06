"use client"

import * as React from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { signIn } from "next-auth/react"

import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { inputClass } from "@/components/forms/form-field"
import { cn } from "@/lib/utils"
import { HugeiconsIcon } from "@hugeicons/react"
import { Loading03Icon } from "@hugeicons/core-free-icons"

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
    <form onSubmit={onSubmit}>
      <FieldGroup className="gap-5">
        <div className="flex flex-col items-center gap-3 text-center">
          {/* The mark carries the name, so the heading beneath it is the
              page's real h1 rather than a second logo in words. */}
          <Image
            src="/icons/icon-512.png"
            alt="Senexus Group"
            width={48}
            height={48}
            priority
            className="size-12 rounded-[11px]"
          />
          <div className="space-y-1">
            <h1 className="text-[19px] leading-tight font-semibold tracking-[-0.02em]">
              Connexion
            </h1>
            <p className="text-[12.5px] text-ink-3">
              Accédez à votre espace Senexus Group.
            </p>
          </div>
        </div>

        <Field>
          <FieldLabel htmlFor="email" className="text-[12.5px] text-ink-2">
            Adresse email
          </FieldLabel>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            autoFocus
            placeholder="prenom.nom@senexus.sn"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "signin-error" : undefined}
            className={inputClass}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="password" className="text-[12.5px] text-ink-2">
            Mot de passe
          </FieldLabel>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "signin-error" : undefined}
            className={inputClass}
          />
        </Field>

        {error ? (
          <p
            id="signin-error"
            role="alert"
            className="rounded-md bg-alert-tint px-2.5 py-1.5 text-[12.5px] text-alert"
          >
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className={cn(
            "flex flex-row items-center justify-center gap-2 h-9 w-full rounded-[7px] bg-ink text-[13px] font-medium text-paper",
            "transition-opacity hover:opacity-90 disabled:opacity-50"
          )}
        >
          {pending ? "Connexion…" : "Se connecter"}
          {pending ? (
            <HugeiconsIcon icon={Loading03Icon} className="ml-2 animate-spin h-4" />
          ) : null}
        </button>
      </FieldGroup>
    </form>
  )
}
