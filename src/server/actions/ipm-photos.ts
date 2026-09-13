"use server"

import { revalidatePath } from "next/cache"

import type { ActionResult } from "@/lib/forms/action-result"
import { db } from "@/lib/db"
import {
  removePhotoSchema,
  uploadPhotoSchema,
  type PhotoSubject,
} from "@/lib/forms/ipm-schemas"
import { ActionError } from "@/server/actions/define-action"
import {
  requireFirmAccess,
  requireModule,
  type FirmContext,
} from "@/server/auth/require-firm-access"
import { isAccessError } from "@/server/errors"
import { deleteFile, StorageError, uploadImage } from "@/server/storage/zipline"

/**
 * Photos des participants et ayants droit.
 *
 * Separate from `actions/ipm.ts` because these cannot use `firmAction`: that
 * wrapper runs its handler inside `db.$transaction`, and uploading to Zipline
 * is a network round trip that must not hold a database transaction open — a
 * slow file host would otherwise park a write lock for its whole timeout.
 *
 * So the ordering is explicit here, and it is the part that matters:
 *
 *   1. authorise, from the caller's session, before anything is read;
 *   2. resolve the subject **within the caller's firm**, so an id from another
 *      tenant does not resolve at all;
 *   3. upload, outside any transaction;
 *   4. write the URL and the audit row together, inside one.
 *
 * The same guarantees as `firmAction`, in the same order, minus the part that
 * cannot hold a socket.
 *
 * ## Why the file travels as FormData
 *
 * A `File` cannot cross a server-action boundary inside a JSON payload, so the
 * metadata is validated with Zod and the file is pulled off the `FormData`
 * and validated by the storage layer, which already enforces the MIME
 * allow-list and the 5 MB ceiling. A client-side check is a courtesy; this is
 * the guard.
 */

const MODULE = "ipm"

/** Where a subject's photo lives, and what it is called. */
function folderFor(subject: PhotoSubject, matricule: string): string {
  return subject === "member"
    ? `ipm/participants/${matricule}`
    : `ipm/ayants-droit/${matricule}`
}

/**
 * Resolves the subject inside the caller's firm and returns its person.
 *
 * The firm scope is in the `where`, not checked afterwards: a member id from
 * another firm simply does not match, so the failure is "introuvable" and the
 * response cannot be used to discover which ids are real.
 */
async function resolveSubject(
  ctx: FirmContext,
  subject: PhotoSubject,
  subjectId: string
): Promise<{ personId: string; matricule: string; memberId: string }> {
  if (subject === "member") {
    const member = await db.member.findFirst({
      where: { id: subjectId, firmId: ctx.firmId },
      select: { id: true, personId: true, matricule: true },
    })
    if (!member) throw new ActionError("Participant introuvable.")
    return {
      personId: member.personId,
      matricule: member.matricule,
      memberId: member.id,
    }
  }

  const dependent = await db.dependent.findFirst({
    where: { id: subjectId, firmId: ctx.firmId },
    select: { id: true, personId: true, matricule: true, memberId: true },
  })
  if (!dependent) throw new ActionError("Ayant droit introuvable.")
  return {
    personId: dependent.personId,
    matricule: dependent.matricule,
    memberId: dependent.memberId,
  }
}

function fail(error: unknown): ActionResult<never> {
  if (error instanceof ActionError || error instanceof StorageError) {
    return { ok: false, message: error.message }
  }
  if (isAccessError(error)) {
    return { ok: false, message: error.message, status: error.status }
  }
  // Never the photo bytes, never the person: a photo failure must not put
  // identity data into a log line.
  console.error("IPM photo action failed")
  return { ok: false, message: "Le téléversement a échoué." }
}

/* ==========================================================================
 * Upload
 * ========================================================================== */

export async function uploadPersonPhoto(
  formData: FormData
): Promise<ActionResult<{ photoUrl: string }>> {
  try {
    const input = uploadPhotoSchema.parse({
      firmSlug: formData.get("firmSlug"),
      subject: formData.get("subject"),
      subjectId: formData.get("subjectId"),
    })

    // MANAGER, the same bar as every other affiliation write: a photo is part
    // of the identity document the institution issues.
    const ctx = await requireFirmAccess(input.firmSlug, "MANAGER")
    requireModule(ctx, MODULE)

    const file = formData.get("file")
    if (!(file instanceof File) || file.size === 0) {
      throw new ActionError("Aucun fichier reçu.")
    }

    const subject = await resolveSubject(ctx, input.subject, input.subjectId)

    // The previous photo, so it can be removed once the new one is committed.
    const person = await db.person.findUnique({
      where: { id: subject.personId },
      select: { photoUrl: true },
    })

    // Outside the transaction, deliberately — see the module comment.
    const uploaded = await uploadImage(
      file,
      folderFor(input.subject, subject.matricule)
    )

    await db.$transaction(async (tx) => {
      await tx.person.update({
        where: { id: subject.personId },
        data: { photoUrl: uploaded.url },
      })

      await tx.auditLog.create({
        data: {
          firmId: ctx.firmId,
          actorId: ctx.userId,
          action: "UPDATE",
          entity:
            input.subject === "member" ? "IPM_MEMBER_PHOTO" : "IPM_DEPENDENT_PHOTO",
          entityId: input.subjectId,
          metadata: { subject: input.subject, size: uploaded.size },
        },
      })
    })

    // Only after the new URL is committed. Deleting first would lose the old
    // photo if the write then failed, and a failed delete must not fail the
    // upload — an orphaned file is cheaper than a lost one.
    if (person?.photoUrl && person.photoUrl !== uploaded.url) {
      await deleteFile(person.photoUrl).catch(() => {})
    }

    revalidate(input.firmSlug, subject.memberId)
    return { ok: true, data: { photoUrl: uploaded.url } }
  } catch (error) {
    return fail(error)
  }
}

/* ==========================================================================
 * Removal
 * ========================================================================== */

export async function removePersonPhoto(
  raw: unknown
): Promise<ActionResult<null>> {
  try {
    const input = removePhotoSchema.parse(raw)
    const ctx = await requireFirmAccess(input.firmSlug, "MANAGER")
    requireModule(ctx, MODULE)

    const subject = await resolveSubject(ctx, input.subject, input.subjectId)
    const person = await db.person.findUnique({
      where: { id: subject.personId },
      select: { photoUrl: true },
    })

    await db.$transaction(async (tx) => {
      await tx.person.update({
        where: { id: subject.personId },
        data: { photoUrl: null },
      })

      await tx.auditLog.create({
        data: {
          firmId: ctx.firmId,
          actorId: ctx.userId,
          action: "DELETE",
          entity:
            input.subject === "member" ? "IPM_MEMBER_PHOTO" : "IPM_DEPENDENT_PHOTO",
          entityId: input.subjectId,
          metadata: { subject: input.subject },
        },
      })
    })

    if (person?.photoUrl) {
      await deleteFile(person.photoUrl).catch(() => {})
    }

    revalidate(input.firmSlug, subject.memberId)
    return { ok: true, data: null }
  } catch (error) {
    return fail(error)
  }
}

/**
 * The screens a photo change is visible on.
 *
 * The card list is included because a photo is printed content: changing one
 * makes the existing card stale, and that list is how an operator sees it.
 */
function revalidate(firmSlug: string, memberId: string): void {
  revalidatePath(`/${firmSlug}/ipm/participants/${memberId}`)
  revalidatePath(`/${firmSlug}/ipm/participants`)
  revalidatePath(`/${firmSlug}/ipm/cartes`)
}
