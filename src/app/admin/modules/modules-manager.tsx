"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { HugeiconsIcon } from "@hugeicons/react"
import { PlusSignIcon } from "@hugeicons/core-free-icons"

import type { AdminModule, ModuleFirm } from "@/app/admin/modules/page"
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
import { moduleSchema, type ModuleInput } from "@/lib/forms/admin-schemas"
import { formatNumber } from "@/lib/format"
import {
  createModule,
  installDocumentsModule,
  setFirmModule,
} from "@/server/actions/admin"

export function ModulesManager({
  modules,
  firms,
  hasDocumentsModule,
}: {
  modules: AdminModule[]
  firms: ModuleFirm[]
  hasDocumentsModule: boolean
}) {
  const router = useRouter()
  const [creating, setCreating] = React.useState(false)
  const [pendingKey, setPendingKey] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function toggle(
    firmId: string,
    moduleId: string,
    isEnabled: boolean | null
  ) {
    setPendingKey(`${firmId}:${moduleId}`)
    setError(null)
    const result = await setFirmModule({ firmId, moduleId, isEnabled })
    setPendingKey(null)
    if (!result.ok) {
      setError(result.message)
      return
    }
    router.refresh()
  }

  async function installDocuments() {
    setPendingKey("documents")
    setError(null)
    const result = await installDocumentsModule({})
    setPendingKey(null)
    if (!result.ok) {
      setError(result.message)
      return
    }
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-3.5">
      {/*
        Documents is gated on a module row. Without it, the nav entry and the
        Documents tab on every employee record are simply absent — which looks
        like a missing feature rather than a missing row. This is the one-click
        fix, rather than a SQL snippet in a README.
      */}
      {!hasDocumentsModule ? (
        <Panel
          title="Le module Documents n'est pas installé"
          description="Sans lui, la rubrique Documents et l'onglet Documents des fiches employés restent invisibles."
          footer={{
            summary:
              "Crée le module, le rattache au module RH et l'active pour toutes les entreprises.",
            action: (
              <button
                type="button"
                onClick={installDocuments}
                disabled={pendingKey === "documents"}
                className="h-8 rounded-[7px] bg-ink px-3 text-[12.5px] font-medium text-paper disabled:opacity-50"
              >
                {pendingKey === "documents" ? "Installation…" : "Installer Documents"}
              </button>
            ),
          }}
        >
          <p className="text-[13px] text-ink-2">
            Les pièces des employés existent déjà en base et restent rattachées
            à leur fiche ; seule leur interface est masquée.
          </p>
        </Panel>
      ) : null}

      {error ? <FormMessage>{error}</FormMessage> : null}

      <Panel
        title="Modules disponibles"
        description="Un module système ne peut pas être désinstallé d'une entreprise."
        stats={[{ label: "Modules", value: formatNumber(modules.length) }]}
        tools={
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex h-[30px] items-center gap-1.5 rounded-[7px] bg-ink px-2.5 text-[12.5px] font-medium text-paper hover:opacity-90"
          >
            <HugeiconsIcon icon={PlusSignIcon} size={13} />
            Nouveau module
          </button>
        }
        padded={false}
      >
        <ul className="border-t border-line">
          {modules.map((module) => (
            <li
              key={module.id}
              className="flex flex-wrap items-center gap-3 border-b border-line px-[15px] py-2.5 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
                  {module.name}
                  <TagCode>{module.basePath}</TagCode>
                  {module.isSystem ? (
                    <StatusPill tone="brand">système</StatusPill>
                  ) : null}
                  {module.dependsOn.length > 0 ? (
                    <span className="text-[11px] text-ink-3">
                      dépend de {module.dependsOn.join(", ")}
                    </span>
                  ) : null}
                </div>
                {module.description ? (
                  <p className="mt-px text-[11.5px] text-ink-3">
                    {module.description}
                  </p>
                ) : null}
              </div>
              <span className="num text-[12px] text-ink-3">
                v{module.version} · {formatNumber(module.installs)} entreprise
                {module.installs > 1 ? "s" : ""}
              </span>
              <StatusPill dot tone={module.isActive ? "ok" : "muted"}>
                {module.isActive ? "Actif" : "Inactif"}
              </StatusPill>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        title="Activation par entreprise"
        description="Cocher installe et active ; décocher désactive sans désinstaller."
        padded={false}
        footer={{
          summary:
            "Désactiver un module masque sa navigation et fait répondre 404 à ses routes, sans toucher aux données.",
        }}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="h-[33px] border-y border-line bg-sub px-2.5 pl-[15px] text-left text-[11.5px] font-medium text-ink-3"
                >
                  Entreprise
                </th>
                {modules.map((module) => (
                  <th
                    key={module.id}
                    scope="col"
                    className="h-[33px] border-y border-line bg-sub px-2.5 text-left text-[11.5px] font-medium whitespace-nowrap text-ink-3"
                  >
                    {module.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {firms.map((firm) => (
                <tr key={firm.id}>
                  <td className="h-row border-b border-line px-2.5 pl-[15px]">
                    <div className="text-[13px] font-medium">{firm.name}</div>
                    <div className="mono text-[11.5px] text-ink-3">{firm.slug}</div>
                  </td>
                  {modules.map((module) => {
                    const state = firm.installed[module.id]
                    const key = `${firm.id}:${module.id}`
                    const busy = pendingKey === key

                    return (
                      <td
                        key={module.id}
                        className="h-row border-b border-line px-2.5"
                      >
                        <div className="flex items-center gap-1.5">
                          <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px]">
                            <input
                              type="checkbox"
                              checked={state === true}
                              disabled={busy}
                              onChange={(event) =>
                                toggle(firm.id, module.id, event.target.checked)
                              }
                              className="size-3.5 accent-[var(--sx-brand)]"
                              aria-label={`${module.name} pour ${firm.name}`}
                            />
                            <span className="text-ink-3">
                              {state === undefined
                                ? "non installé"
                                : state
                                  ? "actif"
                                  : "désactivé"}
                            </span>
                          </label>

                          {state !== undefined && !module.isSystem ? (
                            <button
                              type="button"
                              onClick={() => toggle(firm.id, module.id, null)}
                              disabled={busy}
                              className="text-[11px] text-ink-3 underline-offset-2 hover:text-alert hover:underline"
                            >
                              désinstaller
                            </button>
                          ) : null}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {creating ? (
        <ModuleDialog onClose={() => setCreating(false)} />
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function ModuleDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const form = useForm<ModuleInput>({
    resolver: zodResolver(moduleSchema),
    defaultValues: {
      slug: "",
      name: "",
      description: "",
      version: "1.0.0",
      basePath: "",
      icon: "",
    },
  })

  const { submit, pending, message, tone } = useActionForm<ModuleInput, void>(
    form,
    async (values) => {
      const result = await createModule(values)
      return result.ok ? { ok: true, data: undefined } : result
    },
    {
      onSuccess: () => {
        onClose()
        router.refresh()
      },
    }
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nouveau module</DialogTitle>
          <DialogDescription>
            Un module regroupe des routes et se active par entreprise. Les
            routes correspondantes doivent exister dans l&apos;application.
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
              placeholder="Documents"
              autoFocus
            />
          </Field>

          <Field
            label="Identifiant"
            htmlFor="slug"
            required
            hint="Doit correspondre au slug attendu par les routes."
            error={form.formState.errors.slug?.message}
          >
            <input
              {...fieldProps("slug", form.formState.errors.slug?.message)}
              {...form.register("slug", {
                onChange: (event) => {
                  event.target.value = event.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9-]/g, "")
                },
              })}
              className={`${inputClass} mono`}
              placeholder="documents"
            />
          </Field>

          <Field
            label="Chemin de base"
            htmlFor="basePath"
            required
            error={form.formState.errors.basePath?.message}
          >
            <input
              {...fieldProps("basePath", form.formState.errors.basePath?.message)}
              {...form.register("basePath")}
              className={`${inputClass} mono`}
              placeholder="/documents"
            />
          </Field>

          <Field
            label="Description"
            htmlFor="description"
            error={form.formState.errors.description?.message}
          >
            <input
              {...fieldProps("description", form.formState.errors.description?.message)}
              {...form.register("description")}
              className={inputClass}
            />
          </Field>

          <Field
            label="Version"
            htmlFor="version"
            error={form.formState.errors.version?.message}
          >
            <input
              {...fieldProps("version", form.formState.errors.version?.message)}
              {...form.register("version")}
              className={`${inputClass} mono w-32`}
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
            <SubmitButton pending={pending}>Créer</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
