import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import {
  DocumentActions,
  RecordHeaderActions,
  UploadDocumentButton,
} from "@/app/[firmSlug]/hr/employees/[employeeId]/record-actions"
import { DocumentCard } from "@/components/document-card"
import { FieldList } from "@/components/field-list"
import { InterimMeterPanel } from "@/components/interim-meter"
import { Panel } from "@/components/panel"
import { Avatar, StatusPill, TagCode } from "@/components/primitives"
import { RecordPager } from "@/components/record-pager"
import { RecordTabs } from "@/components/record-tabs"
import { Timeline, TimelineNode } from "@/components/timeline"
import { TopBar } from "@/components/shell/top-bar"
import {
  formatCurrency,
  formatDate,
  formatDateProse,
  formatDays,
  formatNumber,
  initials,
} from "@/lib/format"
import {
  loadEmployeeSearchParams,
  serializeEmployeeSearchParams,
  toEmployeeQuery,
} from "@/lib/queries/employee-params"
import { db } from "@/lib/db"
import { requireFirmPage } from "@/server/auth/firm-page"
import { roleAtLeast } from "@/types/auth"
import { INTERIM_CEILING_DAYS } from "@/server/domain/interim-ceiling"
import { getEmployeeRecord } from "@/server/queries/employee-record"
import { employeeIdSequence } from "@/server/queries/employees"

export const metadata: Metadata = { title: "Fiche employé" }

/** `module` gates a tab on a firm module being enabled (§3.4). */
const TABS: { id: string; label: string; module?: string }[] = [
  { id: "apercu", label: "Aperçu" },
  { id: "contrats", label: "Contrats" },
  { id: "conges", label: "Congés" },
  { id: "documents", label: "Documents", module: "documents" },
  { id: "parcours", label: "Parcours" },
]

const STATUS_TONE: Record<string, "ok" | "signal" | "muted" | "alert"> = {
  ACTIVE: "ok",
  ON_LEAVE: "signal",
  INACTIVE: "muted",
  SUSPENDED: "signal",
  TERMINATED: "alert",
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Actif",
  ON_LEAVE: "En congé",
  INACTIVE: "Inactif",
  SUSPENDED: "Suspendu",
  TERMINATED: "Sorti",
}

const LEAVE_LABELS: Record<string, string> = {
  ANNUAL: "Congé annuel",
  SICK: "Congé maladie",
  MATERNITY: "Congé maternité",
  PATERNITY: "Congé paternité",
  UNPAID: "Congé sans solde",
  SPECIAL: "Congé spécial",
  COMPENSATORY: "Récupération",
}

const LEAVE_STATUS: Record<string, { label: string; tone: "ok" | "signal" | "alert" | "muted" }> = {
  APPROVED: { label: "Approuvé", tone: "ok" },
  PENDING: { label: "En attente", tone: "signal" },
  REJECTED: { label: "Refusé", tone: "alert" },
  CANCELLED: { label: "Annulé", tone: "muted" },
}

/**
 * §5.5 — the employee record.
 *
 * Five tabs over one person. The tab is a URL parameter so a specific tab is
 * linkable, and prev/next walks the result set the user arrived from rather
 * than the table by id.
 */
export default async function EmployeePage({
  params,
  searchParams,
}: PageProps<"/[firmSlug]/hr/employees/[employeeId]">) {
  const { firmSlug, employeeId } = await params
  const ctx = await requireFirmPage(firmSlug, { module: "hr" })
  const raw = await searchParams

  const record = await getEmployeeRecord(employeeId, ctx)
  if (!record) notFound()

  const { employee, ceiling, chains, leaves, balances, documents, parcours } = record

  const documentsEnabled = ctx.firm.modules.includes("documents")
  const tabs = TABS.filter((tab) => !tab.module || ctx.firm.modules.includes(tab.module))
  const requested = typeof raw.tab === "string" ? raw.tab : "apercu"
  const tab = tabs.some((entry) => entry.id === requested) ? requested : "apercu"

  const listParams = loadEmployeeSearchParams(raw)
  const listQuery = toEmployeeQuery(listParams)
  const sequence = await employeeIdSequence(listQuery, ctx)
  const index = sequence.indexOf(employeeId)
  const listSuffix = serializeEmployeeSearchParams(listParams)
  const neighbour = (offset: number) => {
    const id = index === -1 ? undefined : sequence[index + offset]
    if (!id) return null
    return `/${firmSlug}/hr/employees/${id}${serializeEmployeeSearchParams({
      ...listParams,
    })}${listSuffix ? "&" : "?"}tab=${tab}`.replace("?&", "?")
  }

  const year = new Date().getFullYear()
  const currentBalances = balances.filter((balance) => balance.year === year)

  const canWrite = roleAtLeast(ctx.role, "MANAGER")

  const [clients, departments, siblings] = await Promise.all([
    canWrite
      ? db.client.findMany({
          where: {
            firmId: ctx.firmId,
            status: { in: ["ACTIVE", "PROSPECT"] },
            ...(ctx.assignedClientIds ? { id: { in: ctx.assignedClientIds } } : {}),
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    canWrite
      ? db.department.findMany({
          where: { firmId: ctx.firmId },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    canWrite
      ? db.firm.findMany({
          where: { holdingId: ctx.firm.holdingId, NOT: { id: ctx.firmId } },
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            clients: {
              where: { status: { in: ["ACTIVE", "PROSPECT"] } },
              orderBy: { name: "asc" },
              select: { id: true, name: true, firmId: true },
            },
          },
        })
      : Promise.resolve([]),
  ])

  const toInput = (value: Date | null | undefined) =>
    value ? new Date(value).toISOString().slice(0, 10) : ""

  const editDefaults = {
    id: employee.id,
    name: `${employee.firstName} ${employee.lastName}`,
    firstName: employee.firstName,
    lastName: employee.lastName,
    matricule: employee.matricule,
    dateOfBirth: toInput(employee.dateOfBirth),
    placeOfBirth: employee.placeOfBirth ?? "",
    gender: employee.gender ?? "",
    maritalStatus: employee.maritalStatus ?? "",
    nationality: employee.nationality ?? "",
    cni: employee.cni ?? "",
    fatherName: employee.fatherName ?? "",
    motherName: employee.motherName ?? "",
    phone: employee.phone ?? "",
    email: employee.email ?? "",
    address: employee.address ?? "",
    hireDate: toInput(employee.hireDate),
    jobTitle: employee.jobTitle ?? "",
    category: employee.category ?? "",
    departmentId: employee.department?.id ?? "",
    assignedClientId: employee.assignedClient?.id ?? "",
    status: employee.status,
    netSalary:
      employee.netSalary === null ? "" : String(Math.round(Number(employee.netSalary))),
    contractEndDate: toInput(employee.contractEndDate),
  }

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/dashboard`}
        crumbs={[
          { label: ctx.firm.name, href: `/${firmSlug}/dashboard` },
          { label: "RH" },
          { label: "Employés", href: `/${firmSlug}/hr/employees${listSuffix}` },
          { label: `${employee.firstName} ${employee.lastName}` },
        ]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className=" p-4.5">
          <RecordPager
            backHref={`/${firmSlug}/hr/employees${listSuffix}`}
            backLabel="Employés"
            position={index === -1 ? null : index + 1}
            total={sequence.length}
            prevHref={neighbour(-1)}
            nextHref={neighbour(1)}
          />

          <Panel padded={false}>
            <div className="flex flex-wrap items-center gap-3.5 p-[15px]">
              <Avatar
                initials={initials(employee.firstName, employee.lastName)}
                size={44}
                className="rounded-[10px]"
              />
              <div className="min-w-0">
                <h1 className="text-[19px] leading-tight font-semibold tracking-[-0.022em]">
                  {employee.firstName} {employee.lastName}
                </h1>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
                  <span className="mono">{employee.matricule}</span>
                  {employee.jobTitle ? <span>· {employee.jobTitle}</span> : null}
                  {employee.assignedClient ? (
                    <span>· {employee.assignedClient.name}</span>
                  ) : null}
                  <StatusPill dot tone={STATUS_TONE[employee.status] ?? "muted"}>
                    {STATUS_LABELS[employee.status] ?? employee.status}
                  </StatusPill>
                </div>
              </div>

              <RecordHeaderActions
                firmSlug={firmSlug}
                employee={editDefaults}
                clients={clients}
                departments={departments}
                transferTargets={siblings.map((firm) => ({
                  id: firm.id,
                  name: firm.name,
                }))}
                transferClients={siblings.flatMap((firm) => firm.clients)}
                canWrite={canWrite}
              />
            </div>

            <RecordTabs
              tabs={tabs.map((entry) => ({
                id: entry.id,
                label:
                  entry.id === "documents"
                    ? `Documents (${formatNumber(documents.length)})`
                    : entry.label,
              }))}
              active={tab}
            />
          </Panel>

          <div className="mt-3.5">
            {tab === "apercu" ? (
              <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_340px]">
                <div className="flex flex-col gap-3.5">
                  <Panel
                    title="État civil"
                    description="Données rattachées à la personne, partagées dans le groupe."
                  >
                    <FieldList
                      fields={[
                        {
                          label: "Né(e) le",
                          value: employee.dateOfBirth
                            ? `${formatDate(employee.dateOfBirth)}${
                                employee.placeOfBirth ? ` à ${employee.placeOfBirth}` : ""
                              }`
                            : "Non renseignée",
                          missing: !employee.dateOfBirth,
                        },
                        {
                          label: "Genre",
                          value:
                            employee.gender === "FEMALE"
                              ? "Féminin"
                              : employee.gender === "MALE"
                                ? "Masculin"
                                : "—",
                        },
                        {
                          label: "CNI",
                          value: employee.cni ?? "Non renseignée",
                          mono: Boolean(employee.cni),
                          missing: !employee.cni,
                        },
                        { label: "Nationalité", value: employee.nationality ?? "—" },
                        { label: "Situation", value: employee.maritalStatus ?? "—" },
                        {
                          label: "Téléphone",
                          value: employee.phone ?? "Non renseigné",
                          mono: Boolean(employee.phone),
                          missing: !employee.phone && !employee.email,
                        },
                        { label: "Email", value: employee.email ?? "—" },
                        { label: "Adresse", value: employee.address ?? "—" },
                        { label: "Père", value: employee.fatherName ?? "—" },
                        { label: "Mère", value: employee.motherName ?? "—" },
                      ]}
                    />
                  </Panel>

                  <Panel
                    title="Emploi"
                    description={`Données rattachées à ${ctx.firm.name}.`}
                    footer={{
                      summary: `Dernière modification le ${formatDateProse(employee.updatedAt)}.`,
                    }}
                  >
                    <FieldList
                      fields={[
                        {
                          label: "Embauché le",
                          value: `${formatDate(employee.hireDate)} · ${seniority(employee.hireDate)}`,
                        },
                        { label: "Poste", value: employee.jobTitle ?? "—" },
                        { label: "Catégorie", value: employee.category ?? "—" },
                        { label: "Département", value: employee.department?.name ?? "—" },
                        {
                          label: "Client affecté",
                          value: employee.assignedClient?.name ?? "Non affecté",
                          missing: !employee.assignedClient,
                        },
                        {
                          label: "Salaire net",
                          value: employee.netSalary
                            ? formatCurrency(employee.netSalary)
                            : "—",
                          mono: Boolean(employee.netSalary),
                        },
                        {
                          label: "Contrat actuel",
                          value: record.current ? (
                            <TagCode>{record.current.type}</TagCode>
                          ) : (
                            "Aucun contrat en cours"
                          ),
                          missing: !record.current,
                        },
                      ]}
                    />
                  </Panel>
                </div>

                <div className="flex flex-col gap-3.5">
                  <Panel
                    title="Plafond légal intérim"
                    description={`Durée cumulée maximale : ${INTERIM_CEILING_DAYS} jours par employeur.`}
                    footer={{
                      summary: ceiling.applicable
                        ? ceiling.remainingDays === 0
                          ? "Plafond atteint. Le contrat est requalifiable en CDI."
                          : ceiling.remainingDays <= 90
                            ? "Au-delà, le contrat est requalifiable en CDI."
                            : "Marge confortable, aucune action requise."
                        : "Les jours effectués dans une autre filiale ne comptent pas ici.",
                    }}
                  >
                    <InterimMeterPanel
                      usedDays={ceiling.usedDays}
                      projectedDays={ceiling.projectedDays}
                      applicable={ceiling.applicable}
                    />
                  </Panel>

                  <Panel
                    title="Solde de congés"
                    description={`Exercice ${year}.`}
                    footer={
                      currentBalances.length === 0
                        ? { summary: "Aucun solde enregistré pour cet exercice." }
                        : undefined
                    }
                  >
                    {currentBalances.map((balance) => {
                      const total = Number(balance.totalDays)
                      const remaining = Number(balance.remainingDays)
                      const ratio = total === 0 ? 0 : (remaining / total) * 100
                      return (
                        <div key={balance.id} className="mb-2.5 last:mb-0">
                          <div className="mb-1.5 flex justify-between text-[12.5px]">
                            <span className="text-ink-2">
                              {LEAVE_LABELS[balance.leaveType] ?? balance.leaveType}
                            </span>
                            <span className="num">
                              <b>{formatNumber(remaining)}</b>
                              <span className="text-ink-3"> sur {formatNumber(total)} j</span>
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-sm bg-sunken">
                            <div
                              className="h-full rounded-sm bg-brand"
                              style={{ width: `${Math.max(0, Math.min(100, ratio))}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </Panel>
                </div>
              </div>
            ) : null}

            {tab === "contrats" ? (
              <Panel
                title="Chaîne de renouvellement"
                description={
                  ceiling.applicable
                    ? `${formatNumber(record.contracts.length)} contrats · ${formatNumber(ceiling.usedDays)} jours cumulés sur ${INTERIM_CEILING_DAYS}.`
                    : `${formatNumber(record.contracts.length)} contrats dans cette filiale.`
                }
                stats={[
                  {
                    label: "Renouvellements",
                    value: formatNumber(Math.max(0, record.contracts.length - 1)),
                  },
                  ...(ceiling.applicable
                    ? [
                        {
                          label: "Cumul",
                          value: formatDays(ceiling.usedDays),
                          tone: ceiling.tone === "brand" ? ("default" as const) : ceiling.tone,
                        },
                      ]
                    : []),
                ]}
                footer={{
                  summary:
                    record.contracts.length === 0
                      ? "Aucun contrat enregistré."
                      : "Le cumul ne compte que les contrats d'intérim, chevauchements déduits.",
                }}
              >
                {chains.map((chain) => (
                  <Timeline key={chain.id}>
                    {[...chain.steps].reverse().map((step) => (
                      <TimelineNode
                        key={step.contract.id}
                        live={step.contract.status === "ACTIVE"}
                        title={
                          <>
                            <TagCode>{step.contract.type}</TagCode>{" "}
                            <span className="text-ink-2">
                              {step.contract.status === "ACTIVE"
                                ? "en cours"
                                : step.contract.status === "RENEWED"
                                  ? "renouvelé"
                                  : step.contract.status === "TERMINATED"
                                    ? "résilié"
                                    : "expiré"}
                            </span>
                          </>
                        }
                        meta={`${formatDate(step.contract.startDate)} → ${
                          step.contract.endDate
                            ? formatDate(step.contract.endDate)
                            : "indéterminée"
                        }`}
                        trailing={
                          step.contract.salary ? (
                            <span className="mono num text-ink-2">
                              {formatCurrency(step.contract.salary)}
                            </span>
                          ) : null
                        }
                        note={
                          <>
                            {formatDays(step.days)}
                            {step.contract.type === "INTERIM"
                              ? ` · ${formatNumber(step.cumulative)} j cumulés`
                              : null}
                            {step.contract.client ? ` · ${step.contract.client.name}` : null}
                            {step.contract.isVise
                              ? " · visé par l'inspection du travail"
                              : " · visa en attente"}
                            {step.contract.terminationReason
                              ? ` · ${step.contract.terminationReason}`
                              : null}
                          </>
                        }
                      />
                    ))}
                  </Timeline>
                ))}
              </Panel>
            ) : null}

            {tab === "conges" ? (
              <Panel
                title="Demandes de congé"
                description={`Exercice ${year} et historique.`}
                stats={[
                  {
                    label: "Demandes",
                    value: formatNumber(leaves.length),
                  },
                  {
                    label: "En attente",
                    value: formatNumber(
                      leaves.filter((leave) => leave.status === "PENDING").length
                    ),
                    tone: leaves.some((leave) => leave.status === "PENDING")
                      ? "signal"
                      : "default",
                  },
                ]}
                padded={false}
                footer={{
                  summary:
                    leaves.length === 0
                      ? "Aucune demande enregistrée."
                      : `${formatNumber(leaves.length)} demandes affichées.`,
                }}
              >
                {leaves.length > 0 ? (
                  <table className="w-full border-separate border-spacing-0">
                    <thead>
                      <tr>
                        {["Type", "Période", "Durée", "Demandé le", "Statut"].map((header) => (
                          <th
                            key={header}
                            scope="col"
                            className="h-[33px] border-y border-line bg-sub px-2.5 text-left text-[11.5px] font-medium text-ink-3 first:pl-[15px] last:pr-[15px]"
                          >
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {leaves.map((leave) => (
                        <tr key={leave.id}>
                          <td className="h-row border-b border-line px-2.5 pl-[15px] text-[13px] font-medium">
                            {LEAVE_LABELS[leave.leaveType] ?? leave.leaveType}
                          </td>
                          <td className="mono h-row border-b border-line px-2.5 text-xs text-ink-2">
                            {formatDate(leave.startDate)} → {formatDate(leave.endDate)}
                          </td>
                          <td className="num h-row border-b border-line px-2.5 text-[13px]">
                            {formatDays(Number(leave.totalDays))}
                          </td>
                          <td className="h-row border-b border-line px-2.5 text-[13px] text-ink-2">
                            {formatDateProse(leave.requestedAt)}
                          </td>
                          <td className="h-row border-b border-line px-2.5 pr-[15px]">
                            <StatusPill
                              dot
                              tone={LEAVE_STATUS[leave.status]?.tone ?? "muted"}
                            >
                              {LEAVE_STATUS[leave.status]?.label ?? leave.status}
                            </StatusPill>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </Panel>
            ) : null}

            {tab === "documents" && documentsEnabled ? (
              <Panel
                title="Documents"
                description="Pièces rattachées à la personne et à l'emploi."
                stats={[
                  {
                    label: "Vérifiés",
                    value: `${formatNumber(documents.filter((d) => d.isVerified).length)} sur ${formatNumber(documents.length)}`,
                  },
                ]}
                tools={
                  canWrite ? (
                    <UploadDocumentButton
                      firmSlug={firmSlug}
                      employeeId={employee.id}
                    />
                  ) : null
                }
                footer={{
                  summary: (() => {
                    const pending = documents.filter((d) => !d.isVerified).length
                    const expired = documents.filter(
                      (d) => d.expiryDate && d.expiryDate < new Date()
                    ).length
                    if (documents.length === 0) return "Aucune pièce déposée."
                    return [
                      pending > 0
                        ? `${formatNumber(pending)} en attente de vérification`
                        : "Toutes les pièces sont vérifiées",
                      expired > 0 ? `${formatNumber(expired)} expirée${expired > 1 ? "s" : ""}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  })(),
                  action: (
                    <Link
                      href={`/${firmSlug}/documents?employee=${employee.id}`}
                      className="font-medium hover:text-brand"
                    >
                      Ouvrir dans Documents
                    </Link>
                  ),
                }}
              >
                {documents.length === 0 ? (
                  <p className="py-6 text-center text-[13px] text-ink-3">
                    Aucune pièce déposée pour cet employé.
                  </p>
                ) : (
                  <div className="grid gap-2.5 pt-1 sm:grid-cols-2 xl:grid-cols-3">
                    {documents.map((document) => (
                      <div
                        key={document.id}
                        className="flex items-center gap-1.5"
                      >
                        <DocumentCard
                          id={document.id}
                          fileName={document.fileName}
                          documentType={document.documentType}
                          fileSize={document.fileSize}
                          mimeType={document.mimeType}
                          expiryDate={document.expiryDate}
                          isVerified={document.isVerified}
                          firmSlug={firmSlug}
                        />
                        <DocumentActions
                          firmSlug={firmSlug}
                          document={{
                            id: document.id,
                            isVerified: document.isVerified,
                            fileName: document.fileName,
                          }}
                          canVerify={canWrite}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            ) : null}

            {tab === "parcours" ? (
              <Panel
                title="Parcours dans le groupe"
                description="Une personne, un emploi par filiale, avec son propre matricule."
                stats={[{ label: "Filiales", value: formatNumber(parcours.length) }]}
                footer={{
                  summary: `Les ${INTERIM_CEILING_DAYS} jours se comptent par employeur : les jours effectués dans une autre filiale n'entrent pas dans le plafond ${ctx.firm.name}.`,
                }}
              >
                <Timeline>
                  {parcours.map((entry) => (
                    <TimelineNode
                      key={entry.firmId}
                      live={entry.current}
                      title={entry.firmName}
                      meta={entry.current ? employee.matricule : (entry.matricule ?? undefined)}
                      trailing={
                        entry.current ? (
                          <StatusPill tone="ok">En cours</StatusPill>
                        ) : (
                          <StatusPill tone="muted">
                            {entry.to ? `jusqu'au ${formatDate(entry.to)}` : "historique"}
                          </StatusPill>
                        )
                      }
                      note={
                        <>
                          {entry.current
                            ? `${formatNumber(entry.contractCount)} contrat${entry.contractCount > 1 ? "s" : ""}`
                            : null}
                          {entry.current ? " · " : null}
                          {entry.note}
                        </>
                      }
                    />
                  ))}
                </Timeline>

                {parcours.length === 1 ? (
                  <p className="mt-2 text-[12.5px] text-ink-3">
                    Aucun transfert enregistré. Un employé recruté séparément par
                    une autre filiale apparaît là-bas comme un dossier distinct :
                    les dossiers ne sont pas rapprochés automatiquement.
                  </p>
                ) : null}
              </Panel>
            ) : null}
          </div>
        </div>
      </div>
    </>
  )
}

function seniority(hireDate: Date): string {
  const days = Math.max(
    0,
    Math.round((Date.now() - hireDate.getTime()) / 86_400_000)
  )
  if (days >= 365) {
    const years = Math.floor(days / 365)
    return `${years} an${years > 1 ? "s" : ""} d'ancienneté`
  }
  if (days >= 60) return `${Math.floor(days / 30)} mois d'ancienneté`
  return `${formatDays(days)} d'ancienneté`
}
