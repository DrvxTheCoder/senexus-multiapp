import "server-only"

/**
 * File storage on the self-hosted Zipline instance.
 *
 * Ported from the legacy `src/lib/zipline.ts`, including two workarounds that
 * exist for real deployment reasons and must not be "cleaned up":
 *
 * - **Folders are a fiction.** Zipline has no directories, so a path is baked
 *   into the filename and the application derives folders by splitting the
 *   stored key. `employees/{matricule}/{subfolder}/{file}` is the convention.
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
  body.append("file", file, storageKey)

  const headers: Record<string, string> = {
    Authorization: token,
    "x-zipline-filename": storageKey,
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

export async function deleteFile(fileUrl: string): Promise<void> {
  const { url, token } = config()
  const id = fileUrl.split("/").pop()
  if (!id) return

  const response = await fetch(`${url}/api/user/files`, {
    method: "DELETE",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
    cache: "no-store",
  })

  if (!response.ok) {
    throw new StorageError(`Suppression refusée par le stockage (${response.status}).`)
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
