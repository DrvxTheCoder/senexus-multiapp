"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons"

import { ComboboxField } from "@/components/forms/combobox-field"
import { DateField, SelectField } from "@/components/forms/controls"
import { FormMessage, SubmitButton } from "@/components/forms/form-field"
import { Panel } from "@/components/panel"
import { StatusPill } from "@/components/primitives"
import { formatCurrency } from "@/lib/format"
import { issueVoucher, previewVoucher, type IssuancePreview } from "@/server/actions/ipm-vouchers"

type MemberOption = {
  id: string
  matricule: string
  name: string
  status: string
  dependents: { id: string; name: string; relation: string }[]
}

type Line = { label: string; quantity: string; unitPrice: string }

const TYPE_LABELS = {
  PHARMACY: "Bon de pharmacie (BPI)",
  OPTICAL: "Bon d'optique (BCI)",
  GUARANTEE: "Lettre de garantie (LGI)",
  HOSPITALIZATION: "Lettre d'hospitalisation (LHI)",
} as const

const TYPE_OPTIONS = Object.entries(TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}))

const today = () => new Date().toISOString().slice(0, 10)

/**
 * Émission d'un bon.
 *
 * The screen is built around the **pre-flight**, not around the form. The
 * operator sees the verdict — every refusal, every warning, and the split the
 * institution would commit to — before anything is written, because at a
 * counter the useful answer to "can I issue this" is the reason, not a
 * rejected submit.
 *
 * The same rules run again on the server when Émettre is pressed. This
 * preview is a courtesy; it is not the check.
 */
export function IssueVoucherForm({
  firmSlug,
  members,
  providers,
  serviceTypes,
}: {
  firmSlug: string
  members: MemberOption[]
  providers: { id: string; name: string; specialtyLabel: string | null }[]
  serviceTypes: {
    id: string
    code: string
    label: string
    categoryLabel: string
  }[]
}) {
  const router = useRouter()

  const [type, setType] = React.useState<keyof typeof TYPE_LABELS>("PHARMACY")
  const [memberId, setMemberId] = React.useState(members[0]?.id ?? "")
  const [dependentId, setDependentId] = React.useState("")
  const [providerId, setProviderId] = React.useState(providers[0]?.id ?? "")
  const [serviceTypeId, setServiceTypeId] = React.useState(
    serviceTypes[0]?.id ?? ""
  )
  const [issueDate, setIssueDate] = React.useState(today())
  const [lines, setLines] = React.useState<Line[]>([
    { label: "", quantity: "1", unitPrice: "" },
  ])
  const [acknowledge, setAcknowledge] = React.useState(false)

  /**
   * The verdict is keyed by the inputs it was computed from, and read back
   * during render rather than cleared by an effect. That is what makes a stale
   * "émission autorisée" impossible to display under a changed amount: when
   * the key does not match, there is simply no verdict to show.
   */
  const [preview, setPreview] = React.useState<{
    key: string
    data: IssuancePreview | null
    error: string | null
  } | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)

  const member = members.find((entry) => entry.id === memberId) ?? null

  const payload = React.useMemo(
    () => ({
      firmSlug,
      type,
      memberId,
      dependentId: dependentId || undefined,
      providerId,
      serviceTypeId,
      issueDate,
      lines: lines
        .filter((line) => line.label.trim() && line.unitPrice.trim())
        .map((line) => ({
          label: line.label.trim(),
          quantity: Number(line.quantity) || 1,
          unitPrice: line.unitPrice.replace(/\s/g, ""),
        })),
    }),
    [firmSlug, type, memberId, dependentId, providerId, serviceTypeId, issueDate, lines]
  )

  const complete = Boolean(
    payload.lines.length > 0 && memberId && providerId && serviceTypeId
  )
  const payloadKey = JSON.stringify(payload)

  // Only the verdict computed from *these* inputs counts. Anything else is a
  // verdict about a bon the operator is no longer looking at.
  const current = preview?.key === payloadKey ? preview : null
  const checking = complete && current === null

  React.useEffect(() => {
    if (!complete) return

    let cancelled = false
    const timer = setTimeout(async () => {
      const result = await previewVoucher(payload)
      if (cancelled) return
      setPreview({
        key: payloadKey,
        data: result.ok ? result.data : null,
        error: result.ok ? null : result.message,
      })
    }, 350)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [payload, payloadKey, complete])

  const localTotal = payload.lines.reduce(
    (sum, line) => sum + Math.round(line.quantity * Number(line.unitPrice || 0)),
    0
  )

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setSubmitError(null)

    const result = await issueVoucher({ ...payload, acknowledgeWarnings: acknowledge })
    setSubmitting(false)

    if (!result.ok) {
      setSubmitError(result.message)
      return
    }
    router.push(`/${firmSlug}/ipm/bons`)
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="grid gap-3.5 lg:grid-cols-[1fr_340px]">
      <div className="space-y-3.5">
        <Panel titleAs="h2" title="Bénéficiaire et prestataire">
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              id="voucher-type"
              label="Type de bon"
              value={type}
              onChange={(next) => setType(next as keyof typeof TYPE_LABELS)}
              options={TYPE_OPTIONS}
            />

            <DateField
              id="voucher-issue-date"
              label="Date d'émission"
              value={issueDate}
              onChange={setIssueDate}
            />

            {/*
              A register, not an enumeration: the participant list grows with
              the institution, so this one is typed into rather than scrolled.
              The matricule is searchable even though the name is what reads.
            */}
            <ComboboxField
              id="voucher-member"
              label="Participant"
              value={memberId}
              onChange={(next) => {
                setMemberId(next)
                // The dependents belong to the member who was selected; keeping
                // the old one would point the bon at someone else's child.
                setDependentId("")
              }}
              placeholder="Nom ou matricule"
              emptyLabel="Aucun participant."
              options={members.map((entry) => ({
                value: entry.id,
                label: entry.name,
                hint: entry.matricule,
              }))}
            />

            {/*
              An empty value means the bon is for the participant themself, so
              that reading is the placeholder and the clear button is how you
              get back to it.
            */}
            <SelectField
              id="voucher-dependent"
              label="Pour"
              value={dependentId}
              onChange={setDependentId}
              placeholder="Le participant"
              disabled={(member?.dependents.length ?? 0) === 0}
              options={(member?.dependents ?? []).map((dependent) => ({
                value: dependent.id,
                label: `${dependent.name} · ${dependent.relation}`,
              }))}
            />

            <SelectField
              id="voucher-provider"
              label="Prestataire"
              value={providerId}
              onChange={setProviderId}
              options={providers.map((provider) => ({
                value: provider.id,
                label: provider.specialtyLabel
                  ? `${provider.name} · ${provider.specialtyLabel}`
                  : provider.name,
              }))}
            />

            <SelectField
              id="voucher-service-type"
              label="Prestation"
              value={serviceTypeId}
              onChange={setServiceTypeId}
              options={serviceTypes.map((serviceType) => ({
                value: serviceType.id,
                label: `${serviceType.categoryLabel} · ${serviceType.label}`,
              }))}
            />
          </div>

          {providers.length === 0 ? (
            <p className="mt-3 text-[12.5px] text-alert">
              Aucun prestataire agréé et actif : un bon ne peut être émis contre
              personne.
            </p>
          ) : null}
        </Panel>

        <Panel
          titleAs="h2"
          title="Lignes"
          description="Le total est la somme des lignes ; il ne se saisit pas."
          tools={
            <button
              type="button"
              onClick={() =>
                setLines((state) => [
                  ...state,
                  { label: "", quantity: "1", unitPrice: "" },
                ])
              }
              className="flex h-8 items-center gap-1.5 rounded-[7px] border border-line px-2.5 text-[13px] hover:bg-sub"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={13} aria-hidden />
              Ligne
            </button>
          }
        >
          <div className="space-y-2">
            {lines.map((line, index) => (
              <div key={index} className="flex items-end gap-2">
                <Field label={index === 0 ? "Désignation" : ""} className="flex-1">
                  <input
                    value={line.label}
                    onChange={(event) =>
                      setLines((state) =>
                        state.map((entry, i) =>
                          i === index ? { ...entry, label: event.target.value } : entry
                        )
                      )
                    }
                    placeholder="Paracétamol 1 g, boîte de 8"
                    className={lineInputClass}
                  />
                </Field>
                <Field label={index === 0 ? "Qté" : ""} className="w-20">
                  <input
                    value={line.quantity}
                    onChange={(event) =>
                      setLines((state) =>
                        state.map((entry, i) =>
                          i === index
                            ? { ...entry, quantity: event.target.value }
                            : entry
                        )
                      )
                    }
                    className={`${lineInputClass} tabular-nums`}
                  />
                </Field>
                <Field label={index === 0 ? "Prix unitaire" : ""} className="w-36">
                  <input
                    value={line.unitPrice}
                    onChange={(event) =>
                      setLines((state) =>
                        state.map((entry, i) =>
                          i === index
                            ? { ...entry, unitPrice: event.target.value }
                            : entry
                        )
                      )
                    }
                    placeholder="0"
                    className={`${lineInputClass} tabular-nums`}
                  />
                </Field>
                <button
                  type="button"
                  onClick={() =>
                    setLines((state) =>
                      state.length === 1
                        ? state
                        : state.filter((_, i) => i !== index)
                    )
                  }
                  disabled={lines.length === 1}
                  className="mb-1 text-ink-3 hover:text-alert disabled:opacity-30"
                  aria-label="Retirer la ligne"
                >
                  <HugeiconsIcon icon={Delete02Icon} size={15} />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-3 flex justify-end border-t border-line pt-2.5 text-[13px]">
            <span className="text-ink-3">Total&nbsp;</span>
            <span className="ml-2 font-medium tabular-nums">
              {formatCurrency(localTotal)}
            </span>
          </div>
        </Panel>
      </div>

      {/* ---- pre-flight -------------------------------------------------- */}
      <div className="space-y-3.5">
        <Panel
          titleAs="h2"
          title="Contrôle des droits"
          description={
            checking
              ? "Vérification…"
              : (current?.data?.beneficiaryName ??
                "Complétez le bon pour voir le résultat.")
          }
        >
          {current?.data ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <HugeiconsIcon
                  icon={current.data.allowed ? CheckmarkCircle02Icon : Alert02Icon}
                  size={16}
                  className={current.data.allowed ? "text-ok" : "text-alert"}
                  aria-hidden
                />
                <span className="text-[13px] font-semibold">
                  {current.data.allowed ? "Émission autorisée" : "Émission refusée"}
                </span>
              </div>

              {/* Every reason, in one pass — not the first one. */}
              {current.data.refusals.length > 0 ? (
                <ul className="space-y-1.5 text-[12.5px] text-alert">
                  {current.data.refusals.map((refusal) => (
                    <li key={refusal.code}>{refusal.message}</li>
                  ))}
                </ul>
              ) : null}

              {current.data.warnings.length > 0 ? (
                <div className="space-y-1.5">
                  <ul className="space-y-1.5 text-[12.5px] text-signal">
                    {current.data.warnings.map((warning) => (
                      <li key={warning.code}>{warning.message}</li>
                    ))}
                  </ul>
                  {current.data.allowed ? (
                    <label className="flex items-start gap-2 text-[12.5px]">
                      <input
                        type="checkbox"
                        checked={acknowledge}
                        onChange={(event) => setAcknowledge(event.target.checked)}
                        className="mt-0.5"
                      />
                      <span>Émettre malgré cet avertissement</span>
                    </label>
                  ) : null}
                </div>
              ) : null}

              {current.data.allowed ? (
                <dl className="space-y-1.5 border-t border-line pt-2.5 text-[13px]">
                  <Row label="Total" value={formatCurrency(current.data.totalAmount)} />
                  <Row
                    label="Part IPM"
                    value={formatCurrency(current.data.insurerShare)}
                    strong
                  />
                  <Row
                    label="Ticket modérateur"
                    value={formatCurrency(current.data.memberShare)}
                  />
                  <Row
                    label="Taux appliqué"
                    value={
                      current.data.appliedRate === null
                        ? "—"
                        : `${Math.round(current.data.appliedRate * 1000) / 10} %`
                    }
                  />
                  <Row
                    label="Origine du taux"
                    value={
                      current.data.rateSource === "EMPLOYER"
                        ? "Dérogation employeur"
                        : current.data.rateSource === "PLAN"
                          ? "Formule"
                          : "—"
                    }
                  />
                </dl>
              ) : null}
            </div>
          ) : (
            <p className="text-[13px] text-ink-3">
              Le contrôle porte sur le participant, l&apos;ayant droit, les
              cotisations, le prestataire, le barème, la carence et les
              plafonds.
            </p>
          )}
        </Panel>

        {member && member.status !== "ACTIVE" ? (
          <StatusPill tone="alert">
            Participant {member.status.toLowerCase()}
          </StatusPill>
        ) : null}

        <FormMessage tone="error">{submitError ?? current?.error}</FormMessage>

        <SubmitButton
          pending={submitting}
          disabled={!current?.data?.allowed || checking}
        >
          Émettre le bon
        </SubmitButton>
      </div>
    </form>
  )
}

/**
 * The line-item inputs only. Everything above them now uses the shared
 * controls; these stay bare because the lines are a compact grid whose labels
 * appear on the first row alone, which `Field` does not model.
 */
const lineInputClass =
  "h-8 w-full rounded-[7px] border border-line bg-surface px-2 text-[13px] outline-none focus:border-brand"

function Field({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      {label ? (
        <span className="mb-1 block text-[11.5px] text-ink-3">{label}</span>
      ) : null}
      {children}
    </label>
  )
}

function Row({
  label,
  value,
  strong,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-3">{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</dd>
    </div>
  )
}
