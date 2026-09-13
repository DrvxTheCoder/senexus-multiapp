import { requireFirmAccess, requireModule } from "@/server/auth/require-firm-access"
import { buildCardData } from "@/server/cards/card-data"
import {
  PREVIEW_WIDTH,
  PRINT_WIDTH,
  qrFits,
  renderCardPng,
  renderCardPrintTiff,
} from "@/server/cards/render-card"
import {
  issueToken,
  verificationSecret,
} from "@/server/domain/ipm/verification-token"
import { isAccessError, statusForError } from "@/server/errors"
import { cardForMember } from "@/server/queries/ipm/cards"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Card images — authenticated, always.
 *
 * §6 is explicit that the photo, the date of birth and the matricule are
 * served only through an authenticated route, and a card carries all three.
 * So the bytes never sit at a public URL: they are rendered per request,
 * behind a membership check and the module gate.
 *
 * Rendering on demand also removes a whole class of bug. There is no stored
 * file to fall out of step with the data, and no cache to invalidate when an
 * ayant droit is added — what comes back is always the card as it is now.
 *
 * `?format=tiff` returns the CMYK file for the printer, `?preview=1` a
 * half-size PNG for the screen; everything else is a 300 ppi PNG. See
 * render-card.ts for why those are the options, and why "CMYK PNG" is not a
 * thing that can exist.
 */
export async function GET(
  request: Request,
  {
    params,
  }: { params: Promise<{ firmSlug: string; memberId: string; face: string }> }
) {
  const { firmSlug, memberId, face } = await params

  if (face !== "recto" && face !== "verso") {
    return new Response("Face inconnue.", { status: 404 })
  }

  try {
    const ctx = await requireFirmAccess(firmSlug)
    requireModule(ctx, "ipm")

    const card = await cardForMember(ctx, memberId)
    // A member id from another firm does not resolve, and the answer is the
    // same 404 as an id that does not exist — so the response cannot be used
    // to discover which ids are real.
    if (!card) return new Response("Participant introuvable.", { status: 404 })

    const url = new URL(request.url)
    const wantsPrint = url.searchParams.get("format") === "tiff"
    const preview = url.searchParams.get("preview") === "1"

    /**
     * The QR, on the recto only.
     *
     * The artwork's box is 29 modules at roughly 14 mm, and a signed
     * verification token is far too long to encode in it — ~87 characters
     * needs 37 modules, which does not scan at that size. So the code is
     * printed only when it actually fits, and omitted otherwise: an
     * unscannable QR on an identity document is worse than none, because it
     * looks like it works.
     *
     * Leaving the block empty is safe — the box is drawn by the generated
     * matrix, not by the artwork, so nothing is left hanging.
     */
    let verificationUrl: string | null = null
    if (face === "recto") {
      const candidate = `${url.origin}/v/${issueToken({ kind: "member", id: memberId }, verificationSecret())}`
      if (qrFits(candidate)) {
        verificationUrl = candidate
      } else {
        console.warn(
          "Card QR omitted: verification URL exceeds the artwork's 29-module box",
          { memberId, length: candidate.length }
        )
      }
    }

    // Photos are always embedded, preview included. The preview exists to show
    // what will print, and a preview that silently omits the faces answers the
    // one question the operator is actually asking — "is the right photo on
    // this card?" — with a confident no.
    const data = await buildCardData(card.inputs, { verificationUrl })

    if (wantsPrint) {
      const tiff = await renderCardPrintTiff(face, data, { width: PRINT_WIDTH })
      return new Response(new Uint8Array(tiff), {
        headers: {
          "Content-Type": "image/tiff",
          "Content-Disposition": `attachment; filename="${card.inputs.matricule}_${face}_cmyk.tiff"`,
          "Cache-Control": "private, no-store",
        },
      })
    }

    const png = await renderCardPng(face, data, {
      width: preview ? PREVIEW_WIDTH : PRINT_WIDTH,
    })

    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `inline; filename="${card.inputs.matricule}_${face}.png"`,
        // Health data. Never a shared cache, never a stored copy.
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error) {
    // Never the card's contents: a card error must not put a name, a
    // matricule or a photo data URI into a log or an error report.
    if (!isAccessError(error)) console.error("Card render failed", { memberId })
    return new Response(null, { status: statusForError(error) })
  }
}
