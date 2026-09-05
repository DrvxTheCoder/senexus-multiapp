"use server"

import {
  DOCUMENT_MAX_BYTES,
  EMPLOYEE_QUOTA_BYTES,
  documentIdSchema,
  toOptionalDate,
  uploadDocumentSchema,
  verifyDocumentSchema,
} from "@/lib/forms/hr-schemas"
import { ActionError, firmAction } from "@/server/actions/define-action"
import { DOCUMENT_MIME, safeDeleteFile, uploadDocument } from "@/server/storage/zipline"

/**
 * Employee documents.
 *
 * Two things the legacy implementation got wrong and this does not:
 *
 * - **Deleting a document left its blob behind.** Every deleted row leaked a
 *   file on the Zipline instance forever. The row and the file now go together.
 * - **An upload that failed to insert left the blob behind too.** The upload
 *   happens before the transaction can commit — it is a network call to another
 *   host, and it cannot be rolled back — so a failure after it succeeds
 *   compensates by deleting what it just wrote.
 *
 * The 2 MB per-file limit and the 100 MB per-employee quota are the legacy
 * uploader's, kept.
 */

export const uploadEmployeeDocument = firmAction({
  input: uploadDocumentSchema,
  minimumRole: "STAFF",
  module: "hr",
  revalidate: (input) => [
    `/${input.firmSlug}/documents`,
    `/${input.firmSlug}/hr/employees/${input.employeeId}`,
  ],
  handler: async ({ input, ctx, tx, audit }) => {
    const employee = await tx.employee.findFirst({
      where: {
        id: input.employeeId,
        firmId: ctx.firmId,
        // A responsable may only attach a document to someone in their own
        // portfolio, exactly as they may only read one.
        ...(ctx.assignedClientIds
          ? { assignedClientId: { in: ctx.assignedClientIds } }
          : {}),
      },
      select: { id: true, matricule: true },
    })
    if (!employee) throw new ActionError("Employé introuvable.")

    if (!DOCUMENT_MIME.includes(input.file.type)) {
      throw new ActionError(
        `Type non autorisé (${input.file.type || "inconnu"}). PDF, JPEG ou PNG.`,
        { file: ["PDF, JPEG ou PNG uniquement."] }
      )
    }
    if (input.file.size > DOCUMENT_MAX_BYTES) {
      throw new ActionError("Fichier trop volumineux (2 Mo maximum).", {
        file: ["2 Mo maximum."],
      })
    }

    const used = await tx.employeeDocument.aggregate({
      where: { employeeId: employee.id },
      _sum: { fileSize: true },
    })
    const usedBytes = used._sum.fileSize ?? 0
    if (usedBytes + input.file.size > EMPLOYEE_QUOTA_BYTES) {
      throw new ActionError(
        `Quota atteint : ${(usedBytes / 1_048_576).toFixed(0)} Mo sur ${(EMPLOYEE_QUOTA_BYTES / 1_048_576).toFixed(0)} Mo déjà utilisés pour cet employé.`,
        { file: ["Quota de l'employé atteint."] }
      )
    }

    // Uploaded before the row is written, because it is a call to another host
    // and cannot join this transaction. The catch below is what keeps that
    // honest.
    const uploaded = await uploadDocument(
      input.file,
      `${ctx.firm.slug}/employees/${employee.matricule}`,
      `${Date.now()}-${input.file.name}`
    )

    try {
      const document = await tx.employeeDocument.create({
        data: {
          employeeId: employee.id,
          firmId: ctx.firmId,
          documentType: input.documentType,
          fileName: input.file.name,
          storageKey: uploaded.storageKey,
          fileUrl: uploaded.url,
          fileSize: uploaded.size,
          mimeType: uploaded.mimeType,
          uploadedBy: ctx.userId,
          description: input.description?.trim() || null,
          expiryDate: toOptionalDate(input.expiryDate),
        },
        select: { id: true },
      })

      await audit({
        action: "UPLOAD",
        entity: "EMPLOYEE_DOCUMENT",
        entityId: document.id,
        metadata: {
          employeeId: employee.id,
          documentType: input.documentType,
          bytes: uploaded.size,
        },
      })

      return { id: document.id }
    } catch (error) {
      // The row did not land; the blob must not survive it.
      await safeDeleteFile(uploaded.url)
      throw error
    }
  },
})

/* -------------------------------------------------------------------------- */

export const verifyDocument = firmAction({
  input: verifyDocumentSchema,
  minimumRole: "MANAGER",
  module: "hr",
  revalidate: (input) => `/${input.firmSlug}/documents`,
  handler: async ({ input, ctx, tx, audit }) => {
    const document = await tx.employeeDocument.findFirst({
      where: {
        id: input.id,
        firmId: ctx.firmId,
        ...(ctx.assignedClientIds
          ? { employee: { assignedClientId: { in: ctx.assignedClientIds } } }
          : {}),
      },
      select: { id: true, employeeId: true },
    })
    if (!document) throw new ActionError("Pièce introuvable.")

    await tx.employeeDocument.update({
      where: { id: document.id },
      data: {
        isVerified: input.isVerified,
        verifiedBy: input.isVerified ? ctx.userId : null,
        verifiedAt: input.isVerified ? new Date() : null,
      },
    })

    await audit({
      action: input.isVerified ? "VERIFY" : "UNVERIFY",
      entity: "EMPLOYEE_DOCUMENT",
      entityId: document.id,
      metadata: { employeeId: document.employeeId },
    })
  },
})

/* -------------------------------------------------------------------------- */

export const deleteDocument = firmAction({
  input: documentIdSchema,
  minimumRole: "MANAGER",
  module: "hr",
  revalidate: (input) => `/${input.firmSlug}/documents`,
  handler: async ({ input, ctx, tx, audit }) => {
    const document = await tx.employeeDocument.findFirst({
      where: {
        id: input.id,
        firmId: ctx.firmId,
        ...(ctx.assignedClientIds
          ? { employee: { assignedClientId: { in: ctx.assignedClientIds } } }
          : {}),
      },
      select: {
        id: true,
        employeeId: true,
        fileName: true,
        fileUrl: true,
        documentType: true,
      },
    })
    if (!document) throw new ActionError("Pièce introuvable.")

    await audit({
      action: "DELETE",
      entity: "EMPLOYEE_DOCUMENT",
      entityId: document.id,
      metadata: {
        employeeId: document.employeeId,
        fileName: document.fileName,
        documentType: document.documentType,
      },
    })

    await tx.employeeDocument.delete({ where: { id: document.id } })

    // After the row is gone, and never able to fail the transaction: an
    // unreachable storage host must not block the deletion the user asked for.
    // The warning it logs is the trail if a blob is ever left behind.
    await safeDeleteFile(document.fileUrl)
  },
})
