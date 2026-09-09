"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Delete02Icon,
  PencilEdit02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons"

import type { AdminFirm } from "@/app/admin/firms/page"
import { FirmLogo } from "@/components/firm-logo"
import {
  Field,
  FormMessage,
  SubmitButton,
  fieldProps,
  inputClass,
} from "@/components/forms/form-field"
import { useActionForm } from "@/components/forms/use-action-form"
import { Panel } from "@/components/panel"
import { StatusPill, TagCode } from "@/components/primitives"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  THEME_PRESETS,
  createFirmSchema,
  deleteFirmFormSchema,
  type FirmInput,
} from "@/lib/forms/admin-schemas"
import { formatNumber } from "@/lib/format"
import { createFirm, deleteFirm, updateFirm } from "@/server/actions/admin"

/**
 * Firm administration.
 *
 * Two departures from the legacy dialog, both deliberate:
 *
 * - `themeColor` is written as **hex**. The old dialog wrote theme slugs while
 *   the seed wrote hex and the list rendered whatever it found as CSS, so a
 *   seeded firm failed validation the first time anyone edited it.
 * - Deleting requires **retyping the firm's name**. The delete cascades through
 *   every employee, contract, document and audit row the firm owns; the legacy
 *   console did it behind an ordinary confirm dialog.
 */
export function FirmsTable({ firms }: { firms: AdminFirm[] }) {
  const [editing, setEditing] = React.useState<AdminFirm | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [deleting, setDeleting] = React.useState<AdminFirm | null>(null)

  return (
    <>
      <Panel
        title="Filiales"
        description="Chaque filiale a son propre effectif, ses contrats et ses accès."
        // stats={[{ label: "Entreprises", value: formatNumber(firms.length) }]}
        tools={
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex h-[30px] items-center gap-1.5 rounded-[7px] bg-ink px-2.5 text-[12.5px] font-medium text-paper hover:opacity-90"
          >
            <HugeiconsIcon icon={PlusSignIcon} size={13} />
            Nouvelle entreprise
          </button>
        }
        padded={false}
        footer={{
          summary:
            firms.some((firm) => firm.prefixIsDefault)
              ? "Certaines entreprises utilisent un préfixe de matricule déduit de leur identifiant. Modifiez-les pour le fixer."
              : "Tous les préfixes de matricule sont définis explicitement.",
        }}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                {["Entreprise", "Matricules", "Modules", "Effectif", "Clients", "Membres", ""].map(
                  (header, index) => (
                    <th
                      key={header || index}
                      scope="col"
                      className="h-[33px] border-y border-line bg-sub px-2.5 text-left text-[11.5px] font-medium whitespace-nowrap text-ink-3 first:pl-[15px] last:pr-[15px]"
                    >
                      {header}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {firms.map((firm) => (
                <tr key={firm.id} className="hover:bg-brand-wash">
                  <td className="h-row border-b border-line px-2.5 pl-[15px]">
                    <div className="flex items-center gap-2.5">
                      <FirmLogo
                        name={firm.name}
                        logo={firm.logo}
                        themeColor={firm.themeColor}
                      />
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium">
                          {firm.name}
                        </div>
                        <div className="mono truncate text-[11.5px] text-ink-3">
                          {firm.slug}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="h-row border-b border-line px-2.5">
                    <span className="inline-flex items-center gap-1.5">
                      <TagCode>{firm.matriculePrefix}0001</TagCode>
                      {firm.prefixIsDefault ? (
                        <StatusPill tone="signal">déduit</StatusPill>
                      ) : null}
                    </span>
                  </td>
                  <td className="h-row border-b border-line px-2.5">
                    <span className="flex flex-wrap gap-1">
                      {firm.modules.length === 0 ? (
                        <span className="text-[12px] text-ink-3">aucun</span>
                      ) : (
                        firm.modules.map((slug) => (
                          <TagCode key={slug}>{slug}</TagCode>
                        ))
                      )}
                    </span>
                  </td>
                  <td className="num h-row border-b border-line px-2.5 text-right">
                    {formatNumber(firm.employees)}
                  </td>
                  <td className="num h-row border-b border-line px-2.5 text-right">
                    {formatNumber(firm.clients)}
                  </td>
                  <td className="num h-row border-b border-line px-2.5 text-right">
                    {formatNumber(firm.members)}
                  </td>
                  <td className="h-row border-b border-line px-2.5 pr-[15px]">
                    <span className="flex justify-end gap-1">
                      <IconButton
                        label={`Modifier ${firm.name}`}
                        icon={PencilEdit02Icon}
                        onClick={() => setEditing(firm)}
                      />
                      <IconButton
                        label={`Supprimer ${firm.name}`}
                        icon={Delete02Icon}
                        destructive
                        onClick={() => setDeleting(firm)}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <FirmDialog
        open={creating}
        onOpenChange={setCreating}
        firm={null}
        key={`create-${creating}`}
      />
      <FirmDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        firm={editing}
        key={editing?.id ?? "edit"}
      />
      <DeleteFirmDialog
        firm={deleting}
        onClose={() => setDeleting(null)}
        key={deleting?.id ?? "delete"}
      />
    </>
  )
}

/* -------------------------------------------------------------------------- */

function IconButton({
  label,
  icon,
  onClick,
  destructive,
}: {
  label: string
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"]
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`rounded-md p-1.5 text-ink-3 hover:bg-sunken ${
        destructive ? "hover:text-alert" : "hover:text-ink"
      }`}
    >
      <HugeiconsIcon icon={icon} size={15} />
    </button>
  )
}

/* -------------------------------------------------------------------------- */

function FirmDialog({
  open,
  onOpenChange,
  firm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  firm: AdminFirm | null
}) {
  const router = useRouter()
  const isEdit = firm !== null

  const form = useForm<FirmInput>({
    // `updateFirmSchema` is `firmSchema` plus an id the dialog does not
    // collect, so both branches parse the same shape.
    resolver: zodResolver(createFirmSchema),
    defaultValues: {
      name: firm?.name ?? "",
      slug: firm?.slug ?? "",
      logo: firm?.logo ?? "",
      themeColor: firm?.themeColor?.startsWith("#") ? firm.themeColor : "",
      matriculePrefix: firm?.prefixIsDefault ? "" : (firm?.matriculePrefix ?? ""),
    },
  })

  const { submit, pending, message, tone } = useActionForm<FirmInput, void>(
    form,
    async (values) => {
      // Create returns the new firm, update returns nothing; the form cares
      // about neither, only about success and any field errors.
      const result = isEdit
        ? await updateFirm({ ...values, id: firm.id })
        : await createFirm(values)
      return result.ok ? { ok: true, data: undefined } : result
    },
    {
      success: isEdit ? "Entreprise mise à jour." : "Entreprise créée.",
      onSuccess: () => {
        onOpenChange(false)
        router.refresh()
      },
    }
  )

  const themeColor = form.watch("themeColor")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Modifier l'entreprise" : "Créer une entreprise"}
          </DialogTitle>
          <DialogDescription>
            L&apos;identifiant apparaît dans l&apos;adresse de chaque page de
            cette entreprise.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
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
              placeholder="Connect Intérim"
              autoFocus
            />
          </Field>

          <Field
            label="Identifiant"
            htmlFor="slug"
            required
            hint="Minuscules, chiffres et tirets. Utilisé dans l'URL."
            error={form.formState.errors.slug?.message}
          >
            <input
              {...fieldProps("slug", form.formState.errors.slug?.message)}
              {...form.register("slug", {
                onChange: (event) => {
                  // Sanitise as the user types, the way the legacy dialog did:
                  // an invalid slug is a broken URL, not a validation message.
                  event.target.value = event.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9-]/g, "")
                },
              })}
              className={`${inputClass} mono`}
              placeholder="connect-interim"
            />
          </Field>

          <Field
            label="Préfixe de matricule"
            htmlFor="matriculePrefix"
            hint="1 à 4 lettres, par exemple CI ou SP. Vide : déduit de l'identifiant."
            error={form.formState.errors.matriculePrefix?.message}
          >
            <input
              {...fieldProps(
                "matriculePrefix",
                form.formState.errors.matriculePrefix?.message
              )}
              {...form.register("matriculePrefix")}
              className={`${inputClass} mono w-32 uppercase`}
              placeholder="CI"
              maxLength={4}
            />
          </Field>

          <Field
            label="Logo"
            htmlFor="logo"
            hint="URL d'une image déjà hébergée. Vide : les initiales sont utilisées."
            error={form.formState.errors.logo?.message}
          >
            <input
              {...fieldProps("logo", form.formState.errors.logo?.message)}
              {...form.register("logo")}
              className={inputClass}
              placeholder="https://…"
            />
          </Field>

          <Field
            label="Couleur de marque"
            htmlFor="themeColor"
            hint="Appliquée dès le premier affichage des pages de cette entreprise."
            error={form.formState.errors.themeColor?.message}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                {...fieldProps("themeColor", form.formState.errors.themeColor?.message)}
                {...form.register("themeColor")}
                className={`${inputClass} mono w-32`}
                placeholder="#0B5D53"
              />
              <span
                aria-hidden
                className="size-8 shrink-0 rounded-md border border-line"
                style={{
                  background:
                    themeColor && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(themeColor)
                      ? themeColor
                      : "var(--sx-sunken)",
                }}
              />
              {THEME_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  title={preset.label}
                  aria-label={preset.label}
                  onClick={() =>
                    form.setValue("themeColor", preset.value, {
                      shouldValidate: true,
                    })
                  }
                  className="size-6 rounded-md border border-line transition-transform hover:scale-110"
                  style={{ background: preset.value }}
                />
              ))}
            </div>
          </Field>

          <FormMessage tone={tone}>{message}</FormMessage>

          <DialogFooter>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="h-9 rounded-[7px] border border-line bg-surface px-3 text-[13px] hover:bg-sub"
            >
              Annuler
            </button>
            <SubmitButton pending={pending}>
              {isEdit ? "Enregistrer" : "Créer"}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* -------------------------------------------------------------------------- */

function DeleteFirmDialog({
  firm,
  onClose,
}: {
  firm: AdminFirm | null
  onClose: () => void
}) {
  const router = useRouter()
  const form = useForm<{ confirmName: string }>({
    resolver: zodResolver(deleteFirmFormSchema),
    defaultValues: { confirmName: "" },
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    async (values) => deleteFirm({ ...values, id: firm?.id ?? "" }),
    {
      success: "Entreprise supprimée.",
      onSuccess: () => {
        onClose()
        router.refresh()
      },
    }
  )

  if (!firm) return null

  const total = firm.employees + firm.clients

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Supprimer {firm.name}</DialogTitle>
          <DialogDescription>
            Cette action est irréversible et supprime tout ce que l&apos;
            entreprise contient.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md bg-alert-tint px-3 py-2.5 text-[12.5px] text-alert">
          <b className="num">{formatNumber(firm.employees)}</b> employés,{" "}
          <b className="num">{formatNumber(firm.clients)}</b> clients et tous
          leurs contrats, documents et historiques seront supprimés
          définitivement.
          {total === 0 ? " Cette entreprise est actuellement vide." : ""}
        </div>

        <form onSubmit={submit} className="space-y-3">
          <Field
            label={`Saisissez « ${firm.name} » pour confirmer`}
            htmlFor="confirmName"
            required
            error={form.formState.errors.confirmName?.message}
          >
            <input
              {...fieldProps(
                "confirmName",
                form.formState.errors.confirmName?.message
              )}
              {...form.register("confirmName")}
              className={inputClass}
              autoComplete="off"
              autoFocus
            />
          </Field>

          <FormMessage tone={tone}>{message}</FormMessage>

          <DialogFooter>
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-[7px] border border-line bg-surface px-3 text-[13px] hover:bg-sub"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={pending}
              className="h-9 rounded-[7px] bg-alert px-3 text-[13px] font-medium text-white disabled:opacity-50"
            >
              {pending ? "Suppression…" : "Supprimer définitivement"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
