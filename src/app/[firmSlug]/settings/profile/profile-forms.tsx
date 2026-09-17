"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import {
  AssetField,
  assetFrom,
  type AssetValue,
} from "@/components/forms/asset-field"
import { resolveAssets } from "@/components/forms/resolve-asset"
import {
  Field,
  FormMessage,
  SubmitButton,
  fieldProps,
  inputClass,
} from "@/components/forms/form-field"
import {
  changeOwnPasswordSchema,
  updateProfileSchema,
  type ChangeOwnPasswordInput,
  type UpdateProfileInput,
} from "@/lib/forms/profile-schema"
import { changeOwnPassword, updateProfile } from "@/server/actions/profile"
import { useActionForm } from "@/components/forms/use-action-form"

export function ProfileForm({
  defaultName,
  email,
  image,
  signatureUrl,
}: {
  defaultName: string
  email: string
  image: string | null
  signatureUrl: string | null
}) {
  const router = useRouter()
  const form = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { name: defaultName },
  })

  /**
   * Both images are self-service now.
   *
   * The photo used to say "change it from the administration for the moment",
   * which meant an administrator retyping a URL for somebody else. The
   * signature never had anywhere to go at all — and it is the one thing on
   * this account that nobody else should be setting, because it is what the
   * visas on a bon de décaissement print.
   */
  const [avatar, setAvatar] = React.useState<AssetValue>(() => assetFrom(image))
  const [signature, setSignature] = React.useState<AssetValue>(() =>
    assetFrom(signatureUrl)
  )

  const { submit, pending, message, tone } = useActionForm(
    form,
    async (values: UpdateProfileInput) => {
      const images = await resolveAssets({
        image: { value: avatar, kind: "own-avatar" },
        signatureUrl: { value: signature, kind: "own-signature" },
      })
      if (!images.ok) return { ok: false as const, message: images.message }

      return updateProfile({
        ...values,
        image: images.urls.image ?? "",
        signatureUrl: images.urls.signatureUrl ?? "",
      })
    },
    {
      success: "Profil mis à jour.",
      onSuccess: () => router.refresh(),
    }
  )

  return (
    <form onSubmit={submit} className="mt-1 space-y-3">
      <AssetField
        label="Photo"
        name="image"
        shape="avatar"
        value={avatar}
        onChange={setAvatar}
        hint="JPEG, PNG ou WebP, 5 Mo maximum."
        error={form.formState.errors.image?.message}
      />

      <AssetField
        label="Signature"
        name="signatureUrl"
        shape="signature"
        value={signature}
        onChange={setSignature}
        emptyLabel="Glissez votre signature scannée"
        hint="PNG à fond transparent. Apposée sur les bons de décaissement que vous visez."
        error={form.formState.errors.signatureUrl?.message}
      />

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
