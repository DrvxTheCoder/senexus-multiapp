"use server"

import { hash } from "bcryptjs"
import { z } from "zod"
import type { Prisma } from "@prisma/client"

import {
  clientAssignmentSchema,
  createFirmSchema,
  createUserSchema,
  deleteFirmSchema,
  deleteUserSchema,
  firmModuleSchema,
  moduleSchema,
  resetPasswordSchema,
  updateFirmSchema,
  updateModuleSchema,
  updateUserSchema,
} from "@/lib/forms/admin-schemas"
import { ActionError, holdingAction } from "@/server/actions/define-action"
import { HR_MODULE_SLUG, writeMatriculePrefix } from "@/server/domain/matricule"

/**
 * The administration console.
 *
 * Every action here goes through `holdingAction`, which reproduces the legacy
 * access rule — OWNER or ADMIN of *any* firm — but actually enforces it. The
 * legacy `/api/firms` and `/api/users` routes checked only that a session
 * existed, so any signed-in user could create a firm, delete a colleague, or
 * reset anyone's password, including their own to OWNER.
 */

const ADMIN_PATHS = ["/admin", "/admin/firms", "/admin/users", "/admin/modules"]
const BCRYPT_COST = 10

/* ==========================================================================
 * Firms
 * ========================================================================== */

/** The single holding this deployment operates. */
async function defaultHoldingId(tx: Prisma.TransactionClient): Promise<string> {
  const holding = await tx.holding.findFirst({ select: { id: true } })
  if (!holding) {
    throw new ActionError("Aucune holding n'existe dans la base.")
  }
  return holding.id
}

export const createFirm = holdingAction({
  input: createFirmSchema,
  revalidate: ADMIN_PATHS,
  handler: async ({ input, tx, audit }) => {
    const clash = await tx.firm.findUnique({
      where: { slug: input.slug },
      select: { id: true },
    })
    if (clash) {
      throw new ActionError("Cet identifiant est déjà utilisé.", {
        slug: ["Cet identifiant est déjà utilisé."],
      })
    }

    const firm = await tx.firm.create({
      data: {
        holdingId: await defaultHoldingId(tx),
        name: input.name,
        slug: input.slug,
        logo: input.logo || null,
        themeColor: input.themeColor || null,
      },
      select: { id: true, slug: true },
    })

    if (input.matriculePrefix) {
      await writeMatriculePrefix(tx, firm.id, input.matriculePrefix)
    }

    await audit({
      action: "CREATE",
      entity: "FIRM",
      entityId: firm.id,
      metadata: { name: input.name, slug: input.slug },
    })

    return firm
  },
})

export const updateFirm = holdingAction({
  input: updateFirmSchema,
  revalidate: ADMIN_PATHS,
  handler: async ({ input, tx, audit }) => {
    const clash = await tx.firm.findFirst({
      where: { slug: input.slug, NOT: { id: input.id } },
      select: { id: true },
    })
    if (clash) {
      throw new ActionError("Cet identifiant est déjà utilisé.", {
        slug: ["Cet identifiant est déjà utilisé."],
      })
    }

    await tx.firm.update({
      where: { id: input.id },
      data: {
        name: input.name,
        slug: input.slug,
        logo: input.logo || null,
        themeColor: input.themeColor || null,
      },
    })

    if (input.matriculePrefix !== undefined) {
      await writeMatriculePrefix(tx, input.id, input.matriculePrefix)
    }

    await audit({
      action: "UPDATE",
      entity: "FIRM",
      entityId: input.id,
      metadata: { name: input.name, slug: input.slug },
    })
  },
})

export const deleteFirm = holdingAction({
  input: deleteFirmSchema,
  revalidate: ADMIN_PATHS,
  handler: async ({ input, tx, audit }) => {
    const firm = await tx.firm.findUnique({
      where: { id: input.id },
      select: {
        name: true,
        _count: { select: { employees: true, contracts: true, clients: true } },
      },
    })
    if (!firm) throw new ActionError("Entreprise introuvable.")

    // Retyping the name is the confirmation. Deleting a firm cascades through
    // every employee, contract, document and audit row it owns; a red button is
    // not enough friction for that.
    if (input.confirmName.trim() !== firm.name) {
      throw new ActionError("Le nom saisi ne correspond pas.", {
        confirmName: ["Le nom saisi ne correspond pas."],
      })
    }

    // The audit row is written *before* the delete, because `firmId` is
    // nullable on AuditLog and the cascade would take the row with it.
    await audit({
      action: "DELETE",
      entity: "FIRM",
      entityId: input.id,
      metadata: {
        name: firm.name,
        employees: firm._count.employees,
        contracts: firm._count.contracts,
        clients: firm._count.clients,
      },
    })

    await tx.firm.delete({ where: { id: input.id } })
  },
})

/* ==========================================================================
 * Users
 * ========================================================================== */

/**
 * ADMIN and OWNER are members of every firm.
 *
 * Kept from the legacy behaviour deliberately: it is what makes the
 * Administration entry appear for them, and the console is cross-tenant
 * anyway. Made explicit here rather than happening invisibly in a form effect.
 */
async function firmIdsFor(
  tx: Prisma.TransactionClient,
  role: string,
  requested: string[]
): Promise<string[]> {
  if (role !== "ADMIN" && role !== "OWNER") return requested
  const all = await tx.firm.findMany({ select: { id: true } })
  return all.map((firm) => firm.id)
}

export const createUser = holdingAction({
  input: createUserSchema,
  revalidate: ADMIN_PATHS,
  handler: async ({ input, tx, audit }) => {
    const existing = await tx.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    })
    if (existing) {
      throw new ActionError("Cette adresse email est déjà utilisée.", {
        email: ["Cette adresse email est déjà utilisée."],
      })
    }

    const user = await tx.user.create({
      data: {
        name: input.name,
        email: input.email,
        image: input.image || null,
        passwordHash: await hash(input.password, BCRYPT_COST),
        // Accounts created by an administrator are trusted; there is no mail
        // transport in this deployment to verify against.
        emailVerified: new Date(),
      },
      select: { id: true },
    })

    const firmIds = await firmIdsFor(tx, input.role, input.firmIds)
    await tx.userFirm.createMany({
      data: firmIds.map((firmId) => ({
        userId: user.id,
        firmId,
        role: input.role,
      })),
      skipDuplicates: true,
    })

    if (input.employeeId) {
      await tx.employee.update({
        where: { id: input.employeeId },
        data: { userId: user.id },
      })
    }

    await audit({
      action: "CREATE",
      entity: "USER",
      entityId: user.id,
      metadata: { email: input.email, role: input.role, firms: firmIds.length },
    })

    return user
  },
})

export const updateUser = holdingAction({
  input: updateUserSchema,
  revalidate: ADMIN_PATHS,
  handler: async ({ input, tx, audit }) => {
    const clash = await tx.user.findFirst({
      where: { email: input.email, NOT: { id: input.id } },
      select: { id: true },
    })
    if (clash) {
      throw new ActionError("Cette adresse email est déjà utilisée.", {
        email: ["Cette adresse email est déjà utilisée."],
      })
    }

    await tx.user.update({
      where: { id: input.id },
      data: {
        name: input.name,
        email: input.email,
        image: input.image || null,
      },
    })

    // Memberships are replace-all, matching the legacy behaviour. It is worth
    // knowing what that costs: a user holding different roles in different
    // firms loses that distinction on any edit, because the form expresses one
    // role for the whole set.
    const firmIds = await firmIdsFor(tx, input.role, input.firmIds)
    await tx.userFirm.deleteMany({ where: { userId: input.id } })
    await tx.userFirm.createMany({
      data: firmIds.map((firmId) => ({
        userId: input.id,
        firmId,
        role: input.role,
      })),
      skipDuplicates: true,
    })

    // Re-link the employee record, clearing any previous link first.
    await tx.employee.updateMany({
      where: { userId: input.id },
      data: { userId: null },
    })
    if (input.employeeId) {
      await tx.employee.update({
        where: { id: input.employeeId },
        data: { userId: input.id },
      })
    }

    await audit({
      action: "UPDATE",
      entity: "USER",
      entityId: input.id,
      metadata: { email: input.email, role: input.role, firms: firmIds.length },
    })
  },
})

export const deleteUser = holdingAction({
  input: deleteUserSchema,
  revalidate: ADMIN_PATHS,
  handler: async ({ input, userId, tx, audit }) => {
    if (input.id === userId) {
      throw new ActionError("Vous ne pouvez pas supprimer votre propre compte.")
    }

    const user = await tx.user.findUnique({
      where: { id: input.id },
      select: { email: true },
    })
    if (!user) throw new ActionError("Utilisateur introuvable.")

    await audit({
      action: "DELETE",
      entity: "USER",
      entityId: input.id,
      metadata: { email: user.email },
    })

    await tx.user.delete({ where: { id: input.id } })
  },
})

export const resetUserPassword = holdingAction({
  input: resetPasswordSchema,
  handler: async ({ input, tx, audit }) => {
    await tx.user.update({
      where: { id: input.id },
      data: { passwordHash: await hash(input.password, BCRYPT_COST) },
    })

    await audit({
      action: "UPDATE",
      entity: "USER",
      entityId: input.id,
      metadata: { action: "password_reset", by: "administrator" },
    })
  },
})

/* ==========================================================================
 * Client assignments
 * ========================================================================== */

/**
 * `UserClientAssignment` is what gives `RESPONSABLE` its meaning: the set of
 * clients a user may see inside one firm. Every query resolver reads it through
 * `FirmContext.assignedClientIds`, so this screen is the control surface for
 * the whole restricted-visibility model.
 */
export const setClientAssignments = holdingAction({
  input: clientAssignmentSchema,
  revalidate: ADMIN_PATHS,
  handler: async ({ input, tx, audit }) => {
    const clients = await tx.client.findMany({
      where: { id: { in: input.clientIds }, firmId: input.firmId },
      select: { id: true },
    })

    // Only clients that genuinely belong to the firm are assignable, so a
    // crafted request cannot grant visibility across a tenant boundary.
    const valid = clients.map((client) => client.id)

    await tx.userClientAssignment.deleteMany({
      where: { userId: input.userId, firmId: input.firmId },
    })

    if (valid.length > 0) {
      await tx.userClientAssignment.createMany({
        data: valid.map((clientId) => ({
          userId: input.userId,
          clientId,
          firmId: input.firmId,
        })),
        skipDuplicates: true,
      })
    }

    await audit({
      action: "UPDATE",
      entity: "USER_CLIENT_ASSIGNMENT",
      entityId: input.userId,
      metadata: { firmId: input.firmId, clients: valid.length },
    })
  },
})

/* ==========================================================================
 * Modules
 * ========================================================================== */

export const createModule = holdingAction({
  input: moduleSchema,
  revalidate: ADMIN_PATHS,
  handler: async ({ input, tx, audit }) => {
    const clash = await tx.module.findUnique({
      where: { slug: input.slug },
      select: { id: true },
    })
    if (clash) {
      throw new ActionError("Ce module existe déjà.", {
        slug: ["Ce module existe déjà."],
      })
    }

    const created = await tx.module.create({
      data: {
        slug: input.slug,
        name: input.name,
        description: input.description || null,
        version: input.version,
        basePath: input.basePath,
        icon: input.icon || null,
        isSystem: false,
        isActive: true,
      },
      select: { id: true, slug: true },
    })

    await audit({
      action: "CREATE",
      entity: "MODULE",
      entityId: created.id,
      metadata: { slug: input.slug, name: input.name },
    })

    return created
  },
})

export const updateModule = holdingAction({
  input: updateModuleSchema,
  revalidate: ADMIN_PATHS,
  handler: async ({ input, tx, audit }) => {
    const { id, ...rest } = input
    await tx.module.update({
      where: { id },
      data: {
        ...(rest.name !== undefined ? { name: rest.name } : {}),
        ...(rest.description !== undefined
          ? { description: rest.description || null }
          : {}),
        ...(rest.version !== undefined ? { version: rest.version } : {}),
        ...(rest.basePath !== undefined ? { basePath: rest.basePath } : {}),
        ...(rest.isActive !== undefined ? { isActive: rest.isActive } : {}),
      },
    })

    await audit({
      action: "UPDATE",
      entity: "MODULE",
      entityId: id,
      metadata: rest as Prisma.InputJsonObject,
    })
  },
})

/**
 * Install, enable, disable or uninstall a module for one firm.
 *
 * `isEnabled: null` uninstalls. A **system** module cannot be uninstalled —
 * the legacy console let anyone remove HR from a firm, which silently 404s
 * every employee and contract route it owns.
 */
export const setFirmModule = holdingAction({
  input: firmModuleSchema,
  revalidate: ADMIN_PATHS,
  handler: async ({ input, tx, audit }) => {
    const moduleRow = await tx.module.findUnique({
      where: { id: input.moduleId },
      select: { slug: true, isSystem: true, name: true },
    })
    if (!moduleRow) throw new ActionError("Module introuvable.")

    if (input.isEnabled === null) {
      if (moduleRow.isSystem) {
        throw new ActionError(
          `${moduleRow.name} est un module système et ne peut pas être désinstallé.`
        )
      }
      await tx.firmModule.deleteMany({
        where: { firmId: input.firmId, moduleId: input.moduleId },
      })
      await audit({
        action: "UNINSTALL",
        entity: "FIRM_MODULE",
        entityId: input.moduleId,
        metadata: { firmId: input.firmId, slug: moduleRow.slug },
      })
      return
    }

    await tx.firmModule.upsert({
      where: {
        firmId_moduleId: { firmId: input.firmId, moduleId: input.moduleId },
      },
      update: { isEnabled: input.isEnabled },
      create: {
        firmId: input.firmId,
        moduleId: input.moduleId,
        isEnabled: input.isEnabled,
      },
    })

    await audit({
      action: input.isEnabled ? "ENABLE" : "DISABLE",
      entity: "FIRM_MODULE",
      entityId: input.moduleId,
      metadata: { firmId: input.firmId, slug: moduleRow.slug },
    })
  },
})

/**
 * Creates the `documents` module and installs it everywhere.
 *
 * Documents is gated on a module row that production does not have, so the nav
 * entry and the employee Documents tab are invisible until it exists. This is
 * the one-click fix, offered from the modules screen rather than left as a
 * SQL script for someone to run by hand.
 */
export const installDocumentsModule = holdingAction({
  input: z.object({}),
  revalidate: ADMIN_PATHS,
  handler: async ({ tx, audit }) => {
    const documentsModule = await tx.module.upsert({
      where: { slug: "documents" },
      update: { isActive: true },
      create: {
        slug: "documents",
        name: "Documents",
        description:
          "Pièces rattachées aux employés : contrats signés, CNI, certificats.",
        version: "1.0.0",
        basePath: "/documents",
        icon: "Folder01Icon",
        isSystem: false,
        isActive: true,
      },
      select: { id: true },
    })

    // Documents depends on HR: it lists pieces attached to employees.
    const hr = await tx.module.findUnique({
      where: { slug: HR_MODULE_SLUG },
      select: { id: true },
    })
    if (hr) {
      const existing = await tx.moduleDependency.findUnique({
        where: {
          moduleId_dependsOnId: { moduleId: documentsModule.id, dependsOnId: hr.id },
        },
        select: { id: true },
      })
      if (!existing) {
        await tx.moduleDependency.create({
          data: { moduleId: documentsModule.id, dependsOnId: hr.id },
        })
      }
    }

    // **Only firms that have HR.**
    //
    // This used to be `findMany({})` — every firm in the database — which was
    // harmless while every firm was an HR filiale and became a leak the moment
    // one was not: IPM Tawfeikh came out with the employee-documents surface
    // enabled, and a FirmModule row whose declared dependency on `hr` was not
    // met. A bulk install must respect the dependency it just declared, and a
    // firm added later must not be granted a module by a loop written before
    // it existed.
    const firms = hr
      ? await tx.firm.findMany({
          where: {
            firmModules: { some: { moduleId: hr.id, isEnabled: true } },
          },
          select: { id: true },
        })
      : []

    for (const firm of firms) {
      await tx.firmModule.upsert({
        where: {
          firmId_moduleId: { firmId: firm.id, moduleId: documentsModule.id },
        },
        update: { isEnabled: true },
        create: { firmId: firm.id, moduleId: documentsModule.id, isEnabled: true },
      })
    }

    await audit({
      action: "INSTALL",
      entity: "MODULE",
      entityId: documentsModule.id,
      metadata: { slug: "documents", firms: firms.length },
    })

    return { firms: firms.length }
  },
})
