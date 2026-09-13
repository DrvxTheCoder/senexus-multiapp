import "server-only"

/**
 * File storage on the self-hosted Zipline instance.
 *
 * Ported from the legacy `src/lib/zipline.ts`, including workarounds that
 * exist for real deployment reasons and must not be "cleaned up":
 *
 * - **Folders are a fiction.** Zipline has no directories, so the application
 *   derives folders by splitting the stored key. The convention is
 *   `{scope}/{identifier}/{file}`, and `storageKey` keeps that shape.
 * - **The upload header cannot carry that path.** This Zipline build rejects
 *   any `x-zipline-filename` containing a slash with
 *   `bad options: [x-zipline-filename]: Invalid filename` — a 400 that reached
 *   the user as "Le stockage a refusé le fichier (400)". So the path is
 *   flattened for the header while `storageKey` keeps the real one.
 * - **Zipline appends the extension itself.** A name sent as `photo.png` is
 *   stored as `photo.png.png`, so the header carries the stem only.
 * - **URLs come back as `http://` even on an HTTPS host**, which a browser
 *   blocks as mixed content. The scheme is rewritten on the way out.
 *
 * Uploads happen server-side only: `ZIPLINE_TOKEN` is a write credential and
 * never reaches the browser.
 */

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024

export const IMAGE_MIME = ["image/jpeg", "image/jpg", "image/png", "image/webp"]
export const DOCUMENT_MIME = ["application/pdf", "image/jpeg", "image/jpg", "image/png"]

export class StorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "StorageError"
  }
}

function config() {
  const url = process.env.ZIPLINE_URL?.replace(/\/$/, "")
  const token = process.env.ZIPLINE_TOKEN
  if (!url || !token) {
    throw new StorageError(
      "Le stockage de fichiers n'est pas configuré (ZIPLINE_URL / ZIPLINE_TOKEN)."
    )
  }
  return { url, token }
}

/** Zipline returns http:// even behind TLS; a browser refuses to load that. */
export function ensureHttps(url: string): string {
  return url.startsWith("http://") ? url.replace(/^http:\/\//, "https://") : url
}

/** Folder segments are sanitised the same way the legacy uploader did. */
export function sanitiseFolder(folder: string): string {
  return folder.replace(/[^a-zA-Z0-9-_/]/g, "_").replace(/^\/+|\/+$/g, "")
}

/**
 * A storage key turned into a name Zipline will actually accept.
 *
 * Two rules, both learned from the server rather than the documentation:
 *
 *   1. **no slashes** — this build answers any path-shaped name with
 *      `400 bad options: [x-zipline-filename]: Invalid filename`, so the
 *      separators become underscores and the key keeps the real path;
 *   2. **no extension** — Zipline appends one from the content type, so
 *      `photo.png` is stored as `photo.png.png`. Only the stem is sent.
 *
 * The result stays human-readable in Zipline's own listing, which is the
 * point of naming uploads at all: `ipm_participants_01704_photo`.
 */
export function uploadName(storageKey: string): string {
  const flattened = storageKey.replace(/[/\\]+/g, "_")
  const stem = flattened.replace(/\.[A-Za-z0-9]{1,8}$/, "")
  const safe = stem.replace(/[^a-zA-Z0-9-_.]/g, "_").replace(/^_+|_+$/g, "")
  // Zipline generates its own name when given an empty one, which is a worse
  // outcome than a generic but predictable stem.
  return safe || "file"
}

export type UploadOptions = {
  /** Virtual folder, baked into the filename. */
  folder?: string
  filename?: string
  maxBytes?: number
  allowedTypes?: string[]
  /** 0-100; Zipline re-encodes images at this quality. */
  compressionPercent?: number
}

export type UploadedFile = {
  url: string
  storageKey: string
  size: number
  mimeType: string
  fileName: string
}

export async function uploadFile(
  file: File,
  options: UploadOptions = {}
): Promise<UploadedFile> {
  const { url, token } = config()
  const maxBytes = options.maxBytes ?? MAX_IMAGE_BYTES
  const allowed = options.allowedTypes ?? IMAGE_MIME

  if (!allowed.includes(file.type)) {
    throw new StorageError(
      `Type de fichier non autorisé (${file.type || "inconnu"}).`
    )
  }

  if (file.size > maxBytes) {
    throw new StorageError(
      `Fichier trop volumineux : ${(file.size / 1024 / 1024).toFixed(1)} Mo, maximum ${(
        maxBytes /
        1024 /
        1024
      ).toFixed(0)} Mo.`
    )
  }

  const folder = options.folder ? sanitiseFolder(options.folder) : ""
  const baseName = options.filename ?? file.name
  const storageKey = folder ? `${folder}/${baseName}` : baseName

  const body = new FormData()
  body.append("file", file, baseName)

  const headers: Record<string, string> = {
    Authorization: token,
    // Flattened and stripped of its extension — see the two Zipline
    // constraints in the module comment. `storageKey` keeps the real path.
    "x-zipline-filename": uploadName(storageKey),
  }
  if (options.compressionPercent !== undefined) {
    headers["x-zipline-image-compression-percent"] = String(
      options.compressionPercent
    )
  }

  const response = await fetch(`${url}/api/upload`, {
    method: "POST",
    headers,
    body,
    cache: "no-store",
  })

  if (!response.ok) {
    // Zipline explains itself in the body ("Invalid filename", "folder not
    // found"); a bare status code sent the last such failure on a long detour,
    // so the reason is read out and logged. It is not shown to the user, who
    // can do nothing with it, but it is the difference between a five-minute
    // diagnosis and an afternoon.
    const reason = await response
      .text()
      .then((text) => {
        try {
          return (JSON.parse(text) as { error?: string }).error ?? text
        } catch {
          return text
        }
      })
      .catch(() => "")

    console.error("Zipline refused an upload", {
      status: response.status,
      reason: reason.slice(0, 200),
    })

    throw new StorageError(
      `Le stockage a refusé le fichier (${response.status}).`
    )
  }

  const payload = (await response.json()) as {
    files?: (string | { url?: string })[]
  }

  const first = payload.files?.[0]
  const fileUrl = typeof first === "string" ? first : first?.url

  if (!fileUrl) {
    throw new StorageError("Le stockage n'a pas renvoyé d'URL.")
  }

  return {
    url: ensureHttps(fileUrl),
    storageKey,
    size: file.size,
    mimeType: file.type,
    fileName: baseName,
  }
}

export const uploadImage = (file: File, folder?: string) =>
  uploadFile(file, {
    folder,
    maxBytes: MAX_IMAGE_BYTES,
    allowedTypes: IMAGE_MIME,
    compressionPercent: 85,
  })

export const uploadDocument = (file: File, folder: string, filename?: string) =>
  uploadFile(file, {
    folder,
    filename,
    maxBytes: MAX_DOCUMENT_BYTES,
    allowedTypes: DOCUMENT_MIME,
    compressionPercent: 80,
  })

/**
 * Removes a file, addressed by the URL that was stored for it.
 *
 * Two steps, because the delete endpoint takes Zipline's internal id while
 * everything in this application stores a URL:
 *
 *   1. `GET /api/user/files/{name}` resolves the name to a record;
 *   2. `DELETE /api/user/files/{id}` removes it.
 *
 * The previous implementation posted the *filename* to
 * `DELETE /api/user/files` — a route this Zipline build does not have at all,
 * so it answered 404 and every delete silently failed. Nothing noticed,
 * because both call sites deliberately swallow delete failures; the effect was
 * that replaced photos and deleted documents leaked their blobs forever.
 *
 * The lookup response embeds the whole owning user, password hash included, so
 * only `id` is read out of it and the body is never logged.
 */
export async function deleteFile(fileUrl: string): Promise<void> {
  const { url, token } = config()
  const name = fileUrl.split("/").pop()?.split("?")[0]
  if (!name) return

  const lookup = await fetch(`${url}/api/user/files/${encodeURIComponent(name)}`, {
    headers: { Authorization: token },
    cache: "no-store",
  })

  // Already gone is the outcome the caller wanted.
  if (lookup.status === 404) return
  if (!lookup.ok) {
    throw new StorageError(`Suppression refusée par le stockage (${lookup.status}).`)
  }

  const id = ((await lookup.json()) as { id?: string }).id
  if (!id) throw new StorageError("Le stockage n'a pas identifié le fichier.")

  const response = await fetch(`${url}/api/user/files/${id}`, {
    method: "DELETE",
    headers: { Authorization: token, "Content-Type": "application/json" },
    // This build rejects an empty body when the content type is JSON.
    body: "{}",
    cache: "no-store",
  })

  if (!response.ok && response.status !== 404) {
    throw new StorageError(
      `Suppression refusée par le stockage (${response.status}).`
    )
  }
}

/**
 * Delete that never throws.
 *
 * Two uses, both about not letting storage bookkeeping break the user's
 * operation: cleaning up an orphan after a database insert fails, and removing
 * the blob when a document row is deleted — which the legacy app never did, so
 * every deleted document leaked its file.
 */
export async function safeDeleteFile(fileUrl: string | null): Promise<void> {
  if (!fileUrl) return
  try {
    await deleteFile(fileUrl)
  } catch (error) {
    console.warn("Zipline delete failed; file may be orphaned", fileUrl, error)
  }
}
