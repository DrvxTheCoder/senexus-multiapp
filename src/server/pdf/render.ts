import "server-only"

import type { ReactElement } from "react"
import { renderToBuffer } from "@react-pdf/renderer"

import { registerDocumentFonts } from "@/server/pdf/fonts"

/**
 * Rendu d'un document, et la réponse qui le transporte.
 *
 * Two things live here so that no route has to remember them.
 *
 * **The fonts are registered first, every time.** `registerDocumentFonts` is
 * idempotent and cheap after the first call, but forgetting it in one route
 * does not fail — react-pdf substitutes Helvetica and reflows every box on the
 * form. A document that is subtly wrong is worse than one that does not
 * render, so the registration is not something a route can leave out.
 *
 * **Nothing is cached and nothing is stored.** These documents carry health
 * data and identity data, so they are rendered per request behind the same
 * `requireFirmAccess` every screen uses, and the response says so. It also
 * removes a class of bug the card renderer already documents: there is no file
 * to fall out of step with the row, so what comes back is always the document
 * as it is now.
 */

export async function renderDocument(element: ReactElement): Promise<Buffer> {
  registerDocumentFonts()
  // The cast is react-pdf's own shape: its element types are its primitives,
  // not React DOM's, and the two do not unify at the boundary.
  return renderToBuffer(element as never)
}

/**
 * The response a document travels in.
 *
 * `inline` so a click opens the PDF in the browser's viewer, which is what an
 * operator wants: they are checking a bon before printing it, not filing it.
 * `?download=1` flips it to an attachment for the times they are.
 *
 * The filename is sanitised because it goes into a header: a provider called
 * `Clinique de l'Océan` would otherwise put a non-ASCII byte and an
 * apostrophe into `Content-Disposition`, where they variously truncate the
 * name or break the header.
 */
export function pdfResponse(
  buffer: Buffer,
  filename: string,
  options: { download?: boolean } = {}
): Response {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${
        options.download ? "attachment" : "inline"
      }; filename="${safeFilename(filename)}"`,
      // Health and identity data. Never a shared cache, never a stored copy.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

export function safeFilename(value: string): string {
  return (
    value
      .normalize("NFD")
      // Strip the combining marks left by the decomposition: `é` → `e`.
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "document"
  )
}
