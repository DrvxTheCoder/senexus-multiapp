import { db } from "@/lib/db"
import { requireFirmAccess } from "@/server/auth/require-firm-access"
import { statusForError } from "@/server/errors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * §3.7 — authenticated file access.
 *
 * Uploaded files live on a Zipline instance whose URLs are public and
 * unguessable-but-not-secret. The stored URL stays in the database exactly as
 * it is; what changes is that nothing ever renders it. Bytes are fetched
 * server-side and streamed back through this route, which:
 *
 *   1. requires a session and a membership of this firm;
 *   2. verifies the document belongs to *this* firm before reading anything;
 *   3. re-applies the caller's client scope, so a responsable cannot pull a
 *      file belonging to an employee outside their portfolio;
 *   4. sets Content-Disposition and a private cache header.
 *
 * A document id from another tenant is a 404, not a 403: the answer must not
 * confirm that the id exists.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ firmSlug: string; documentId: string }> }
) {
  const { firmSlug, documentId } = await params

  // `?download=1` is what makes the Télécharger button save rather than
  // navigate. Everything else keeps `inline`, so the preview dialog and a new
  // tab both render the file instead of prompting.
  const asAttachment =
    new URL(request.url).searchParams.get("download") === "1"

  try {
    const ctx = await requireFirmAccess(firmSlug)

    const document = await db.employeeDocument.findFirst({
      where: {
        id: documentId,
        firmId: ctx.firmId,
        ...(ctx.assignedClientIds
          ? { employee: { assignedClientId: { in: ctx.assignedClientIds } } }
          : {}),
      },
      select: {
        fileName: true,
        fileUrl: true,
        storageKey: true,
        mimeType: true,
        fileSize: true,
      },
    })

    if (!document) {
      return new Response(null, { status: 404 })
    }

    // Found and authorised, but the stored location is unusable — a wrong host,
    // a malformed URL, or no storage key at all. That is a data problem, not an
    // access problem, so it answers 502 and is logged. A caller who may *not*
    // see the document still got the 404 above, so the distinction leaks
    // nothing.
    const source = resolveSource(document.fileUrl, document.storageKey)
    if (!source) {
      console.warn(
        `Document ${documentId} has no resolvable storage location ` +
          `(fileUrl host not allowed, or storageKey empty).`
      )
      return new Response(null, { status: 502 })
    }

    const upstream = await fetch(source, {
      headers: process.env.ZIPLINE_TOKEN
        ? { Authorization: process.env.ZIPLINE_TOKEN }
        : undefined,
      cache: "no-store",
    })

    if (!upstream.ok || !upstream.body) {
      return new Response(null, { status: 502 })
    }

    const headers = new Headers({
      "Content-Type":
        document.mimeType ?? upstream.headers.get("content-type") ?? "application/octet-stream",
      // `inline` so a PDF opens in the viewer; the filename is still honoured
      // when the user saves it.
      "Content-Disposition": `${asAttachment ? "attachment" : "inline"}; filename="${encodeURIComponent(document.fileName)}"`,
      // Personnel documents must not be cached by an intermediary.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    })

    const length = upstream.headers.get("content-length")
    if (length) headers.set("Content-Length", length)

    return new Response(upstream.body, { status: 200, headers })
  } catch (error) {
    const status = statusForError(error)
    if (status === 500) throw error
    return new Response(null, { status })
  }
}

/**
 * The legacy data holds either an absolute Zipline URL or a storage key. Only
 * http(s) is ever fetched, and only from the configured host when one is set,
 * so a hostile value in the column cannot turn this route into a proxy for
 * arbitrary URLs.
 */
function resolveSource(fileUrl: string | null, storageKey: string): string | null {
  const base = process.env.ZIPLINE_URL?.replace(/\/$/, "")

  if (fileUrl) {
    let parsed: URL
    try {
      parsed = new URL(fileUrl)
    } catch {
      return null
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
    if (base) {
      const allowed = new URL(base)
      if (parsed.host !== allowed.host) return null
    }
    return parsed.toString()
  }

  if (!base || !storageKey) return null
  return `${base}/${storageKey.replace(/^\//, "")}`
}
