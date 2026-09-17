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
  AssetField,
  assetFrom,
  type AssetValue,
} from "@/components/forms/asset-field"
import { FieldGrid } from "@/components/forms/controls"
import { resolveAssets } from "@/components/forms/resolve-asset"
import {
  Field,
  FormMessage,
  SubmitButton,
  fieldProps,
  inputClass,
} from "@/components/forms/form-field"
import { useActionForm } from "@/components/forms/use-action-form"
import { Panel } from "@/components/panel"
import { SegmentedControl, StatusPill, TagCode } from "@/components/primitives"
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

type FirmTab = "IDENTITY" | "DOCUMENTS"

/**
 * The two panels, and which fields live on each.
 *
 * `fields` is not decoration: it is what lets the dialog say *which* tab holds
 * an invalid field when the error is on the panel that is not on screen.
 * Declared beside the tabs so a field added to one cannot quietly go
 * unaccounted for.
 */
const FIRM_TABS: {
  id: FirmTab
  label: string
  fields: (keyof FirmInput)[]
}[] = [
  {
    id: "IDENTITY",
    label: "Identité",
    fields: ["name", "slug", "matriculePrefix", "themeColor", "logo"],
  },
  {
    id: "DOCUMENTS",
    label: "Documents imprimés",
    fields: ["letterhead", "stamp"],
  },
]

/**
 * Deux onglets, parce que ce sont deux sujets.
 *
 * The dialog had grown to nine controls in one column — three of them
 * 100-pixel drop zones — and had to be scrolled to reach the brand colour.
 * Worse than the length was the ordering: the images an operator uploads once
 * a year sat between the fields they edit every time.
 *
 * So it splits along the line the content already had. **Identité** is what
 * the application shows — the name, the URL segment, the matricule prefix, the
 * brand colour and the logo the firm list draws. **Documents imprimés** is
 * what lands on paper and nowhere else: the en-tête at the top of every bon,
 * and the cachet beside a visa.
 *
 * Tabs rather than the wizard's steps: a firm's identity and its letterhead
 * have no order between them, and a two-step wizard that can be completed by
 * filling only step one is a wizard lying about being one.
 *
 * `SegmentedControl` is the switcher the rest of the product already uses for
 * this, so nothing new is introduced. It is a radiogroup, so the two panels
 * are labelled by it and the keyboard model is the one that ships.
 *
 * ## Validation across a hidden panel
 *
 * react-hook-form keeps the values of unmounted fields, so the panel that is
 * not on screen still validates — but its error would be invisible, and the
 * save button would read as broken. Rather than force the tab to switch (which
 * traps the operator on it for as long as the error lives), the offending tab
 * is **named**, with a control to go there.
 */
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
  const [tab, setTab] = React.useState<FirmTab>("IDENTITY")

  const form = useForm<FirmInput>({
    // `updateFirmSchema` is `firmSchema` plus an id the dialog does not
    // collect, so both branches parse the same shape.
    resolver: zodResolver(createFirmSchema),
    defaultValues: {
      name: firm?.name ?? "",
      slug: firm?.slug ?? "",
      themeColor: firm?.themeColor?.startsWith("#") ? firm.themeColor : "",
      matriculePrefix: firm?.prefixIsDefault ? "" : (firm?.matriculePrefix ?? ""),
    },
  })

  /**
   * The three images live beside the form rather than in it.
   *
   * react-hook-form stores strings; what the operator has chosen is a `File`
   * that does not exist on the server yet, plus the URL it will replace. That
   * pair only becomes a string once `resolveAssets` has uploaded it, which is
   * the first thing the submit handler does.
   */
  const [logo, setLogo] = React.useState<AssetValue>(() => assetFrom(firm?.logo))
  const [letterhead, setLetterhead] = React.useState<AssetValue>(() =>
    assetFrom(firm?.letterhead)
  )
  const [stamp, setStamp] = React.useState<AssetValue>(() =>
    assetFrom(firm?.stamp)
  )

  const { submit, pending, message, tone } = useActionForm<FirmInput, void>(
    form,
    async (values) => {
      // Uploaded first, so the action still receives plain strings. A refused
      // file stops here and the dialog stays open with everything typed.
      const images = await resolveAssets(
        {
          logo: { value: logo, kind: "firm-logo" },
          letterhead: { value: letterhead, kind: "firm-letterhead" },
          stamp: { value: stamp, kind: "firm-stamp" },
        },
        firm?.id
      )
      if (!images.ok) return { ok: false, message: images.message }

      const payload = {
        ...values,
        logo: images.urls.logo ?? "",
        letterhead: images.urls.letterhead ?? "",
        stamp: images.urls.stamp ?? "",
      }

      // Create returns the new firm, update returns nothing; the form cares
      // about neither, only about success and any field errors.
      const result = isEdit
        ? await updateFirm({ ...payload, id: firm.id })
        : await createFirm(payload)
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

  const errors = form.formState.errors
  const themeColor = form.watch("themeColor")

  // Derived, never stored: an error that has just been corrected must stop
  // being pointed at without anything having to clear a flag.
  const strandedTab = FIRM_TABS.find(
    (entry) =>
      entry.id !== tab && entry.fields.some((field) => errors[field] !== undefined)
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(620px,calc(100%-2rem))] max-w-none sm:max-w-none">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Modifier l'entreprise" : "Créer une entreprise"}
          </DialogTitle>
          <DialogDescription>
            L&apos;identifiant apparaît dans l&apos;adresse de chaque page de
            cette entreprise.
          </DialogDescription>
        </DialogHeader>

        <div className="border-y border-line py-2.5">
          <SegmentedControl
            ariaLabel="Section du formulaire"
            value={tab}
            onChange={setTab}
            options={FIRM_TABS.map((entry) => ({
              value: entry.id,
              label: entry.label,
            }))}
          />
        </div>

        {/* A floor rather than a fixed height: the two panels are close in
            size, and pinning them would leave a band of empty dialog under the
            shorter one. */}
        <form onSubmit={submit} className="min-h-[268px] space-y-3">
          {tab === "IDENTITY" ? (
            <>
              <div className="flex items-start gap-4">
                <AssetField
                  label="Logo"
                  name="logo"
                  shape="avatar"
                  value={logo}
                  onChange={setLogo}
                  hint="Vide : les initiales."
                  error={errors.logo?.message}
                  className="w-[104px] shrink-0"
                />

                <div className="min-w-0 flex-1 space-y-3">
                  <Field
                    label="Nom"
                    htmlFor="name"
                    required
                    error={errors.name?.message}
                  >
                    <input
                      {...fieldProps("name", errors.name?.message)}
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
                    error={errors.slug?.message}
                  >
                    <input
                      {...fieldProps("slug", errors.slug?.message)}
                      {...form.register("slug", {
                        onChange: (event) => {
                          // Sanitised as the user types, the way the legacy
                          // dialog did: an invalid slug is a broken URL, not a
                          // validation message.
                          event.target.value = event.target.value
                            .toLowerCase()
                            .replace(/[^a-z0-9-]/g, "")
                        },
                      })}
                      className={`${inputClass} mono`}
                      placeholder="connect-interim"
                    />
                  </Field>
                </div>
              </div>

              <FieldGrid columns={2}>
                <Field
                  label="Préfixe de matricule"
                  htmlFor="matriculePrefix"
                  hint="1 à 4 lettres. Vide : déduit de l'identifiant."
                  error={errors.matriculePrefix?.message}
                >
                  <input
                    {...fieldProps(
                      "matriculePrefix",
                      errors.matriculePrefix?.message
                    )}
                    {...form.register("matriculePrefix")}
                    className={`${inputClass} mono uppercase`}
                    placeholder="CI"
                    maxLength={4}
                  />
                </Field>

                <Field
                  label="Couleur de marque"
                  htmlFor="themeColor"
                  hint="Appliquée dès le premier affichage."
                  error={errors.themeColor?.message}
                >
                  <div className="flex items-center gap-1.5">
                    <input
                      {...fieldProps("themeColor", errors.themeColor?.message)}
                      {...form.register("themeColor")}
                      className={`${inputClass} mono min-w-0 flex-1`}
                      placeholder="#0B5D53"
                    />
                    <span
                      aria-hidden
                      className="size-9 shrink-0 rounded-[7px] border border-line"
                      style={{
                        background:
                          themeColor &&
                          /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(themeColor)
                            ? themeColor
                            : "var(--sx-sunken)",
                      }}
                    />
                  </div>

                  <div className="flex flex-wrap gap-1.5 pt-0.5">
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
                        className="size-5 rounded-md border border-line transition-transform hover:scale-110"
                        style={{ background: preset.value }}
                      />
                    ))}
                  </div>
                </Field>
              </FieldGrid>
            </>
          ) : (
            <>
              <p className="text-[12.5px] text-ink-3">
                Ces deux images ne s&apos;affichent nulle part dans
                l&apos;application : elles sont imprimées sur les bons, les
                factures et les bons de décaissement de cette entreprise.
              </p>

              <AssetField
                label="En-tête des documents"
                name="letterhead"
                shape="banner"
                value={letterhead}
                onChange={setLetterhead}
                emptyLabel="Glissez l'en-tête imprimé sur les bons et factures"
                hint="Image large : raison sociale, NINEA, adresse et téléphones déjà composés. Imprimée en haut de chaque document. Vide : le nom de l'entreprise est composé à sa place."
                error={errors.letterhead?.message}
              />

              <AssetField
                label="Cachet"
                name="stamp"
                shape="signature"
                value={stamp}
                onChange={setStamp}
                emptyLabel="Glissez le cachet de l'entreprise"
                hint="PNG à fond transparent. Apposé dans la case du visa, à côté de la signature du signataire."
                error={errors.stamp?.message}
              />
            </>
          )}

          <FormMessage tone={tone}>{message}</FormMessage>

          {strandedTab ? (
            <p className="text-[11.5px] text-ink-3">
              Le champ à corriger est dans{" "}
              <button
                type="button"
                onClick={() => setTab(strandedTab.id)}
                className="font-medium text-alert underline underline-offset-2"
              >
                {strandedTab.label}
              </button>
              .
            </p>
          ) : null}

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
