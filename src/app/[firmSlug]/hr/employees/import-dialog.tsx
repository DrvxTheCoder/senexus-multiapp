"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import { CONTRACT_TYPE_OPTIONS } from "@/app/[firmSlug]/hr/employees/employee-dialogs"
import {
  CheckboxControl,
  FileControl,
  SelectControl,
} from "@/components/forms/controls"
import {
  FormMessage,
  SubmitButton,
} from "@/components/forms/form-field"
import { useActionForm } from "@/components/forms/use-action-form"
import { StatusPill } from "@/components/primitives"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { importEmployeesSchema } from "@/lib/forms/hr-schemas"
import { formatNumber } from "@/lib/format"
import { importEmployees, type ImportReport } from "@/server/actions/employees"

/**
 * CSV import.
 *
 * The dialog's job is to make the two decisions that decide whether an import
 * is right or quietly wrong **explicit**, rather than defaults nobody sees:
 *
 * - **How ambiguous dates are read.** `03/04/2024` is either 3 April or
 *   4 March. The files are French, so day-first is the default, and the choice
 *   is on screen rather than buried in the parser.
 * - **What happens to a probable duplicate.** Four or more matching
 *   identifying fields is a judgement, not a certainty, so it is offered as a
 *   choice and the report names every row it acted on.
 *
 * The result is a per-row report. The legacy importer returned a count.
 */

type ImportValues = {
  firmSlug: string
  file: File
  dayFirst: boolean
  skipDuplicates: boolean
  contractType: "CDI" | "CDD" | "INTERIM" | "STAGE" | "PRESTATION"
}

export function ImportEmployeesDialog({
  firmSlug,
  onClose,
}: {
  firmSlug: string
  onClose: () => void
}) {
  const router = useRouter()
  const [report, setReport] = React.useState<ImportReport | null>(null)

  const form = useForm<ImportValues>({
    resolver: zodResolver(importEmployeesSchema) as never,
    defaultValues: {
      firmSlug,
      dayFirst: true,
      skipDuplicates: true,
      contractType: "INTERIM",
    } as never,
  })

  const { submit, pending, message, tone } = useActionForm<
    ImportValues,
    ImportReport
  >(form, importEmployees, {
    onSuccess: (data) => {
      setReport(data)
      router.refresh()
    },
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92svh] w-[min(820px,calc(100%-2rem))] max-w-none overflow-y-auto sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Importer des employés</DialogTitle>
          <DialogDescription>
            Un fichier CSV avec au minimum les colonnes Prénom, Nom et Date
            d&apos;embauche. Chaque ligne importée crée aussi un contrat.
          </DialogDescription>
        </DialogHeader>

        {report ? (
          <ImportReportView report={report} onClose={onClose} />
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <FileControl
              form={form}
              name="file"
              label="Fichier CSV"
              required
              accept=".csv,text/csv"
              hint="En-têtes reconnus : Matricule, Prénom, Nom, Téléphone, Email, CNI, Date de naissance, Sexe, Date d'embauche, Poste, Catégorie, Fin de contrat, Salaire, Client, Service."
            />

            <SelectControl
              form={form}
              name="contractType"
              label="Type de contrat créé"
              options={CONTRACT_TYPE_OPTIONS}
              required
            />

            <CheckboxControl
              form={form}
              name="dayFirst"
              label="Dates au format jour/mois (03/04 = 3 avril)"
              hint="Décochez pour lire les dates ambiguës au format mois/jour. Une date qui ne peut être lue arrête la ligne, jamais le fichier."
            />

            <CheckboxControl
              form={form}
              name="skipDuplicates"
              label="Ignorer les doublons probables"
              hint="Un matricule identique suffit. Sinon, quatre champs identifiants concordants ou plus."
            />

            <FormMessage tone={tone}>{message}</FormMessage>

            <DialogFooter>
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-[7px] border border-line bg-surface px-3 text-[13px] hover:bg-sub"
              >
                Annuler
              </button>
              <SubmitButton pending={pending} pendingLabel="Import en cours…">
                Importer
              </SubmitButton>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* -------------------------------------------------------------------------- */

function ImportReportView({
  report,
  onClose,
}: {
  report: ImportReport
  onClose: () => void
}) {
  const problems = report.rows.filter((row) => row.status !== "imported")

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Metric label="Lignes" value={report.total} />
        <Metric label="Importées" value={report.imported} tone="ok" />
        <Metric label="Ignorées" value={report.skipped} tone="signal" />
        <Metric label="Échecs" value={report.failed} tone="alert" />
      </div>

      {report.unknownHeaders.length > 0 ? (
        <p className="rounded-md bg-sub px-2.5 py-1.5 text-[12px] text-ink-2">
          Colonnes non reconnues, ignorées :{" "}
          <span className="mono">{report.unknownHeaders.join(", ")}</span>
        </p>
      ) : null}

      {problems.length === 0 ? (
        <p className="rounded-md bg-ok-tint px-2.5 py-1.5 text-[12.5px] text-ok">
          Toutes les lignes ont été importées.
        </p>
      ) : (
        <div className="max-h-[40svh] overflow-y-auto rounded-lg border border-line">
          <table className="w-full border-separate border-spacing-0 text-[12.5px]">
            <thead>
              <tr>
                <th className="sticky top-0 h-8 border-b border-line bg-sub px-2.5 text-left font-medium text-ink-3">
                  Ligne
                </th>
                <th className="sticky top-0 h-8 border-b border-line bg-sub px-2.5 text-left font-medium text-ink-3">
                  Employé
                </th>
                <th className="sticky top-0 h-8 border-b border-line bg-sub px-2.5 text-left font-medium text-ink-3">
                  Résultat
                </th>
              </tr>
            </thead>
            <tbody>
              {problems.map((row) => (
                <tr key={`${row.line}-${row.name}`}>
                  <td className="num border-b border-line px-2.5 py-1.5 align-top text-ink-3">
                    {row.line}
                  </td>
                  <td className="border-b border-line px-2.5 py-1.5 align-top">
                    {row.name}
                  </td>
                  <td className="border-b border-line px-2.5 py-1.5 align-top">
                    <StatusPill
                      tone={row.status === "skipped" ? "signal" : "alert"}
                    >
                      {row.status === "skipped" ? "ignorée" : "échec"}
                    </StatusPill>{" "}
                    <span className="text-ink-2">{row.message}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DialogFooter>
        <button
          type="button"
          onClick={onClose}
          className="h-9 rounded-[7px] bg-ink px-3 text-[13px] font-medium text-paper hover:opacity-90"
        >
          Fermer
        </button>
      </DialogFooter>
    </div>
  )
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: "ok" | "signal" | "alert"
}) {
  return (
    <div className="rounded-lg border border-line px-2.5 py-1.5">
      <div className="text-[11px] text-ink-3">{label}</div>
      <div
        className={`num text-[15px] font-semibold ${
          tone === "ok"
            ? "text-ok"
            : tone === "signal"
              ? "text-signal"
              : tone === "alert"
                ? "text-alert"
                : ""
        }`}
      >
        {formatNumber(value)}
      </div>
    </div>
  )
}
