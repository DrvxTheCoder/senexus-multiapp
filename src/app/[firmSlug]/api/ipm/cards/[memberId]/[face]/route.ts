import { requireFirmAccess, requireModule } from "@/server/auth/require-firm-access"
import { renderCardPng, renderCardPrintTiff } from "@/server/cards/render-card"
import { PRINT_PPI, SCREEN_PPI } from "@/server/domain/ipm/card"
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
 * `?format=tiff` returns the CMYK file for the printer; everything else
 * returns sRGB PNG. See render-card.ts for why those are the two, and why
 * "CMYK PNG" is not a thing that can exist.
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

    // The QR is only meaningful on the recto, and only when it can carry an
    // absolute URL — a relative one would not resolve from a phone camera.
    const verificationUrl =
      face === "recto"
        ? `${url.origin}/v/${issueToken({ kind: "member", id: memberId }, verificationSecret())}`
        : undefined

    if (wantsPrint) {
      const tiff = await renderCardPrintTiff(face, card.inputs, {
        ppi: PRINT_PPI,
        bleed: true,
        verificationUrl,
      })
      return new Response(new Uint8Array(tiff), {
        headers: {
          "Content-Type": "image/tiff",
          "Content-Disposition": `attachment; filename="${card.inputs.matricule}_${face}_cmyk.tiff"`,
          "Cache-Control": "private, no-store",
        },
      })
    }

    const png = await renderCardPng(face, card.inputs, {
      ppi: preview ? SCREEN_PPI : PRINT_PPI,
      verificationUrl,
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
    if (!isAccessError(error)) console.error("Card render failed", error)
    return new Response(null, { status: statusForError(error) })
  }
}
