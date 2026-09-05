"use server"

import type { Prisma } from "@prisma/client"

import {
  bulkTransferSchema,
  rejectTransferSchema,
  requestTransferSchema,
  toDate,
  transferIdSchema,
} from "@/lib/forms/hr-schemas"
import { ActionError, firmAction } from "@/server/actions/define-action"
import { requireFirmAccess } from "@/server/auth/require-firm-access"
import { matriculePrefixFor, nextMatricule } from "@/server/domain/matricule"

/**
 * Employee transfers between firms of the same holding.
 *
 * The state machine is the legacy one and is kept deliberately:
 *
 *   PENDING --approve(destination)--> APPROVED --complete(source)--> COMPLETED
 *          \--reject(destination)--> REJECTED
 *          \--cancel(source)------> CANCELLED
 *
 * **Destination approves, source completes.** The receiving firm decides
 * whether it wants the person; the sending firm decides when they actually go,
 * because it is the one that has to close their contract.
 *
 * Four defects fixed here, all agreed:
 *
 * 1. The duplicate guard checked `PENDING` only, so an employee with an
 *    APPROVED transfer could have a second one raised. It now blocks on any
 *    non-terminal state.
 * 2. Completion terminated the source contracts and moved the employee without
 *    creating a contract in the destination firm, leaving them employed
 *    nowhere. It now creates one.
 * 3. Bulk transfer was a loop in the browser that could half-succeed. It is one
 *    action in one transaction.
 * 4. Completion overwrote `assignedClientId` with null whenever the transfer
 *    did not name a client, silently clearing an assignment. It now only writes
 *    what the transfer actually specifies.
 */

const NON_TERMINAL = ["PENDING", "APPROVED"] as const

async function assertSameHolding(
  tx: Prisma.TransactionClient,
  fromFirmId: string,
  toFirmId: string
) {
  if (fromFirmId === toFirmId) {
    throw new ActionError("L'entreprise de destination est déjà la sienne.", {
      toFirmId: ["Choisissez une autre entreprise."],
    })
  }

  const firms = await tx.firm.findMany({
    where: { id: { in: [fromFirmId, toFirmId] } },
    select: { id: true, name: true, slug: true, holdingId: true },
  })

  const from = firms.find((firm) => firm.id === fromFirmId)
  const to = firms.find((firm) => firm.id === toFirmId)

  if (!from || !to) throw new ActionError("Entreprise introuvable.")
  if (from.holdingId !== to.holdingId) {
    throw new ActionError(
      "Un transfert n'est possible qu'entre filiales du même groupe.",
      { toFirmId: ["Filiale hors du groupe."] }
    )
  }

  return { from, to }
}

/**
 * The matricule the employee will carry in the destination firm.
 *
 * Reserved at request time rather than at completion so the number appears on
 * the request for both firms to see, and so a collision surfaces while somebody
 * is still looking at the screen. It is re-checked at completion, because weeks
 * can pass in between.
 */
async function reserveMatricule(
  tx: Prisma.TransactionClient,
  toFirmId: string
): Promise<string> {
  return nextMatricule(tx, toFirmId)
}

/* ==========================================================================
 * Request
 * ========================================================================== */

export const requestTransfer = firmAction({
  input: requestTransferSchema,
  minimumRole: "MANAGER",
  module: "hr",
  revalidate: (input) => [
    `/${input.firmSlug}/hr/transfers`,
    `/${input.firmSlug}/hr/employees`,
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    const employee = await tx.employee.findFirst({
      where: { id: input.employeeId, firmId: ctx.firmId },
      select: { id: true, matricule: true, firstName: true, lastName: true },
    })
    if (!employee) throw new ActionError("Employé introuvable.")

    const { to } = await assertSameHolding(tx, ctx.firmId, input.toFirmId)

    // Fix 1 — any non-terminal transfer blocks a new one. The legacy guard
    // looked at PENDING only, which is how one employee ended up with two.
    const inFlight = await tx.employeeTransfer.findFirst({
      where: { employeeId: employee.id, status: { in: [...NON_TERMINAL] } },
      select: { id: true, status: true, toFirm: { select: { name: true } } },
    })
    if (inFlight) {
      throw new ActionError(
        `Un transfert vers ${inFlight.toFirm.name} est déjà ${inFlight.status === "PENDING" ? "en attente" : "approuvé"} pour cet employé.`
      )
    }

    const clientId = input.clientId?.trim() || null
    if (clientId) {
      const client = await tx.client.findFirst({
        where: { id: clientId, firmId: to.id },
        select: { id: true },
      })
      if (!client) {
        throw new ActionError(
          `Ce client n'appartient pas à ${to.name}.`,
          { clientId: ["Client hors de l'entreprise de destination."] }
        )
      }
    }

    const newMatricule = await reserveMatricule(tx, to.id)

    const transfer = await tx.employeeTransfer.create({
      data: {
        employeeId: employee.id,
        fromFirmId: ctx.firmId,
        toFirmId: to.id,
        clientId,
        transferDate: toDate(input.transferDate),
        effectiveDate: toDate(input.effectiveDate),
        reason: input.reason,
        status: "PENDING",
        newMatricule,
        requestedBy: ctx.userId,
        // Fix 2 — the destination-contract choice is recorded rather than
        // dropped. The legacy dialog had the checkbox and never sent it.
        notes: JSON.stringify({
          createDestinationContract: input.createDestinationContract,
          contractType: input.contractType,
          note: input.notes?.trim() || null,
        }),
      },
      select: { id: true },
    })

    await audit({
      action: "REQUEST",
      entity: "EMPLOYEE_TRANSFER",
      entityId: transfer.id,
      metadata: {
        employeeId: employee.id,
        matricule: employee.matricule,
        toFirmId: to.id,
        newMatricule,
      },
    })

    return { id: transfer.id, newMatricule }
  },
})

/* ==========================================================================
 * Bulk request — fix 3
 * ========================================================================== */

export const requestBulkTransfer = firmAction({
  input: bulkTransferSchema,
  minimumRole: "MANAGER",
  module: "hr",
  revalidate: (input) => [
    `/${input.firmSlug}/hr/transfers`,
    `/${input.firmSlug}/hr/employees`,
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    const { to } = await assertSameHolding(tx, ctx.firmId, input.toFirmId)

    const employees = await tx.employee.findMany({
      where: {
        id: { in: input.employeeIds },
        firmId: ctx.firmId,
        ...(ctx.assignedClientIds
          ? { assignedClientId: { in: ctx.assignedClientIds } }
          : {}),
      },
      select: { id: true, matricule: true, firstName: true, lastName: true },
    })

    if (employees.length === 0) {
      throw new ActionError("Aucun employé accessible dans cette sélection.")
    }

    const blocked = await tx.employeeTransfer.findMany({
      where: {
        employeeId: { in: employees.map((employee) => employee.id) },
        status: { in: [...NON_TERMINAL] },
      },
      select: { employeeId: true, status: true },
    })
    const blockedIds = new Set(blocked.map((row) => row.employeeId))

    const eligible = employees.filter(
      (employee) => !blockedIds.has(employee.id)
    )

    if (eligible.length === 0) {
      throw new ActionError(
        "Tous les employés sélectionnés ont déjà un transfert en cours."
      )
    }

    const clientId = input.clientId?.trim() || null
    if (clientId) {
      const client = await tx.client.findFirst({
        where: { id: clientId, firmId: to.id },
        select: { id: true },
      })
      if (!client) {
        throw new ActionError(`Ce client n'appartient pas à ${to.name}.`)
      }
    }

    // Matricules are reserved in sequence inside this one transaction, so a
    // batch of thirty cannot hand out the same number twice — which is what the
    // browser-side loop did.
    const prefix = await matriculePrefixFor(tx, to.id)
    const first = await nextMatricule(tx, to.id, prefix)
    let sequence = Number.parseInt(first.slice(prefix.length), 10)

    const notes = JSON.stringify({
      createDestinationContract: input.createDestinationContract,
      contractType: input.contractType,
      note: null,
    })

    const created: { employeeId: string; newMatricule: string }[] = []

    for (const employee of eligible) {
      const newMatricule = `${prefix}${String(sequence).padStart(4, "0")}`
      sequence += 1

      await tx.employeeTransfer.create({
        data: {
          employeeId: employee.id,
          fromFirmId: ctx.firmId,
          toFirmId: to.id,
          clientId,
          transferDate: toDate(input.transferDate),
          effectiveDate: toDate(input.effectiveDate),
          reason: input.reason,
          status: "PENDING",
          newMatricule,
          requestedBy: ctx.userId,
          notes,
        },
      })

      created.push({ employeeId: employee.id, newMatricule })
    }

    await audit({
      action: "REQUEST_BULK",
      entity: "EMPLOYEE_TRANSFER",
      entityId: ctx.firmId,
      metadata: {
        requested: input.employeeIds.length,
        created: created.length,
        skipped: blockedIds.size,
        toFirmId: to.id,
      },
    })

    return {
      created: created.length,
      skipped: employees.length - eligible.length,
      unreachable: input.employeeIds.length - employees.length,
    }
  },
})

/* ==========================================================================
 * Approve / reject — the destination firm decides
 * ========================================================================== */

/**
 * Loads a transfer and authorises the caller against the *correct side* of it.
 *
 * `requireFirmAccess` authorises one firm; a transfer touches two, and which
 * one may act depends on the step. This is the piece the legacy code lacked —
 * it checked the acting user's session and nothing else.
 */
async function loadTransferFor(
  tx: Prisma.TransactionClient,
  transferId: string,
  side: "source" | "destination",
  minimumRole: "MANAGER" | "ADMIN" = "MANAGER"
) {
  const transfer = await tx.employeeTransfer.findUnique({
    where: { id: transferId },
    select: {
      id: true,
      status: true,
      employeeId: true,
      fromFirmId: true,
      toFirmId: true,
      clientId: true,
      effectiveDate: true,
      newMatricule: true,
      notes: true,
      fromFirm: { select: { id: true, slug: true, name: true } },
      toFirm: { select: { id: true, slug: true, name: true } },
      employee: {
        select: {
          id: true,
          matricule: true,
          firstName: true,
          lastName: true,
          jobTitle: true,
          netSalary: true,
          assignedClientId: true,
        },
      },
    },
  })

  if (!transfer) throw new ActionError("Transfert introuvable.")

  const firm = side === "source" ? transfer.fromFirm : transfer.toFirm
  // Throws 403/404 exactly as any page would; `toResult` turns it into a
  // refusal with the right status.
  await requireFirmAccess(firm.slug, minimumRole)

  return transfer
}

type TransferOptions = {
  createDestinationContract: boolean
  contractType: "CDI" | "CDD" | "INTERIM" | "STAGE" | "PRESTATION"
  note: string | null
}

function readOptions(notes: string | null): TransferOptions {
  const fallback: TransferOptions = {
    createDestinationContract: true,
    contractType: "INTERIM",
    note: notes,
  }
  if (!notes) return { ...fallback, note: null }
  try {
    const parsed = JSON.parse(notes) as Partial<TransferOptions>
    return {
      createDestinationContract: parsed.createDestinationContract ?? true,
      contractType: parsed.contractType ?? "INTERIM",
      note: parsed.note ?? null,
    }
  } catch {
    // A transfer created by the legacy application holds free text here.
    return { ...fallback, note: notes }
  }
}

export const approveTransfer = firmAction({
  input: transferIdSchema,
  minimumRole: "MANAGER",
  module: "hr",
  revalidate: (input) => `/${input.firmSlug}/hr/transfers`,
  handler: async ({ input, ctx, tx, audit }) => {
    const transfer = await loadTransferFor(tx, input.id, "destination")

    if (transfer.status !== "PENDING") {
      throw new ActionError(
        `Ce transfert est ${transfer.status === "APPROVED" ? "déjà approuvé" : "clos"}.`
      )
    }

    // Weeks can pass between the request and the approval; the reserved
    // matricule may have been taken in the meantime.
    const clash = transfer.newMatricule
      ? await tx.employee.findFirst({
          where: {
            firmId: transfer.toFirmId,
            matricule: transfer.newMatricule,
          },
          select: { id: true },
        })
      : null

    const newMatricule = clash
      ? await nextMatricule(tx, transfer.toFirmId)
      : transfer.newMatricule

    await tx.employeeTransfer.update({
      where: { id: transfer.id },
      data: {
        status: "APPROVED",
        approvedBy: ctx.userId,
        approvedAt: new Date(),
        newMatricule,
      },
    })

    await audit({
      action: "APPROVE",
      entity: "EMPLOYEE_TRANSFER",
      entityId: transfer.id,
      metadata: {
        employeeId: transfer.employeeId,
        newMatricule,
        reassigned: Boolean(clash),
      },
    })

    return { newMatricule, reassigned: Boolean(clash) }
  },
})

export const rejectTransfer = firmAction({
  input: rejectTransferSchema,
  minimumRole: "MANAGER",
  module: "hr",
  revalidate: (input) => `/${input.firmSlug}/hr/transfers`,
  handler: async ({ input, ctx, tx, audit }) => {
    const transfer = await loadTransferFor(tx, input.id, "destination")

    if (transfer.status !== "PENDING") {
      throw new ActionError("Seul un transfert en attente peut être refusé.")
    }

    await tx.employeeTransfer.update({
      where: { id: transfer.id },
      data: {
        status: "REJECTED",
        approvedBy: ctx.userId,
        approvedAt: new Date(),
        rejectionReason: input.rejectionReason,
      },
    })

    await audit({
      action: "REJECT",
      entity: "EMPLOYEE_TRANSFER",
      entityId: transfer.id,
      metadata: {
        employeeId: transfer.employeeId,
        reason: input.rejectionReason,
      },
    })
  },
})

/* ==========================================================================
 * Cancel — the source firm withdraws its own request
 * ========================================================================== */

export const cancelTransfer = firmAction({
  input: transferIdSchema,
  minimumRole: "MANAGER",
  module: "hr",
  revalidate: (input) => `/${input.firmSlug}/hr/transfers`,
  handler: async ({ input, tx, audit }) => {
    const transfer = await loadTransferFor(tx, input.id, "source")

    if (!NON_TERMINAL.includes(transfer.status as "PENDING" | "APPROVED")) {
      throw new ActionError("Ce transfert est déjà clos.")
    }

    await tx.employeeTransfer.update({
      where: { id: transfer.id },
      data: { status: "CANCELLED" },
    })

    await audit({
      action: "CANCEL",
      entity: "EMPLOYEE_TRANSFER",
      entityId: transfer.id,
      metadata: { employeeId: transfer.employeeId, from: transfer.status },
    })
  },
})

/* ==========================================================================
 * Complete — the source firm lets them go
 * ========================================================================== */

export const completeTransfer = firmAction({
  input: transferIdSchema,
  minimumRole: "MANAGER",
  module: "hr",
  revalidate: (input) => [
    `/${input.firmSlug}/hr/transfers`,
    `/${input.firmSlug}/hr/employees`,
    `/${input.firmSlug}/hr/contracts`,
  ],
  handler: async ({ input, tx, audit }) => {
    const transfer = await loadTransferFor(tx, input.id, "source")

    if (transfer.status !== "APPROVED") {
      throw new ActionError(
        transfer.status === "PENDING"
          ? `${transfer.toFirm.name} n'a pas encore approuvé ce transfert.`
          : "Ce transfert est clos."
      )
    }

    // The effective date is a gate, not a label: an employee does not move
    // before the date both firms agreed on.
    const today = new Date()
    if (transfer.effectiveDate > today) {
      throw new ActionError(
        `Ce transfert prend effet le ${transfer.effectiveDate.toISOString().slice(0, 10)}. Il ne peut pas être finalisé avant.`
      )
    }

    const options = readOptions(transfer.notes)

    // Re-checked here as well as at approval: the reserved number may have been
    // taken between the two steps.
    const taken = transfer.newMatricule
      ? await tx.employee.findFirst({
          where: { firmId: transfer.toFirmId, matricule: transfer.newMatricule },
          select: { id: true },
        })
      : null
    const matricule = taken
      ? await nextMatricule(tx, transfer.toFirmId)
      : (transfer.newMatricule ?? (await nextMatricule(tx, transfer.toFirmId)))

    // Close everything open in the source firm, dating the end at the transfer
    // so the 730-day count stops on the right day.
    const closed = await tx.contract.updateMany({
      where: {
        employeeId: transfer.employeeId,
        firmId: transfer.fromFirmId,
        status: "ACTIVE",
      },
      data: {
        status: "TERMINATED",
        isActive: false,
        terminationDate: transfer.effectiveDate,
        endDate: transfer.effectiveDate,
        terminationReason: `Transfert vers ${transfer.toFirm.name}`,
      },
    })

    // Fix 4 — only write the client assignment the transfer actually names.
    // The legacy completion set it unconditionally, so a transfer raised
    // without a client silently cleared the employee's existing one.
    await tx.employee.update({
      where: { id: transfer.employeeId },
      data: {
        firmId: transfer.toFirmId,
        matricule,
        status: "ACTIVE",
        ...(transfer.clientId ? { assignedClientId: transfer.clientId } : {}),
        // Departments belong to a firm; the old one cannot follow.
        departmentId: null,
      },
    })

    // Fix 2 — the destination contract. Without it the employee arrives in the
    // new firm employed by nobody, which is what the live deployment does today.
    let destinationContractId: string | null = null
    if (options.createDestinationContract) {
      const contract = await tx.contract.create({
        data: {
          firmId: transfer.toFirmId,
          employeeId: transfer.employeeId,
          clientId: transfer.clientId,
          type: options.contractType,
          status: "ACTIVE",
          startDate: transfer.effectiveDate,
          position: transfer.employee.jobTitle,
          salary: transfer.employee.netSalary,
          isVise: false,
          isActive: true,
          notes: `Contrat ouvert par le transfert depuis ${transfer.fromFirm.name}`,
        },
        select: { id: true },
      })
      destinationContractId = contract.id
    }

    await tx.employeeTransfer.update({
      where: { id: transfer.id },
      data: { status: "COMPLETED", newMatricule: matricule },
    })

    await audit({
      action: "COMPLETE",
      entity: "EMPLOYEE_TRANSFER",
      entityId: transfer.id,
      metadata: {
        employeeId: transfer.employeeId,
        formerMatricule: transfer.employee.matricule,
        newMatricule: matricule,
        closedContracts: closed.count,
        destinationContractId,
        clientAssigned: transfer.clientId,
      },
    })

    return {
      newMatricule: matricule,
      closedContracts: closed.count,
      destinationContractId,
    }
  },
})
