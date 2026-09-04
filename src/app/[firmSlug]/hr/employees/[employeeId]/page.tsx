import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { Panel } from "@/components/panel"
import { InterimMeterPanel } from "@/components/interim-meter"
import { Avatar, StatusPill, TagCode } from "@/components/primitives"
import { TopBar } from "@/components/shell/top-bar"
import { db } from "@/lib/db"
import { formatCurrency, formatDate, formatNumber, initials } from "@/lib/format"
import { requireFirmPage } from "@/server/auth/firm-page"
import { computeCeiling } from "@/server/domain/interim-ceiling"

export const metadata: Metadata = { title: "Fiche employé" }

/**
 * Employee record — the Aperçu tab only.
 *
 * Phase 4 builds the five tabs, the prev/next navigation through the current
 * query result and the renewal chain. This much exists now so that a row click
 * on the contracts list leads somewhere real, and because it is where the
 * full-width `InterimMeter` belongs: the same ceiling numbers as the table
 * column, from the same domain module, at panel size.
 */
export default async function EmployeePage({
  params,
}: PageProps<"/[firmSlug]/hr/employees/[employeeId]">) {
  const { firmSlug, employeeId } = await params
  const ctx = await requireFirmPage(firmSlug, { module: "hr" })

  const employee = await db.employee.findFirst({
    // Tenancy is a predicate, not an assumption: an id from another firm is a
    // 404 here, not a leak.
    where: {
      id: employeeId,
      firmId: ctx.firmId,
      ...(ctx.assignedClientIds
        ? { assignedClientId: { in: ctx.assignedClientIds } }
        : {}),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      matricule: true,
      jobTitle: true,
      status: true,
      hireDate: true,
      phone: true,
      email: true,
      address: true,
      dateOfBirth: true,
      gender: true,
      cni: true,
      netSalary: true,
      assignedClient: { select: { id: true, name: true } },
      department: { select: { name: true } },
      contracts: {
        orderBy: { startDate: "desc" },
        select: {
          id: true,
          type: true,
          status: true,
          startDate: true,
          endDate: true,
          salary: true,
          isVise: true,
        },
      },
    },
  })

  if (!employee) notFound()

  const current = employee.contracts.find((contract) => contract.status === "ACTIVE")
  const ceiling = computeCeiling(
    employee.contracts.map((contract) => ({
      startDate: contract.startDate,
      endDate: contract.endDate,
      type: contract.type,
    })),
    current?.type ?? employee.contracts[0]?.type ?? null
  )

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/dashboard`}
        crumbs={[
          { label: ctx.firm.name, href: `/${firmSlug}/dashboard` },
          { label: "RH" },
          { label: `${employee.firstName} ${employee.lastName}` },
        ]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1420px] p-4.5">
          <Panel padded={false}>
            <div className="flex items-center gap-3.5 p-[15px]">
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
                  <StatusPill
                    dot
                    tone={employee.status === "ACTIVE" ? "ok" : "signal"}
                  >
                    {employee.status === "ACTIVE" ? "Actif" : "En congé"}
                  </StatusPill>
                </div>
              </div>
            </div>
          </Panel>

          <div className="mt-3.5 grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex flex-col gap-3.5">
              <Panel
                title="État civil"
                description="Données rattachées à la personne, partagées dans le groupe."
              >
                <FieldList
                  fields={[
                    [
                      "Né(e) le",
                      employee.dateOfBirth
                        ? `${formatDate(employee.dateOfBirth)}${employee.gender ? ` · ${employee.gender === "FEMALE" ? "Féminin" : "Masculin"}` : ""}`
                        : "—",
                    ],
                    ["CNI", employee.cni ?? "Non renseignée", employee.cni ? "mono" : "missing"],
                    ["Téléphone", employee.phone ?? "—", employee.phone ? "mono" : undefined],
                    ["Email", employee.email ?? "—"],
                    ["Adresse", employee.address ?? "—"],
                  ]}
                />
              </Panel>

              <Panel
                title="Emploi"
                description={`Données rattachées à ${ctx.firm.name}.`}
              >
                <FieldList
                  fields={[
                    ["Embauché le", formatDate(employee.hireDate)],
                    ["Poste", employee.jobTitle ?? "—"],
                    ["Département", employee.department?.name ?? "—"],
                    ["Client affecté", employee.assignedClient?.name ?? "—"],
                    [
                      "Salaire net",
                      employee.netSalary ? formatCurrency(employee.netSalary) : "—",
                      "mono",
                    ],
                  ]}
                />
              </Panel>
            </div>

            <div className="flex flex-col gap-3.5">
              <Panel
                title="Plafond légal intérim"
                description="Durée cumulée maximale : 730 jours par employeur."
                footer={{
                  summary: ceiling.applicable
                    ? ceiling.remainingDays <= 90
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
                title="Contrats"
                description={`${formatNumber(employee.contracts.length)} contrat${employee.contracts.length > 1 ? "s" : ""} dans cette filiale.`}
                padded={false}
              >
                <ul className="border-t border-line">
                  {employee.contracts.slice(0, 6).map((contract) => (
                    <li
                      key={contract.id}
                      className="flex items-baseline gap-2 border-b border-line px-[15px] py-2 last:border-b-0"
                    >
                      <TagCode>{contract.type}</TagCode>
                      <span className="mono text-[11.5px] text-ink-3">
                        {formatDate(contract.startDate)}
                        {contract.endDate ? ` → ${formatDate(contract.endDate)}` : ""}
                      </span>
                      {contract.status === "ACTIVE" ? (
                        <StatusPill tone="ok" className="ml-auto">
                          En cours
                        </StatusPill>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function FieldList({
  fields,
}: {
  fields: [string, string, ("mono" | "missing" | undefined)?][]
}) {
  return (
    <dl className="mt-1">
      {fields.map(([label, value, style]) => (
        <div
          key={label}
          className="grid grid-cols-[112px_1fr] gap-3 border-b border-line py-1.5 text-[13px] last:border-b-0"
        >
          <dt className="text-[12.5px] text-ink-3">{label}</dt>
          <dd
            className={
              style === "mono"
                ? "mono"
                : style === "missing"
                  ? "text-signal"
                  : undefined
            }
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
