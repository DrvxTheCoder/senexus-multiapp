"use server"

import {
  archiveClientSchema,
  createClientSchema,
  toOptionalDate,
  updateClientSchema,
} from "@/lib/forms/hr-schemas"
import { ActionError, firmAction } from "@/server/actions/define-action"

/**
 * Clients.
 *
 * There is no delete. A client is referenced by contracts, by employees'
 * `assignedClientId`, by transfers and by the `UserClientAssignment` rows that
 * define what a RESPONSABLE can see; removing one would either fail on a
 * foreign key or take history with it. `ARCHIVED` is the end state, and the
 * archive refuses while anyone is still assigned — otherwise a responsable's
 * portfolio quietly empties.
 */

const orNull = (value: string | null | undefined) =>
  value && value.trim() ? value.trim() : null

export const createClient = firmAction({
  input: createClientSchema,
  minimumRole: "MANAGER",
  module: "crm",
  revalidate: (input) => [
    `/${input.firmSlug}/crm/clients`,
    `/${input.firmSlug}/dashboard`,
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    const clash = await tx.client.findFirst({
      where: {
        firmId: ctx.firmId,
        name: { equals: input.name, mode: "insensitive" },
      },
      select: { id: true },
    })
    if (clash) {
      throw new ActionError("Un client porte déjà ce nom.", {
        name: ["Un client porte déjà ce nom."],
      })
    }

    const client = await tx.client.create({
      data: {
        firmId: ctx.firmId,
        name: input.name,
        status: input.status,
        contactName: orNull(input.contactName),
        contactEmail: orNull(input.contactEmail),
        contactPhone: orNull(input.contactPhone),
        taxNumber: orNull(input.taxNumber),
        industry: orNull(input.industry),
        address: orNull(input.address),
        contractStartDate: toOptionalDate(input.contractStartDate),
        contractEndDate: toOptionalDate(input.contractEndDate),
        notes: orNull(input.notes),
      },
      select: { id: true },
    })

    await audit({
      action: "CREATE",
      entity: "CLIENT",
      entityId: client.id,
      metadata: { name: input.name, status: input.status },
    })

    return client
  },
})

export const updateClient = firmAction({
  input: updateClientSchema,
  minimumRole: "MANAGER",
  module: "crm",
  revalidate: (input) => `/${input.firmSlug}/crm/clients`,
  handler: async ({ input, ctx, tx, audit }) => {
    const existing = await tx.client.findFirst({
      where: { id: input.id, firmId: ctx.firmId },
      select: { id: true, name: true },
    })
    if (!existing) throw new ActionError("Client introuvable.")

    const clash = await tx.client.findFirst({
      where: {
        firmId: ctx.firmId,
        name: { equals: input.name, mode: "insensitive" },
        NOT: { id: existing.id },
      },
      select: { id: true },
    })
    if (clash) {
      throw new ActionError("Un client porte déjà ce nom.", {
        name: ["Un client porte déjà ce nom."],
      })
    }

    await tx.client.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        status: input.status,
        contactName: orNull(input.contactName),
        contactEmail: orNull(input.contactEmail),
        contactPhone: orNull(input.contactPhone),
        taxNumber: orNull(input.taxNumber),
        industry: orNull(input.industry),
        address: orNull(input.address),
        contractStartDate: toOptionalDate(input.contractStartDate),
        contractEndDate: toOptionalDate(input.contractEndDate),
        notes: orNull(input.notes),
      },
    })

    await audit({
      action: "UPDATE",
      entity: "CLIENT",
      entityId: existing.id,
      metadata: { name: input.name, status: input.status },
    })
  },
})

export const archiveClient = firmAction({
  input: archiveClientSchema,
  minimumRole: "MANAGER",
  module: "crm",
  revalidate: (input) => [
    `/${input.firmSlug}/crm/clients`,
    `/${input.firmSlug}/hr/employees`,
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    const client = await tx.client.findFirst({
      where: { id: input.id, firmId: ctx.firmId },
      select: {
        id: true,
        name: true,
        status: true,
        _count: { select: { assignedEmployees: true } },
      },
    })
    if (!client) throw new ActionError("Client introuvable.")
    if (client.status === "ARCHIVED") {
      throw new ActionError("Ce client est déjà archivé.")
    }

    const activeAssigned = await tx.employee.count({
      where: {
        firmId: ctx.firmId,
        assignedClientId: client.id,
        status: { in: ["ACTIVE", "ON_LEAVE"] },
      },
    })
    if (activeAssigned > 0) {
      throw new ActionError(
        `${activeAssigned} employé${activeAssigned > 1 ? "s sont encore affectés" : " est encore affecté"} à ${client.name}. Réaffectez-les avant d'archiver.`
      )
    }

    const activeContracts = await tx.contract.count({
      where: { firmId: ctx.firmId, clientId: client.id, status: "ACTIVE" },
    })
    if (activeContracts > 0) {
      throw new ActionError(
        `${activeContracts} contrat${activeContracts > 1 ? "s actifs sont rattachés" : " actif est rattaché"} à ${client.name}.`
      )
    }

    await tx.client.update({
      where: { id: client.id },
      data: { status: "ARCHIVED" },
    })

    await audit({
      action: "ARCHIVE",
      entity: "CLIENT",
      entityId: client.id,
      metadata: {
        name: client.name,
        formerEmployees: client._count.assignedEmployees,
      },
    })
  },
})
