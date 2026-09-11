"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { HugeiconsIcon } from "@hugeicons/react"
import { Edit02Icon, PlusSignIcon } from "@hugeicons/core-free-icons"

import {
  CheckboxControl,
  DateControl,
  FieldGrid,
  SelectControl,
  TextControl,
} from "@/components/forms/controls"
import { FormMessage, SubmitButton } from "@/components/forms/form-field"
import { useActionForm } from "@/components/forms/use-action-form"
import { Panel } from "@/components/panel"
import { EmptyState, StatusPill, TwoFacts } from "@/components/primitives"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatCurrency, formatNumber } from "@/lib/format"
import {
  createAgreementSchema,
  createProviderSchema,
  updateProviderSchema,
} from "@/lib/forms/ipm-schemas"
import {
  createAgreement,
  createProvider,
  updateProvider,
} from "@/server/actions/ipm-vouchers"
import type { ProviderRow } from "@/server/queries/ipm/providers"

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Actif" },
  { value: "SUSPENDED", label: "Suspendu" },
  { value: "TERMINATED", label: "Résilié" },
] as const

const AGREEMENT_STATUS_OPTIONS = [
  { value: "ACTIVE", label: "En vigueur" },
  { value: "DRAFT", label: "Brouillon" },
  { value: "EXPIRED", label: "Échue" },
  { value: "TERMINATED", label: "Résiliée" },
] as const

const today = () => new Date().toISOString().slice(0, 10)

/**
 * Prestataires.
 *
 * The column that carries the weight is **Agréé**. A provider can be a live,
 * payable counterparty and still not be agréé for tiers payant; only the
 * second permits a bon. Collapsing the two into one "active" flag is how a bon
 * gets issued against somebody who never signed a convention, so they are
 * shown separately and refused separately.
 *
 * All 101 legacy records arrive with no convention dates at all (§4.5), which
 * is why a missing agreement only warns at issuance — refusing on it would
 * block every bon on day one — and why the count is surfaced here as work to
 * be done rather than hidden.
 */
export function ProvidersView({
  firmSlug,
  providers,
  specialties,
  canWrite,
}: {
  firmSlug: string
  providers: ProviderRow[]
  specialties: { id: string; label: string }[]
  canWrite: boolean
}) {
  const [editing, setEditing] = React.useState<ProviderRow | null | "new">(null)
  const [agreementFor, setAgreementFor] = React.useState<ProviderRow | null>(null)

  const accredited = providers.filter((provider) => provider.accredited)
  const withoutAgreement = accredited.filter(
    (provider) => !provider.hasLiveAgreement
  )
  const outstanding = providers.reduce(
    (sum, provider) => sum + provider.outstanding,
    0
  )

  return (
    <>
      <Panel
        title="Prestataires"
        description="Un bon ne peut être émis que contre un prestataire actif et agréé."
        padded={false}
        stats={[
          { label: "Prestataires", value: formatNumber(providers.length) },
          { label: "Agréés", value: formatNumber(accredited.length) },
          {
            label: "Sans convention",
            value: formatNumber(withoutAgreement.length),
            tone: withoutAgreement.length > 0 ? "signal" : undefined,
          },
          { label: "Engagé non réglé", value: formatCurrency(outstanding) },
        ]}
        tools={
          canWrite ? (
            <button
              type="button"
              onClick={() => setEditing("new")}
              className="flex h-8 items-center gap-1.5 rounded-control bg-brand px-2.5 text-[13px] font-medium text-on-brand hover:opacity-90"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={13} aria-hidden />
              Nouveau prestataire
            </button>
          ) : null
        }
        footer={
          withoutAgreement.length > 0
            ? {
                summary: `${withoutAgreement.length} prestataire${withoutAgreement.length > 1 ? "s" : ""} agréé${withoutAgreement.length > 1 ? "s" : ""} sans convention en cours — l'émission avertit sans bloquer.`,
              }
            : undefined
        }
      >
        {providers.length === 0 ? (
          <EmptyState
            title="Aucun prestataire"
            description="Les 101 fiches WebLamps arrivent avec la reprise ; en attendant, saisissez celles dont vous avez besoin."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead>
                <tr className="border-y border-line bg-sub text-left text-[11.5px] text-ink-3">
                  <th className="px-[15px] py-2 font-medium">Prestataire</th>
                  <th className="px-[15px] py-2 font-medium">Agréé</th>
                  <th className="px-[15px] py-2 font-medium">Convention</th>
                  <th className="px-[15px] py-2 font-medium">Bons</th>
                  <th className="px-[15px] py-2 font-medium">Engagé</th>
                  <th className="px-[15px] py-2 font-medium">Règlement</th>
                  <th className="px-[15px] py-2 font-medium">Statut</th>
                  {canWrite ? <th className="px-[15px] py-2" /> : null}
                </tr>
              </thead>
              <tbody>
                {providers.map((provider) => (
                  <tr key={provider.id} className="border-b border-line">
                    <td className="px-[15px] py-2.5">
                      <TwoFacts
                        primary={provider.name}
                        secondary={
                          provider.specialtyLabel ??
                          provider.accountCode ??
                          undefined
                        }
                      />
                    </td>
                    <td className="px-[15px] py-2.5">
                      {provider.accredited ? (
                        <StatusPill tone="ok">Agréé</StatusPill>
                      ) : (
                        <StatusPill tone="muted">Non agréé</StatusPill>
                      )}
                    </td>
                    <td className="px-[15px] py-2.5">
                      {provider.hasLiveAgreement ? (
                        <span className="text-ink-3">En cours</span>
                      ) : provider.agreementCount > 0 ? (
                        <span className="text-signal">Échue</span>
                      ) : (
                        <span className="text-signal">Aucune</span>
                      )}
                    </td>
                    <td className="px-[15px] py-2.5 tabular-nums text-ink-3">
                      {provider.voucherCount || "—"}
                    </td>
                    <td className="px-[15px] py-2.5 tabular-nums">
                      {provider.outstanding
                        ? formatCurrency(provider.outstanding)
                        : "—"}
                    </td>
                    <td className="px-[15px] py-2.5 tabular-nums text-ink-3">
                      {provider.paymentTermDays} j
                    </td>
                    <td className="px-[15px] py-2.5">
                      <StatusPill
                        tone={provider.status === "ACTIVE" ? "ok" : "muted"}
                      >
                        {STATUS_OPTIONS.find(
                          (option) => option.value === provider.status
                        )?.label ?? provider.status}
                      </StatusPill>
                    </td>
                    {canWrite ? (
                      <td className="px-[15px] py-2.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setAgreementFor(provider)}
                          className="rounded-control border border-line px-2 py-1 text-[12.5px] hover:bg-sub"
                        >
                          Convention
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(provider)}
                          className="ml-1.5 text-ink-3 hover:text-ink"
                          aria-label={`Modifier ${provider.name}`}
                        >
                          <HugeiconsIcon icon={Edit02Icon} size={14} />
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {editing !== null ? (
        <ProviderDialog
          firmSlug={firmSlug}
          provider={editing === "new" ? null : editing}
          specialties={specialties}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {agreementFor ? (
        <AgreementDialog
          firmSlug={firmSlug}
          provider={agreementFor}
          onClose={() => setAgreementFor(null)}
        />
      ) : null}
    </>
  )
}

function ProviderDialog({
  firmSlug,
  provider,
  specialties,
  onClose,
}: {
  firmSlug: string
  provider: ProviderRow | null
  specialties: { id: string; label: string }[]
  onClose: () => void
}) {
  const router = useRouter()
  const isEdit = provider !== null

  const form = useForm({
    resolver: zodResolver(
      isEdit ? updateProviderSchema : createProviderSchema
    ) as never,
    defaultValues: (isEdit
      ? {
          firmSlug,
          providerId: provider.id,
          name: provider.name,
          specialtyId: "",
          legacyCode: "",
          accountCode: provider.accountCode ?? "",
          address: "",
          phone: "",
          email: "",
          accredited: provider.accredited,
          status: provider.status,
          paymentTermDays: provider.paymentTermDays,
          bankName: "",
          bankAccount: "",
        }
      : {
          firmSlug,
          name: "",
          specialtyId: "",
          legacyCode: "",
          accountCode: "",
          address: "",
          phone: "",
          email: "",
          accredited: false,
          status: "ACTIVE",
          paymentTermDays: 60,
          bankName: "",
          bankAccount: "",
        }) as never,
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    (async (values: Record<string, unknown>) =>
      isEdit
        ? updateProvider(values as never)
        : createProvider(values as never)) as never,
    {
      success: isEdit ? "Prestataire modifié." : "Prestataire créé.",
      onSuccess: () => {
        onClose()
        router.refresh()
      },
    }
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92svh] w-[min(680px,calc(100%-2rem))] max-w-none overflow-y-auto sm:max-w-none">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Modifier ${provider.name}` : "Nouveau prestataire"}
          </DialogTitle>
          <DialogDescription>
            « Agréé » autorise le tiers payant. Un prestataire actif mais non
            agréé reste un fournisseur à payer ; aucun bon ne peut être émis
            contre lui.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <FieldGrid>
            <TextControl
              form={form}
              name={"name" as never}
              label="Raison sociale"
              required
              autoFocus
            />
            <SelectControl
              form={form}
              name={"specialtyId" as never}
              label="Spécialité"
              options={[
                { value: "", label: "—" },
                ...specialties.map((specialty) => ({
                  value: specialty.id,
                  label: specialty.label,
                })),
              ]}
            />
            <TextControl
              form={form}
              name={"accountCode" as never}
              label="Compte 400xxx"
              mono
            />
            <TextControl
              form={form}
              name={"legacyCode" as never}
              label="Code WebLamps"
              mono
            />
            <TextControl form={form} name={"phone" as never} label="Téléphone" type="tel" />
            <TextControl form={form} name={"email" as never} label="Email" type="email" />
            <TextControl form={form} name={"address" as never} label="Adresse" />
            <SelectControl
              form={form}
              name={"status" as never}
              label="Statut"
              required
              options={STATUS_OPTIONS}
            />
            <TextControl
              form={form}
              name={"paymentTermDays" as never}
              label="Délai de règlement (j)"
              type="number"
            />
            <TextControl form={form} name={"bankName" as never} label="Banque" />
            <TextControl
              form={form}
              name={"bankAccount" as never}
              label="Compte bancaire"
              mono
            />
          </FieldGrid>

          <CheckboxControl
            form={form}
            name={"accredited" as never}
            label="Agréé pour le tiers payant"
          />

          <FormMessage tone={tone}>{message}</FormMessage>

          <DialogFooter>
            <SubmitButton pending={pending}>
              {isEdit ? "Enregistrer" : "Créer"}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AgreementDialog({
  firmSlug,
  provider,
  onClose,
}: {
  firmSlug: string
  provider: ProviderRow
  onClose: () => void
}) {
  const router = useRouter()

  const form = useForm({
    resolver: zodResolver(createAgreementSchema) as never,
    defaultValues: {
      firmSlug,
      providerId: provider.id,
      reference: "",
      startDate: today(),
      endDate: "",
      negotiatedRate: "",
      terms: "",
      status: "ACTIVE",
    } as never,
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    (async (values: Record<string, unknown>) =>
      createAgreement(values as never)) as never,
    {
      success: "Convention enregistrée.",
      onSuccess: () => {
        onClose()
        router.refresh()
      },
    }
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(600px,calc(100%-2rem))] max-w-none sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Convention — {provider.name}</DialogTitle>
          <DialogDescription>
            La remise négociée porte sur le tarif du prestataire. Elle n&apos;est
            pas un taux de prise en charge : celui-là vient de la formule.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <FieldGrid>
            <TextControl
              form={form}
              name={"reference" as never}
              label="Référence"
              required
              autoFocus
            />
            <SelectControl
              form={form}
              name={"status" as never}
              label="Statut"
              required
              options={AGREEMENT_STATUS_OPTIONS}
            />
            <DateControl
              form={form}
              name={"startDate" as never}
              label="Début"
              required
            />
            <DateControl form={form} name={"endDate" as never} label="Fin" />
            <TextControl
              form={form}
              name={"negotiatedRate" as never}
              label="Remise négociée (%)"
            />
          </FieldGrid>

          <TextControl form={form} name={"terms" as never} label="Conditions" />

          <FormMessage tone={tone}>{message}</FormMessage>

          <DialogFooter>
            <SubmitButton pending={pending}>Enregistrer</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
