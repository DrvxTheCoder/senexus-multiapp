"use server"

import type { ActionResult } from "@/lib/forms/action-result"
import {
  getSession,
  requireHoldingAccess,
} from "@/server/auth/require-firm-access"
import { isAccessError, UnauthorizedError } from "@/server/errors"
import { StorageError, uploadImage } from "@/server/storage/zipline"

/**
 * Téléversement des images de marque et d'identité.
 *
 * Avatars, logos, en-têtes, cachets, signatures. One action rather than five,
 * because they differ only in where the bytes land and who may put them there.
 *
 * ## Why this writes nothing
 *
 * It uploads and returns a URL. The row is written by the form's own action —
 * `createUser`, `updateFirm`, `updateProfile` — which already owns the
 * validation, the audit row and the transaction.
 *
 * That split is not tidiness. `firmAction` and `holdingAction` run their
 * handler **inside** `db.$transaction`, and an upload is a network round trip
 * to another host: doing it there parks a write lock for the whole of a slow
 * file host's timeout. `ipm-photos.ts` solves the same problem by taking the
 * transaction apart by hand; a create dialog cannot, because the row it would
 * attach the image to does not exist yet. So the file goes up first and the
 * form submits a URL like any other string field.
 *
 * The cost is an orphaned blob when an operator uploads and then abandons the
 * dialog. That is the cheap failure — the expensive one is a committed row
 * pointing at a file that was never stored — and a resubmit reuses the URL
 * rather than uploading again.
 *
 * ## Why a `File` arrives as `FormData`
 *
 * A `File` cannot cross a server-action boundary inside a JSON payload. The
 * kind is read off the form and matched against the table below; the file
 * itself is validated by the storage layer, which owns the MIME allow-list and
 * the 5 MB ceiling. A check in the browser is a courtesy — this is the guard.
 */

/**
 * What may be uploaded, who may upload it, and where it lands.
 *
 * `scope` is the authorisation, and it is the whole security model of this
 * action: `holding` is the administration console (OWNER or ADMIN of any
 * firm), `self` is a person acting on their own account and ignores any owner
 * id in the request — the session decides.
 */
const KINDS = {
  "user-avatar": { scope: "holding", folder: "identity/users" },
  "user-signature": { scope: "holding", folder: "identity/signatures" },
  "firm-logo": { scope: "holding", folder: "identity/firms" },
  "firm-letterhead": { scope: "holding", folder: "identity/letterheads" },
  "firm-stamp": { scope: "holding", folder: "identity/stamps" },
  "own-avatar": { scope: "self", folder: "identity/users" },
  "own-signature": { scope: "self", folder: "identity/signatures" },
} as const

export type AssetKind = keyof typeof KINDS

export async function uploadAsset(
  formData: FormData
): Promise<ActionResult<{ url: string }>> {
  try {
    const kind = formData.get("kind")
    if (typeof kind !== "string" || !(kind in KINDS)) {
      return { ok: false, message: "Type de fichier inconnu." }
    }

    const rule = KINDS[kind as AssetKind]

    // Authorise before the file is so much as looked at.
    let owner: string
    if (rule.scope === "self") {
      const session = await getSession()
      const userId = session?.user?.id
      if (!userId) throw new UnauthorizedError()
      // Deliberately the session's own id: a `ownerId` in the body would let
      // one person write into another's folder.
      owner = userId
    } else {
      await requireHoldingAccess()
      const supplied = formData.get("ownerId")
      // A create dialog has no id yet. The folder is a filing convention, not
      // an access boundary — the scope check above is — so "nouveau" is a
      // truthful label rather than a hole.
      owner = typeof supplied === "string" && supplied ? supplied : "nouveau"
    }

    const file = formData.get("file")
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, message: "Aucun fichier reçu." }
    }

    const uploaded = await uploadImage(file, `${rule.folder}/${owner}`)
    return { ok: true, data: { url: uploaded.url } }
  } catch (error) {
    if (error instanceof StorageError) {
      return { ok: false, message: error.message }
    }
    if (isAccessError(error)) {
      return { ok: false, message: error.message, status: error.status }
    }
    // Never the bytes and never the owner: an upload failure must not put a
    // face or a signature into a log line.
    console.error("Asset upload failed")
    return { ok: false, message: "Le téléversement a échoué." }
  }
}
