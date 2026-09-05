"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import {
  Field,
  FormMessage,
  SubmitButton,
  fieldProps,
  inputClass,
} from "@/components/forms/form-field"
import { Avatar } from "@/components/primitives"
import {
  changeOwnPasswordSchema,
  updateProfileSchema,
  type ChangeOwnPasswordInput,
  type UpdateProfileInput,
} from "@/lib/forms/profile-schema"
import { initials } from "@/lib/format"
import { changeOwnPassword, updateProfile } from "@/server/actions/profile"
import { useActionForm } from "@/components/forms/use-action-form"

export function ProfileForm({
  defaultName,
  email,
  image,
}: {
  defaultName: string
  email: string
  image: string | null
}) {
  const router = useRouter()
  const form = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { name: defaultName, image: image ?? "" },
  })

  const { submit, pending, message, tone } = useActionForm(form, updateProfile, {
    success: "Profil mis à jour.",
    onSuccess: () => router.refresh(),
  })

  return (
    <form onSubmit={submit} className="mt-1 space-y-3">
      <div className="flex items-center gap-3">
        <Avatar initials={initials(defaultName || email)} size={44} />
        <p className="text-[12.5px] text-ink-3">
          La photo de profil se change depuis l&apos;administration pour le
          moment.
        </p>
      </div>

      <Field
        label="Nom"
        htmlFor="name"
        required
        error={form.formState.errors.name?.message}
      >
        <input
          {...fieldProps("name", form.formState.errors.name?.message)}
          {...form.register("name")}
          className={inputClass}
          autoComplete="name"
        />
      </Field>

      <Field label="Email" htmlFor="email" hint="L'email ne peut pas être modifié ici.">
        <input
          id="email"
          value={email}
          readOnly
          disabled
          className={`${inputClass} text-ink-3`}
        />
      </Field>

      <FormMessage tone={tone}>{message}</FormMessage>

      <SubmitButton pending={pending}>Enregistrer</SubmitButton>
    </form>
  )
}

export function ChangePasswordForm() {
  const form = useForm<ChangeOwnPasswordInput>({
    resolver: zodResolver(changeOwnPasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    changeOwnPassword,
    {
      success: "Mot de passe modifié.",
      onSuccess: () => form.reset(),
    }
  )

  return (
    <form onSubmit={submit} className="mt-1 space-y-3">
      <Field
        label="Mot de passe actuel"
        htmlFor="currentPassword"
        required
        error={form.formState.errors.currentPassword?.message}
      >
        <input
          type="password"
          autoComplete="current-password"
          {...fieldProps(
            "currentPassword",
            form.formState.errors.currentPassword?.message
          )}
          {...form.register("currentPassword")}
          className={inputClass}
        />
      </Field>

      <Field
        label="Nouveau mot de passe"
        htmlFor="newPassword"
        required
        hint="Au moins 8 caractères."
        error={form.formState.errors.newPassword?.message}
      >
        <input
          type="password"
          autoComplete="new-password"
          {...fieldProps("newPassword", form.formState.errors.newPassword?.message)}
          {...form.register("newPassword")}
          className={inputClass}
        />
      </Field>

      <Field
        label="Confirmer"
        htmlFor="confirmPassword"
        required
        error={form.formState.errors.confirmPassword?.message}
      >
        <input
          type="password"
          autoComplete="new-password"
          {...fieldProps(
            "confirmPassword",
            form.formState.errors.confirmPassword?.message
          )}
          {...form.register("confirmPassword")}
          className={inputClass}
        />
      </Field>

      <FormMessage tone={tone}>{message}</FormMessage>

      <SubmitButton pending={pending} pendingLabel="Modification…">
        Modifier le mot de passe
      </SubmitButton>
    </form>
  )
}
