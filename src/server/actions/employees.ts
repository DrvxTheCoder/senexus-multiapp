"use server"

import type { Prisma } from "@prisma/client"

import {
  createEmployeeSchema,
  deleteEmployeeSchema,
  importEmployeesSchema,
  toDate,
  toOptionalDate,
  updateEmployeeSchema,
} from "@/lib/forms/hr-schemas"
import { ActionError, firmAction } from "@/server/actions/define-action"
import {
  findDuplicate,
  normaliseAmount,
  normaliseGender,
  parseEmployeeCsv,
  type DuplicateCandidate,
} from "@/server/domain/csv-import"
import { nextMatriculeWithRetry } from "@/server/domain/matricule"

/**
 * Employee writes.
 *
 * The rule this file exists to keep: **creating an employee creates their
 * first contract, in the same transaction.** That is how the legacy
 * application behaved, and it is what makes the ceiling computable — an
 * employee with no contract has no history to count. The marker note is kept
 * verbatim so rows created by either application read the same.
 */

const ONBOARDING_NOTE = "Initial contract created during employee onboarding"

/** Empty strings from a form mean "not provided", not "set to empty". */
const orNull = (value: string | null | undefined) =>
  value && value.trim() ? value.trim() : null

/** A client id from a form is only honoured if it belongs to this firm. */
async function assertClientInFirm(
  tx: Prisma.TransactionClient,
  firmId: string,
  clientId: string | null
): Promise<string | null> {
  if (!clientId) return null
  const client = await tx.client.findFirst({
    where: { id: clientId, firmId },
    select: { id: true },
  })
  if (!client) {
    throw new ActionError("Client introuvable dans cette entreprise.", {
      assignedClientId: ["Client introuvable dans cette entreprise."],
    })
  }
  return client.id
}

async function assertDepartmentInFirm(
  tx: Prisma.TransactionClient,
  firmId: string,
  departmentId: string | null
): Promise<string | null> {
  if (!departmentId) return null
  const department = await tx.department.findFirst({
    where: { id: departmentId, firmId },
    select: { id: true },
  })
  if (!department) {
    throw new ActionError("Service introuvable dans cette entreprise.", {
      departmentId: ["Service introuvable dans cette entreprise."],
    })
  }
  return department.id
}

/* ==========================================================================
 * Create
 * ========================================================================== */

export const createEmployee = firmAction({
  input: createEmployeeSchema,
  minimumRole: "MANAGER",
  module: "hr",
  revalidate: (input) => [
    `/${input.firmSlug}/hr/employees`,
    `/${input.firmSlug}/hr/contracts`,
    `/${input.firmSlug}/dashboard`,
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    const clientId = await assertClientInFirm(
      tx,
      ctx.firmId,
      orNull(input.assignedClientId)
    )
    const departmentId = await assertDepartmentInFirm(
      tx,
      ctx.firmId,
      orNull(input.departmentId)
    )

    const hireDate = toDate(input.hireDate)
    const contractEndDate = toOptionalDate(input.contractEndDate)

    // Generated inside this transaction and retried on the unique violation:
    // two people onboarding at the same moment both get a valid number.
    const employee = await nextMatriculeWithRetry(
      tx,
      ctx.firmId,
      async (matricule) =>
        tx.employee.create({
          data: {
            firmId: ctx.firmId,
            matricule: orNull(input.matricule) ?? matricule,
            firstName: input.firstName,
            lastName: input.lastName,
            dateOfBirth: toOptionalDate(input.dateOfBirth),
            placeOfBirth: orNull(input.placeOfBirth),
            gender: (orNull(input.gender) as "MALE" | "FEMALE" | "OTHER") ?? null,
            maritalStatus: orNull(input.maritalStatus),
            nationality: orNull(input.nationality),
            cni: orNull(input.cni),
            fatherName: orNull(input.fatherName),
            motherName: orNull(input.motherName),
            phone: orNull(input.phone),
            email: orNull(input.email),
            address: orNull(input.address),
            photoUrl: orNull(input.photoUrl),
            hireDate,
            jobTitle: orNull(input.jobTitle),
            category: orNull(input.category),
            departmentId,
            assignedClientId: clientId,
            status: input.status,
            netSalary: input.netSalary ?? null,
            contractEndDate,
          },
          select: { id: true, matricule: true },
        })
    )

    // The contract, from the same values — the legacy derivation, kept.
    const contract = await tx.contract.create({
      data: {
        firmId: ctx.firmId,
        employeeId: employee.id,
        clientId,
        type: input.contractType,
        status: "ACTIVE",
        startDate: hireDate,
        endDate: contractEndDate,
        position: orNull(input.jobTitle),
        salary: input.netSalary ?? null,
        isVise: false,
        isActive: true,
        notes: ONBOARDING_NOTE,
      },
      select: { id: true },
    })

    await audit({
      action: "CREATE",
      entity: "EMPLOYEE",
      entityId: employee.id,
      metadata: {
        matricule: employee.matricule,
        contractId: contract.id,
        contractType: input.contractType,
      },
    })

    return { id: employee.id, matricule: employee.matricule }
  },
})

/* ==========================================================================
 * Update
 * ========================================================================== */

export const updateEmployee = firmAction({
  input: updateEmployeeSchema,
  minimumRole: "MANAGER",
  module: "hr",
  revalidate: (input) => [
    `/${input.firmSlug}/hr/employees`,
    `/${input.firmSlug}/hr/employees/${input.id}`,
    `/${input.firmSlug}/hr/contracts`,
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    const existing = await tx.employee.findFirst({
      where: { id: input.id, firmId: ctx.firmId },
      select: { id: true, matricule: true },
    })
    if (!existing) throw new ActionError("Employé introuvable.")

    const clientId = await assertClientInFirm(
      tx,
      ctx.firmId,
      orNull(input.assignedClientId)
    )
    const departmentId = await assertDepartmentInFirm(
      tx,
      ctx.firmId,
      orNull(input.departmentId)
    )

    const hireDate = toDate(input.hireDate)
    const contractEndDate = toOptionalDate(input.contractEndDate)

    await tx.employee.update({
      where: { id: existing.id },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        dateOfBirth: toOptionalDate(input.dateOfBirth),
        placeOfBirth: orNull(input.placeOfBirth),
        gender: (orNull(input.gender) as "MALE" | "FEMALE" | "OTHER") ?? null,
        maritalStatus: orNull(input.maritalStatus),
        nationality: orNull(input.nationality),
        cni: orNull(input.cni),
        fatherName: orNull(input.fatherName),
        motherName: orNull(input.motherName),
        phone: orNull(input.phone),
        email: orNull(input.email),
        address: orNull(input.address),
        photoUrl: orNull(input.photoUrl),
        hireDate,
        jobTitle: orNull(input.jobTitle),
        category: orNull(input.category),
        departmentId,
        assignedClientId: clientId,
        status: input.status,
        netSalary: input.netSalary ?? null,
        contractEndDate,
      },
    })

    /**
     * The legacy app let the employee record and its active contract drift
     * apart silently: change the salary on the fiche and the contract still
     * said the old figure. Here the caller chooses, and the result says what
     * happened either way.
     */
    let syncedContractId: string | null = null
    if (input.syncActiveContract) {
      const active = await tx.contract.findFirst({
        where: { employeeId: existing.id, firmId: ctx.firmId, status: "ACTIVE" },
        orderBy: { startDate: "desc" },
        select: { id: true },
      })
      if (active) {
        await tx.contract.update({
          where: { id: active.id },
          data: {
            position: orNull(input.jobTitle),
            salary: input.netSalary ?? null,
            clientId,
            endDate: contractEndDate,
          },
        })
        syncedContractId = active.id
      }
    }

    await audit({
      action: "UPDATE",
      entity: "EMPLOYEE",
      entityId: existing.id,
      metadata: {
        matricule: existing.matricule,
        syncedContractId,
      },
    })

    return { syncedContractId }
  },
})

/* ==========================================================================
 * Delete
 * ========================================================================== */

/**
 * Deleting an employee cascades through their contracts, documents, leave
 * requests and balances. Retyping the matricule is the confirmation, for the
 * same reason a firm deletion asks for its name.
 */
export const deleteEmployee = firmAction({
  input: deleteEmployeeSchema,
  minimumRole: "ADMIN",
  module: "hr",
  revalidate: (input) => [
    `/${input.firmSlug}/hr/employees`,
    `/${input.firmSlug}/hr/contracts`,
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    const employee = await tx.employee.findFirst({
      where: { id: input.id, firmId: ctx.firmId },
      select: {
        id: true,
        matricule: true,
        firstName: true,
        lastName: true,
        _count: { select: { contracts: true, documents: true } },
      },
    })
    if (!employee) throw new ActionError("Employé introuvable.")

    if (
      input.confirmMatricule.trim().toUpperCase() !==
      employee.matricule.toUpperCase()
    ) {
      throw new ActionError("Le matricule saisi ne correspond pas.", {
        confirmMatricule: ["Le matricule saisi ne correspond pas."],
      })
    }

    const pendingTransfer = await tx.employeeTransfer.findFirst({
      where: { employeeId: employee.id, status: { in: ["PENDING", "APPROVED"] } },
      select: { id: true },
    })
    if (pendingTransfer) {
      throw new ActionError(
        "Un transfert est en cours pour cet employé. Annulez-le d'abord."
      )
    }

    await audit({
      action: "DELETE",
      entity: "EMPLOYEE",
      entityId: employee.id,
      metadata: {
        matricule: employee.matricule,
        name: `${employee.firstName} ${employee.lastName}`,
        contracts: employee._count.contracts,
        documents: employee._count.documents,
      },
    })

    await tx.employee.delete({ where: { id: employee.id } })
  },
})

/* ==========================================================================
 * CSV import
 * ========================================================================== */

export type ImportRowOutcome = {
  line: number
  name: string
  status: "imported" | "skipped" | "failed"
  matricule?: string
  message?: string
}

export type ImportReport = {
  total: number
  imported: number
  skipped: number
  failed: number
  unknownHeaders: string[]
  rows: ImportRowOutcome[]
}

/**
 * Bulk import.
 *
 * Processed **per row**: one unreadable line does not abort the batch, and the
 * report names every row and what became of it. The legacy endpoint had no
 * role check at all and reported failures as a bare count.
 */
export const importEmployees = firmAction({
  input: importEmployeesSchema,
  minimumRole: "MANAGER",
  module: "hr",
  revalidate: (input) => [
    `/${input.firmSlug}/hr/employees`,
    `/${input.firmSlug}/hr/contracts`,
  ],
  handler: async ({ input, ctx, tx, audit }): Promise<ImportReport> => {
    const text = await input.file.text()
    const parsed = parseEmployeeCsv(text, input.dayFirst)

    if (parsed.rows.length === 0) {
      throw new ActionError("Le fichier ne contient aucune ligne exploitable.", {
        file: ["Le fichier ne contient aucune ligne exploitable."],
      })
    }
    if (!parsed.mappedHeaders.firstName || !parsed.mappedHeaders.lastName) {
      throw new ActionError(
        "Colonnes Prénom et Nom introuvables dans l'en-tête.",
        { file: ["Colonnes Prénom et Nom introuvables dans l'en-tête."] }
      )
    }

    const [existing, clients, departments] = await Promise.all([
      tx.employee.findMany({
        where: { firmId: ctx.firmId },
        select: {
          id: true,
          matricule: true,
          firstName: true,
          lastName: true,
          cni: true,
          phone: true,
          email: true,
          dateOfBirth: true,
          hireDate: true,
        },
      }),
      tx.client.findMany({
        where: { firmId: ctx.firmId },
        select: { id: true, name: true },
      }),
      tx.department.findMany({
        where: { firmId: ctx.firmId },
        select: { id: true, name: true },
      }),
    ])

    const candidates: DuplicateCandidate[] = existing
    const clientByName = new Map(
      clients.map((client) => [client.name.trim().toLowerCase(), client.id])
    )
    const departmentByName = new Map(
      departments.map((department) => [
        department.name.trim().toLowerCase(),
        department.id,
      ])
    )

    const outcomes: ImportRowOutcome[] = []

    for (const row of parsed.rows) {
      const name = [row.values.firstName, row.values.lastName]
        .filter(Boolean)
        .join(" ")
        .trim()

      if (row.errors.length > 0) {
        outcomes.push({
          line: row.line,
          name: name || "—",
          status: "failed",
          message: row.errors.join(" "),
        })
        continue
      }

      const duplicate = findDuplicate(row, candidates)
      if (duplicate && input.skipDuplicates) {
        outcomes.push({
          line: row.line,
          name,
          status: "skipped",
          matricule: duplicate.matricule,
          message: `Doublon probable de ${duplicate.matricule} (${duplicate.matched.join(", ")}).`,
        })
        continue
      }

      const salary = normaliseAmount(row.values.netSalary)
      const clientId =
        clientByName.get(row.values.clientName?.trim().toLowerCase() ?? "") ??
        null
      const departmentId =
        departmentByName.get(
          row.values.departmentName?.trim().toLowerCase() ?? ""
        ) ?? null

      try {
        const created = await nextMatriculeWithRetry(
          tx,
          ctx.firmId,
          async (generated) =>
            tx.employee.create({
              data: {
                firmId: ctx.firmId,
                // An existing matricule in the file is preserved: the point of
                // an import is usually to bring history across.
                matricule: row.values.matricule?.toUpperCase() || generated,
                firstName: row.values.firstName!,
                lastName: row.values.lastName!,
                dateOfBirth: row.dates.dateOfBirth ?? null,
                placeOfBirth: row.values.placeOfBirth ?? null,
                gender:
                  (normaliseGender(row.values.gender) as
                    | "MALE"
                    | "FEMALE"
                    | "OTHER") || null,
                maritalStatus: row.values.maritalStatus ?? null,
                nationality: row.values.nationality ?? null,
                cni: row.values.cni ?? null,
                fatherName: row.values.fatherName ?? null,
                motherName: row.values.motherName ?? null,
                phone: row.values.phone ?? null,
                email: row.values.email?.toLowerCase() ?? null,
                address: row.values.address ?? null,
                hireDate: row.dates.hireDate!,
                jobTitle: row.values.jobTitle ?? null,
                category: row.values.category ?? null,
                departmentId,
                assignedClientId: clientId,
                status: "ACTIVE",
                netSalary: salary ? Number(salary) : null,
                contractEndDate: row.dates.contractEndDate ?? null,
              },
              select: {
                id: true,
                matricule: true,
                firstName: true,
                lastName: true,
                cni: true,
                phone: true,
                email: true,
                dateOfBirth: true,
                hireDate: true,
              },
            })
        )

        await tx.contract.create({
          data: {
            firmId: ctx.firmId,
            employeeId: created.id,
            clientId,
            type: input.contractType,
            status: "ACTIVE",
            startDate: row.dates.hireDate!,
            endDate: row.dates.contractEndDate ?? null,
            position: row.values.jobTitle ?? null,
            salary: salary ? Number(salary) : null,
            isVise: false,
            isActive: true,
            notes: ONBOARDING_NOTE,
          },
        })

        // Later rows are compared against this one too, so a file that
        // contains the same person twice reports the second as a duplicate.
        candidates.push(created)

        outcomes.push({
          line: row.line,
          name,
          status: "imported",
          matricule: created.matricule,
          message: duplicate
            ? `Importé malgré un doublon probable de ${duplicate.matricule}.`
            : undefined,
        })
      } catch (error) {
        outcomes.push({
          line: row.line,
          name,
          status: "failed",
          message:
            error instanceof Error && "code" in error && error.code === "P2002"
              ? "Matricule déjà utilisé dans cette entreprise."
              : "Écriture refusée par la base.",
        })
      }
    }

    const report: ImportReport = {
      total: parsed.rows.length,
      imported: outcomes.filter((row) => row.status === "imported").length,
      skipped: outcomes.filter((row) => row.status === "skipped").length,
      failed: outcomes.filter((row) => row.status === "failed").length,
      unknownHeaders: parsed.unknownHeaders,
      rows: outcomes,
    }

    await audit({
      action: "IMPORT",
      entity: "EMPLOYEE",
      entityId: ctx.firmId,
      metadata: {
        total: report.total,
        imported: report.imported,
        skipped: report.skipped,
        failed: report.failed,
      },
    })

    return report
  },
})
