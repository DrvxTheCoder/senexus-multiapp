"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Alert02Icon,
  ArrowLeft01Icon,
  CheckmarkCircle02Icon,
  Download01Icon,
  File01Icon,
  Upload04Icon,
} from "@hugeicons/core-free-icons"

import { FormMessage } from "@/components/forms/form-field"
import { StatusPill } from "@/components/primitives"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { CONTRACT_TYPES } from "@/lib/forms/hr-schemas"
import { formatNumber } from "@/lib/format"
import {
  parseEmployeeCsv,
  type ParsedRow,
  type ParseResult,
} from "@/server/domain/csv-import"
import { importEmployees, type ImportReport } from "@/server/actions/employees"
import { cn } from "@/lib/utils"

/**
 * The employee import.
 *
 * Three steps, and the middle one is the point: **nothing is written until the
 * file has been read back to you.** The first version took a file and a couple
 * of checkboxes and reported afterwards what it had done, which is the wrong
 * way round — by then the rows are in the database.
 *
 * Parsing happens in the browser for the preview and **again on the server**
 * for the import, over the same bytes with the same function
 * (`parseEmployeeCsv`, which is deliberately free of `server-only`). The client
 * sends the file's text and the decisions made here, never a list of rows it
 * assembled: the preview is an aid, the server is the gate.
 *
 * Two severities, because they mean different things. An **error** is a row
 * that cannot become an employee. A **warning** is a row that will import with
 * a gap in it — no CNI, no nationality — and refusing those would reject most
 * of a real file.
 */

const ROWS_PER_PAGE = 10

const CONTRACT_TYPE_LABELS: Record<string, string> = {
  INTERIM: "Intérim",
  CDD: "CDD",
  CDI: "CDI",
  STAGE: "Stage",
  PRESTATION: "Prestation",
}

/** The header row of a file this importer reads without any mapping. */
const TEMPLATE_HEADERS = [
  "PRENOM",
  "NOM",
  "DATE DE NAISSANCE",
  "LIEU DE NAISSANCE",
  "SITUATION MATRIMONIALE",
  "NATIONALITE",
  "CNI",
  "TELEPHONE",
  "EMPLOI",
  "CATEGORIE",
  "TYPE CONTRAT",
  "DATE ENTREE",
  "DATE SORTIE",
  "SALAIRE",
  "CLIENT",
]

type Step = "choose" | "review" | "done"

export function ImportEmployeesDialog({
  firmSlug,
  clients,
  onClose,
}: {
  firmSlug: string
  clients: { id: string; name: string }[]
  onClose: () => void
}) {
  const router = useRouter()

  const [step, setStep] = React.useState<Step>("choose")
  const [file, setFile] = React.useState<{ name: string; text: string } | null>(
    null
  )
  const [dayFirst, setDayFirst] = React.useState(true)
  const [skipDuplicates, setSkipDuplicates] = React.useState(true)
  const [defaultContractType, setDefaultContractType] = React.useState("")
  const [defaultClientId, setDefaultClientId] = React.useState("")

  const [selected, setSelected] = React.useState<Set<number>>(new Set())
  const [page, setPage] = React.useState(1)
  const [expanded, setExpanded] = React.useState<number | null>(null)

  const [pending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)
  const [report, setReport] = React.useState<ImportReport | null>(null)

  /**
   * Re-parsed whenever the file or either reading decision changes, so
   * flipping the date convention re-validates in front of you rather than
   * being discovered after the import.
   */
  const parsed: ParseResult | null = React.useMemo(() => {
    if (!file) return null
    return parseEmployeeCsv(file.text, dayFirst, {
      defaultContractType: defaultContractType || undefined,
    })
  }, [file, dayFirst, defaultContractType])

  // Everything importable is ticked by default; a fresh parse re-ticks it,
  // because a row that just became valid should not stay excluded.
  const parseKey = parsed
    ? `${file?.name}:${dayFirst}:${defaultContractType}:${parsed.rows.length}`
    : ""
  const [lastKey, setLastKey] = React.useState("")
  if (parsed && parseKey !== lastKey) {
    setLastKey(parseKey)
    setSelected(
      new Set(
        parsed.rows.filter((row) => row.status !== "error").map((row) => row.line)
      )
    )
    setPage(1)
  }

  function accept(chosen: File | undefined) {
    setError(null)
    if (!chosen) return
    if (!/\.csv$/i.test(chosen.name) && chosen.type !== "text/csv") {
      setError("Un fichier .csv est attendu.")
      return
    }
    void chosen.text().then((text) => {
      setFile({ name: chosen.name, text })
      setStep("review")
    })
  }

  function run(lines: number[]) {
    if (!file) return
    setError(null)
    startTransition(async () => {
      const result = await importEmployees({
        firmSlug,
        csv: file.text,
        dayFirst,
        skipDuplicates,
        defaultContractType: defaultContractType || undefined,
        defaultClientId: defaultClientId || undefined,
        lines,
      })
      if (!result.ok) {
        setError(result.message)
        return
      }
      setReport(result.data)
      setStep("done")
      router.refresh()
    })
  }

  const rows = parsed?.rows ?? []
  const pageCount = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE))
  const visible = rows.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE)
  const importable = rows.filter((row) => row.status !== "error")
  const selectedRows = rows.filter((row) => selected.has(row.line))

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={cn(
          "max-h-[92svh] max-w-none overflow-y-auto sm:max-w-none",
          step === "review"
            ? "w-[min(1180px,calc(100%-2rem))]"
            : "w-[min(680px,calc(100%-2rem))]"
        )}
      >
        <DialogHeader>
          <DialogTitle>Importer des employés</DialogTitle>
          <DialogDescription>
            {step === "choose"
              ? "Un fichier CSV. Rien n'est écrit avant que vous ayez vu ce qu'il contient."
              : step === "review"
                ? `${file?.name} — vérifiez, corrigez les réglages, puis importez.`
                : "Résultat de l'import."}
          </DialogDescription>
        </DialogHeader>

        {error ? <FormMessage>{error}</FormMessage> : null}

        {step === "choose" ? (
          <DropZone onFile={accept} />
        ) : step === "review" && parsed ? (
          <>
            <Controls
              clients={clients}
              dayFirst={dayFirst}
              onDayFirst={setDayFirst}
              skipDuplicates={skipDuplicates}
              onSkipDuplicates={setSkipDuplicates}
              defaultContractType={defaultContractType}
              onDefaultContractType={setDefaultContractType}
              defaultClientId={defaultClientId}
              onDefaultClientId={setDefaultClientId}
            />

            <Counters summary={parsed.summary} />

            {parsed.unknownHeaders.length > 0 ? (
              <p className="rounded-md bg-sub px-2.5 py-1.5 text-[12px] text-ink-2">
                Colonnes non reconnues, ignorées :{" "}
                <span className="mono">{parsed.unknownHeaders.join(", ")}</span>
              </p>
            ) : null}

            <PreviewTable
              rows={visible}
              all={rows}
              selected={selected}
              onToggle={(line) =>
                setSelected((current) => {
                  const next = new Set(current)
                  if (next.has(line)) next.delete(line)
                  else next.add(line)
                  return next
                })
              }
              onToggleAll={(checked) =>
                setSelected(
                  checked
                    ? new Set(importable.map((row) => row.line))
                    : new Set()
                )
              }
              expanded={expanded}
              onExpand={setExpanded}
            />

            <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
              <span className="num">
                Page {page} sur {pageCount} · {formatNumber(rows.length)} ligne
                {rows.length > 1 ? "s" : ""}
              </span>
              <div className="ml-auto flex gap-1.5">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="h-7 rounded-[7px] border border-line bg-surface px-2.5 disabled:opacity-40"
                >
                  Précédent
                </button>
                <button
                  type="button"
                  disabled={page >= pageCount}
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  className="h-7 rounded-[7px] border border-line bg-surface px-2.5 disabled:opacity-40"
                >
                  Suivant
                </button>
              </div>
            </div>
          </>
        ) : report ? (
          <ImportReportView report={report} />
        ) : null}

        <DialogFooter>
          {step === "review" ? (
            <button
              type="button"
              onClick={() => {
                setFile(null)
                setStep("choose")
              }}
              className="mr-auto inline-flex h-9 items-center gap-1.5 rounded-[7px] border border-line bg-surface px-3 text-[13px] hover:bg-sub"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
              Changer de fichier
            </button>
          ) : null}

          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-[7px] border border-line bg-surface px-3 text-[13px] hover:bg-sub"
          >
            {step === "done" ? "Fermer" : "Annuler"}
          </button>

          {step === "review" ? (
            <>
              <button
                type="button"
                disabled={pending || importable.length === 0}
                onClick={() => run(importable.map((row) => row.line))}
                className="h-9 rounded-[7px] border border-line bg-surface px-3 text-[13px] hover:bg-sub disabled:opacity-40"
              >
                Importer les {formatNumber(importable.length)} valides
              </button>
              <button
                type="button"
                disabled={pending || selectedRows.length === 0}
                onClick={() => run(selectedRows.map((row) => row.line))}
                className="h-9 rounded-[7px] bg-ink px-3 text-[13px] font-medium text-paper hover:opacity-90 disabled:opacity-40"
              >
                {pending
                  ? "Import…"
                  : `Importer la sélection (${formatNumber(selectedRows.length)})`}
              </button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ==========================================================================
 * Step 1
 * ========================================================================== */

function DropZone({ onFile }: { onFile: (file: File | undefined) => void }) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [over, setOver] = React.useState(false)

  return (
    <div className="space-y-2.5">
      <div
        onDragOver={(event) => {
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setOver(false)
          onFile(event.dataTransfer.files?.[0])
        }}
        className={cn(
          "rounded-lg border border-dashed px-6 py-12 text-center transition-colors",
          over ? "border-brand bg-brand-wash" : "border-line-2 bg-sub"
        )}
      >
        <HugeiconsIcon
          icon={Upload04Icon}
          size={28}
          strokeWidth={1.6}
          className="mx-auto text-ink-3"
        />
        <p className="mt-2.5 text-[13px]">
          Glissez-déposez un fichier CSV, ou{" "}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="font-medium text-brand underline-offset-2 hover:underline"
          >
            parcourez vos fichiers
          </button>
          .
        </p>
        <p className="mt-1 text-[11.5px] text-ink-3">
          Colonnes attendues : PRENOM, NOM, DATE ENTREE, TYPE CONTRAT — le reste
          est facultatif.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(event) => onFile(event.target.files?.[0])}
        />
      </div>

      <div className="flex items-center gap-2 text-[12px] text-ink-3">
        <HugeiconsIcon icon={File01Icon} size={13} />
        <span className="flex-1">
          Un employé et son premier contrat sont créés par ligne importée.
        </span>
        <button
          type="button"
          onClick={() => {
            const csv = `${TEMPLATE_HEADERS.join(",")}\n`
            const url = URL.createObjectURL(
              new Blob([csv], { type: "text/csv;charset=utf-8" })
            )
            const link = document.createElement("a")
            link.href = url
            link.download = "modele-import-employes.csv"
            link.click()
            URL.revokeObjectURL(url)
          }}
          className="inline-flex items-center gap-1.5 rounded-[7px] border border-line bg-surface px-2 py-1 hover:bg-sub"
        >
          <HugeiconsIcon icon={Download01Icon} size={13} />
          Modèle vierge
        </button>
      </div>
    </div>
  )
}

/* ==========================================================================
 * Step 2
 * ========================================================================== */

function Controls({
  clients,
  dayFirst,
  onDayFirst,
  skipDuplicates,
  onSkipDuplicates,
  defaultContractType,
  onDefaultContractType,
  defaultClientId,
  onDefaultClientId,
}: {
  clients: { id: string; name: string }[]
  dayFirst: boolean
  onDayFirst: (value: boolean) => void
  skipDuplicates: boolean
  onSkipDuplicates: (value: boolean) => void
  defaultContractType: string
  onDefaultContractType: (value: string) => void
  defaultClientId: string
  onDefaultClientId: (value: string) => void
}) {
  const selectClass =
    "h-8 rounded-[7px] border border-line bg-surface px-2 text-[12.5px]"

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-sub px-3 py-2.5">
      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] text-ink-3">
          Type de contrat par défaut
        </span>
        <select
          value={defaultContractType}
          onChange={(event) => onDefaultContractType(event.target.value)}
          className={selectClass}
        >
          <option value="">Celui du fichier</option>
          {CONTRACT_TYPES.map((type) => (
            <option key={type} value={type}>
              {CONTRACT_TYPE_LABELS[type] ?? type}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] text-ink-3">Client à affecter</span>
        <select
          value={defaultClientId}
          onChange={(event) => onDefaultClientId(event.target.value)}
          className={cn(selectClass, "max-w-[220px]")}
        >
          <option value="">Aucun</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px]">
        <input
          type="checkbox"
          checked={dayFirst}
          onChange={(event) => onDayFirst(event.target.checked)}
          className="size-3.5 accent-brand"
        />
        Dates jour/mois
      </label>

      <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px]">
        <input
          type="checkbox"
          checked={skipDuplicates}
          onChange={(event) => onSkipDuplicates(event.target.checked)}
          className="size-3.5 accent-brand"
        />
        Ignorer les doublons
      </label>

      <p className="ml-auto max-w-[280px] text-[11px] text-ink-3">
        Changer un réglage revalide le fichier immédiatement — les compteurs
        ci-dessous suivent.
      </p>
    </div>
  )
}

function Counters({
  summary,
}: {
  summary: { total: number; valid: number; warnings: number; errors: number }
}) {
  const cards = [
    { label: "Lignes", value: summary.total, tone: "" },
    { label: "Prêtes", value: summary.valid, tone: "text-ok" },
    { label: "Avec réserve", value: summary.warnings, tone: "text-signal" },
    { label: "Bloquées", value: summary.errors, tone: "text-alert" },
  ]
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-lg border border-line bg-surface px-3 py-2"
        >
          <div className="text-[11.5px] text-ink-3">{card.label}</div>
          <div
            className={cn(
              "num mt-0.5 text-[22px] leading-none font-semibold tracking-[-0.02em]",
              card.tone
            )}
          >
            {formatNumber(card.value)}
          </div>
        </div>
      ))}
    </div>
  )
}

function PreviewTable({
  rows,
  all,
  selected,
  onToggle,
  onToggleAll,
  expanded,
  onExpand,
}: {
  rows: ParsedRow[]
  all: ParsedRow[]
  selected: Set<number>
  onToggle: (line: number) => void
  onToggleAll: (checked: boolean) => void
  expanded: number | null
  onExpand: (line: number | null) => void
}) {
  const importable = all.filter((row) => row.status !== "error")
  const allTicked =
    importable.length > 0 && importable.every((row) => selected.has(row.line))

  const head =
    "sticky top-0 h-8 border-b border-line bg-sub px-2.5 text-left text-[11.5px] font-medium text-ink-3"

  return (
    <div className="max-h-[42svh] overflow-auto rounded-lg border border-line">
      <table className="w-full border-separate border-spacing-0 text-[12.5px]">
        <thead>
          <tr>
            <th className={cn(head, "w-9")}>
              <input
                type="checkbox"
                checked={allTicked}
                onChange={(event) => onToggleAll(event.target.checked)}
                aria-label="Tout sélectionner"
                className="size-3.5 accent-brand"
              />
            </th>
            <th className={cn(head, "w-10")}>#</th>
            <th className={head}>Prénom</th>
            <th className={head}>Nom</th>
            <th className={head}>Contrat</th>
            <th className={head}>CNI</th>
            <th className={head}>Emploi</th>
            <th className={head}>Entrée</th>
            <th className={head}>État</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const blocked = row.status === "error"
            const isOpen = expanded === row.line
            const worst = blocked ? "error" : row.status === "warning" ? "warning" : null

            return (
              <React.Fragment key={row.line}>
                <tr className={cn(blocked && "bg-alert-tint/30")}>
                  <td className="border-b border-line px-2.5 py-1.5">
                    <input
                      type="checkbox"
                      checked={selected.has(row.line)}
                      onChange={() => onToggle(row.line)}
                      // A blocked row can still be ticked: the server refuses
                      // it and says so, which beats a checkbox that does
                      // nothing for a reason the user has to guess.
                      aria-label={`Ligne ${row.line}`}
                      className="size-3.5 accent-brand"
                    />
                  </td>
                  <td className="num border-b border-line px-2.5 py-1.5 text-ink-3">
                    {row.line}
                  </td>
                  <td className="border-b border-line px-2.5 py-1.5">
                    {row.values.firstName ?? <Missing />}
                  </td>
                  <td className="border-b border-line px-2.5 py-1.5">
                    {row.values.lastName ?? <Missing />}
                  </td>
                  <td className="border-b border-line px-2.5 py-1.5">
                    {row.contractType ? (
                      CONTRACT_TYPE_LABELS[row.contractType] ?? row.contractType
                    ) : (
                      <Missing />
                    )}
                  </td>
                  <td className="mono border-b border-line px-2.5 py-1.5 text-ink-3">
                    {row.values.cni ?? <Missing />}
                  </td>
                  <td className="max-w-[180px] truncate border-b border-line px-2.5 py-1.5">
                    {row.values.jobTitle ?? <Missing />}
                  </td>
                  <td className="num border-b border-line px-2.5 py-1.5">
                    {row.dates.hireDate
                      ? row.dates.hireDate.toISOString().slice(0, 10)
                      : (row.values.hireDate ?? <Missing />)}
                  </td>
                  <td className="border-b border-line px-2.5 py-1.5">
                    {worst === null ? (
                      <StatusPill tone="ok">
                        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={11} />
                        prête
                      </StatusPill>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onExpand(isOpen ? null : row.line)}
                        aria-expanded={isOpen}
                        className="inline-flex items-center gap-1.5"
                      >
                        <StatusPill tone={worst === "error" ? "alert" : "signal"}>
                          <HugeiconsIcon icon={Alert02Icon} size={11} />
                          {row.issues.length} {worst === "error" ? "erreur" : "réserve"}
                          {row.issues.length > 1 ? "s" : ""}
                        </StatusPill>
                        <span className="text-[11px] text-ink-3 underline-offset-2 hover:underline">
                          {isOpen ? "masquer" : "détail"}
                        </span>
                      </button>
                    )}
                  </td>
                </tr>

                {isOpen ? (
                  <tr>
                    <td colSpan={9} className="border-b border-line bg-sub px-2.5 py-2">
                      <ul className="space-y-1">
                        {row.issues.map((issue, index) => (
                          <li
                            key={`${issue.field}-${index}`}
                            className="flex flex-wrap items-baseline gap-1.5 text-[12px]"
                          >
                            <span
                              className={cn(
                                "mono rounded px-1 py-px text-[11px]",
                                issue.severity === "error"
                                  ? "bg-alert-tint text-alert"
                                  : "bg-signal-tint text-signal"
                              )}
                            >
                              {issue.field}
                            </span>
                            <span>{issue.message}</span>
                            {issue.fix ? (
                              <span className="text-ink-3">{issue.fix}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Missing() {
  return <span className="text-ink-3">—</span>
}

/* ==========================================================================
 * Step 3
 * ========================================================================== */

function ImportReportView({ report }: { report: ImportReport }) {
  const problems = report.rows.filter((row) => row.status !== "imported")

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Metric label="Traitées" value={report.total} />
        <Metric label="Importées" value={report.imported} tone="ok" />
        <Metric label="Ignorées" value={report.skipped} tone="signal" />
        <Metric label="Échecs" value={report.failed} tone="alert" />
      </div>

      {/*
        The whole file is accounted for, not only the part that was processed:
        a report that quietly omits the rows it never attempted is a report you
        cannot reconcile against the spreadsheet you started from.
      */}
      <p className="text-[12px] text-ink-3">
        {formatNumber(report.fileRows)} ligne
        {report.fileRows > 1 ? "s" : ""} dans le fichier
        {report.excludedLines.length > 0 ? (
          <>
            {" · "}
            <span className="text-ink-2">
              {formatNumber(report.excludedLines.length)} non retenue
              {report.excludedLines.length > 1 ? "s" : ""}
            </span>{" "}
            <span className="num">
              (ligne{report.excludedLines.length > 1 ? "s" : ""}{" "}
              {report.excludedLines.slice(0, 12).join(", ")}
              {report.excludedLines.length > 12 ? "…" : ""})
            </span>
          </>
        ) : null}
      </p>

      {problems.length === 0 ? (
        <p className="rounded-md bg-ok-tint px-2.5 py-1.5 text-[12.5px] text-ok">
          Toutes les lignes retenues ont été importées.
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
                    <StatusPill tone={row.status === "skipped" ? "signal" : "alert"}>
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
        className={cn(
          "num text-[15px] font-semibold",
          tone === "ok"
            ? "text-ok"
            : tone === "signal"
              ? "text-signal"
              : tone === "alert"
                ? "text-alert"
                : ""
        )}
      >
        {formatNumber(value)}
      </div>
    </div>
  )
}
