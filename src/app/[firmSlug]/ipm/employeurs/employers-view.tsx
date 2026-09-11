"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { HugeiconsIcon } from "@hugeicons/react"
import { Edit02Icon, PlusSignIcon } from "@hugeicons/core-free-icons"

import {
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
import { formatDate, formatNumber } from "@/lib/format"
import { createEmployerSchema, updateEmployerSchema } from "@/lib/forms/ipm-schemas"
import { membersHref } from "@/lib/queries/ipm/member-params"
import { createEmployer, updateEmployer } from "@/server/actions/ipm"
import type { EmployerRow } from "@/server/queries/ipm/employers"

const EMPLOYER_STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Actif" },
  { value: "SUSPENDED", label: "Suspendu" },
  { value: "TERMINATED", label: "Résilié" },
] as const

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Actif",
  SUSPENDED: "Suspendu",
  TERMINATED: "Résilié",
}

const STATUS_TONES: Record<string, "ok" | "alert" | "muted"> = {
  ACTIVE: "ok",
  SUSPENDED: "alert",
  TERMINATED: "muted",
}

/**
 * Employeurs.
 *
 * Twenty rows in the real portfolio, so this is a plain table with no
 * pagination and no facets — machinery nobody would use. Each row says whether
 * the employer prices off a formule or off its own barème, because that is the
 * distinction the settlement engine acts on and the one the IPM is in the
 * middle of migrating away from.
 */
export function EmployersView({
  firmSlug,
  employers,
  plans,
  organizations,
  canWrite,
}: {
  firmSlug: string
  employers: EmployerRow[]
  plans: { id: string; code: string; name: string }[]
  organizations: { id: string; name: string; ninea: string | null }[]
  canWrite: boolean
}) {
  const [editing, setEditing] = React.useState<EmployerRow | null | "new">(null)

  const totalMembers = employers.reduce((sum, row) => sum + row.memberCount, 0)
  const withoutPlan = employers.filter(
    (row) => row.planId === null && !row.hasOwnRates
  ).length

  return (
    <>
      <Panel
        title="Employeurs"
        description="Sociétés affiliées. Une même société peut être cliente du groupe et employeur IPM."
        padded={false}
        stats={[
          { label: "Affiliés", value: formatNumber(employers.length) },
          { label: "Participants", value: formatNumber(totalMembers) },
          {
            label: "Sans barème",
            value: formatNumber(withoutPlan),
            tone: withoutPlan > 0 ? "alert" : undefined,
          },
        ]}
        tools={
          canWrite ? (
            <button
              type="button"
              onClick={() => setEditing("new")}
              className="flex h-8 items-center gap-1.5 rounded-[7px] bg-brand px-2.5 text-[13px] font-medium text-brand-contrast hover:opacity-90"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={13} aria-hidden />
              Affilier une société
            </button>
          ) : null
        }
      >
        {employers.length === 0 ? (
          <EmptyState
            title="Aucun employeur affilié"
            description="Affiliez une société pour pouvoir y rattacher des participants."
          />
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-y border-line bg-sub text-left text-[11.5px] text-ink-3">
                <th className="px-[15px] py-2 font-medium">Société</th>
                <th className="px-[15px] py-2 font-medium">Tarification</th>
                <th className="px-[15px] py-2 font-medium">Participants</th>
                <th className="px-[15px] py-2 font-medium">Majorité</th>
                <th className="px-[15px] py-2 font-medium">Affiliation</th>
                <th className="px-[15px] py-2 font-medium">Statut</th>
                {canWrite ? <th className="px-[15px] py-2" /> : null}
              </tr>
            </thead>
            <tbody>
              {employers.map((employer) => (
                <tr key={employer.id} className="border-b border-line">
                  <td className="px-[15px] py-2.5">
                    <TwoFacts
                      primary={employer.name}
                      secondary={
                        employer.accountCode ?? employer.ninea ?? undefined
                      }
                    />
                  </td>
                  <td className="px-[15px] py-2.5">
                    {employer.hasOwnRates ? (
                      <span title="Une dérogation employeur prime sur la formule">
                        Barème propre
                      </span>
                    ) : employer.planCode ? (
                      employer.planName
                    ) : (
                      // Neither a formule nor a dérogation: nothing can be
                      // settled for these participants at all.
                      <span className="text-alert">Aucun barème</span>
                    )}
                  </td>
                  <td className="px-[15px] py-2.5 tabular-nums">
                    {employer.memberCount === 0 ? (
                      <span className="text-ink-3">—</span>
                    ) : (
                      <Link
                        href={membersHref(firmSlug, {
                          employerId: [employer.id],
                        })}
                        className="text-brand hover:underline"
                      >
                        {formatNumber(employer.activeMemberCount)}
                        <span className="text-ink-3">
                          {" "}
                          / {formatNumber(employer.memberCount)}
                        </span>
                      </Link>
                    )}
                  </td>
                  <td className="px-[15px] py-2.5 tabular-nums text-ink-3">
                    {employer.ageMajority} ans
                  </td>
                  <td className="px-[15px] py-2.5 tabular-nums text-ink-3">
                    {formatDate(employer.affiliationDate)}
                  </td>
                  <td className="px-[15px] py-2.5">
                    <StatusPill tone={STATUS_TONES[employer.status] ?? "muted"}>
                      {STATUS_LABELS[employer.status] ?? employer.status}
                    </StatusPill>
                  </td>
                  {canWrite ? (
                    <td className="px-[15px] py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => setEditing(employer)}
                        className="text-ink-3 hover:text-ink"
                        aria-label={`Modifier ${employer.name}`}
                      >
                        <HugeiconsIcon icon={Edit02Icon} size={14} />
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {editing !== null ? (
        <EmployerDialog
          firmSlug={firmSlug}
          employer={editing === "new" ? null : editing}
          plans={plans}
          organizations={organizations}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  )
}

const today = () => new Date().toISOString().slice(0, 10)

function EmployerDialog({
  firmSlug,
  employer,
  plans,
  organizations,
  onClose,
}: {
  firmSlug: string
  employer: EmployerRow | null
  plans: { id: string; code: string; name: string }[]
  organizations: { id: string; name: string; ninea: string | null }[]
  onClose: () => void
}) {
  const router = useRouter()
  const isEdit = employer !== null

  const form = useForm({
    resolver: zodResolver(
      isEdit ? updateEmployerSchema : createEmployerSchema
    ) as never,
    defaultValues: (isEdit
      ? {
          firmSlug,
          employerId: employer.id,
          organizationName: employer.name,
          ninea: employer.ninea ?? "",
          legacyEmployerCode: employer.legacyEmployerCode ?? "",
          accountCode: employer.accountCode ?? "",
          planId: employer.planId ?? "",
          affiliationDate: new Date(employer.affiliationDate)
            .toISOString()
            .slice(0, 10),
          status: employer.status,
          ageMajority: employer.ageMajority,
          ageRetirement: 60,
          reminderDelayDays: 15,
          suspensionDelayDays: 90,
        }
      : {
          firmSlug,
          organizationId: organizations[0]?.id ?? "",
          organizationName: "",
          ninea: "",
          sector: "",
          legacyEmployerCode: "",
          accountCode: "",
          planId: "",
          affiliationDate: today(),
          status: "ACTIVE",
          ageMajority: 21,
          ageRetirement: 60,
          reminderDelayDays: 15,
          suspensionDelayDays: 90,
        }) as never,
  })

  const { submit, pending, message, tone } = useActionForm(
    form,
    (async (values: Record<string, unknown>) =>
      isEdit
        ? updateEmployer(values as never)
        : createEmployer(values as never)) as never,
    {
      success: isEdit ? "Employeur modifié." : "Société affiliée.",
      onSuccess: () => {
        onClose()
        router.refresh()
      },
    }
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92svh] w-[min(700px,calc(100%-2rem))] max-w-none overflow-y-auto sm:max-w-none">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Modifier ${employer.name}` : "Affilier une société"}
          </DialogTitle>
          <DialogDescription>
            L&apos;âge de majorité décide quand un enfant cesse d&apos;être
            couvert : il vient de la convention, pas d&apos;une règle générale.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <FieldGrid>
            {isEdit ? (
              <TextControl
                form={form}
                name={"organizationName" as never}
                label="Raison sociale"
                required
              />
            ) : (
              <SelectControl
                form={form}
                name={"organizationId" as never}
                label="Société du groupe"
                options={[
                  { value: "", label: "— Nouvelle société —" },
                  ...organizations.map((organization) => ({
                    value: organization.id,
                    label: organization.name,
                  })),
                ]}
              />
            )}
            {!isEdit ? (
              <TextControl
                form={form}
                name={"organizationName" as never}
                label="…ou raison sociale"
              />
            ) : null}
            <TextControl form={form} name={"ninea" as never} label="NINEA" mono />
            <SelectControl
              form={form}
              name={"planId" as never}
              label="Formule"
              options={[
                { value: "", label: "— Barème propre —" },
                ...plans.map((plan) => ({
                  value: plan.id,
                  label: `${plan.name} (${plan.code})`,
                })),
              ]}
            />
            <TextControl
              form={form}
              name={"accountCode" as never}
              label="Compte 463xxx"
              mono
            />
            <TextControl
              form={form}
              name={"legacyEmployerCode" as never}
              label="Code WebLamps"
              mono
            />
            <DateControl
              form={form}
              name={"affiliationDate" as never}
              label="Date d'affiliation"
              required
            />
            <SelectControl
              form={form}
              name={"status" as never}
              label="Statut"
              required
              options={EMPLOYER_STATUS_OPTIONS}
            />
            <TextControl
              form={form}
              name={"ageMajority" as never}
              label="Âge de majorité"
              type="number"
            />
            <TextControl
              form={form}
              name={"suspensionDelayDays" as never}
              label="Délai de suspension (j)"
              type="number"
            />
          </FieldGrid>

          <FormMessage tone={tone}>{message}</FormMessage>

          <DialogFooter>
            <SubmitButton pending={pending}>
              {isEdit ? "Enregistrer" : "Affilier"}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
