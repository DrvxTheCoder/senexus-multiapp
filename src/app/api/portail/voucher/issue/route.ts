import { createHash, randomBytes } from "node:crypto"

import { Prisma } from "@prisma/client"

import { db } from "@/lib/db"
import { requirePortalAccount } from "@/server/portal/auth"
import { json, PortalError, portalRoute, preflight } from "@/server/portal/http"
import {
  existingPharmacyRequest,
  issuePharmacyVoucher,
  pharmacyIssueSchema,
} from "@/server/portal/pharmacy"
import { uploadFile } from "@/server/storage/zipline"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PRESCRIPTION_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"]
const PRESCRIPTION_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
}
const PRESCRIPTION_MAX_BYTES = 5 * 1024 * 1024

/**
 * POST /api/portail/voucher/issue — multipart: `request` (JSON) +
 * `prescription` (the ordonnance, mandatory) → `{ voucherId, number, qrToken,
 * status: "AWAITING_AMOUNT", expiresAt }`.
 *
 * Same order as the receipt upload (`/api/portail/vouchers`): authorise,
 * validate everything that can be validated before the upload, upload outside
 * any transaction, then issue in one. A failure after the upload orphans the
 * file on Zipline, which is accepted.
 *
 * The stored name is 128 random bits and nothing else — no request id, no
 * matricule — because a Zipline URL is reachable by whoever holds it, and the
 * only defence for a medical document stored there is a name nobody can guess.
 * The URL itself never leaves the server (see `server/portal/prescription.ts`).
 *
 * Idempotent on `clientRequestId` when one is sent: 200 with the bon already
 * written, before anything is uploaded.
 */
export const POST = portalRoute(async (request) => {
  const principal = await requirePortalAccount(request)

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    throw new PortalError(400, "BAD_REQUEST", "Requête illisible (multipart attendu).")
  }

  let parsed: unknown
  try {
    const raw = form.get("request")
    parsed = JSON.parse(typeof raw === "string" ? raw : "")
  } catch {
    throw new PortalError(422, "INVALID_INPUT", "La demande est illisible.")
  }
  const input = pharmacyIssueSchema.parse(parsed)

  const seen = await existingPharmacyRequest(db, principal, input.clientRequestId)
  if (seen) return json(seen, 200)

  const part = form.get("prescription")
  const prescription = part instanceof File && part.size > 0 ? part : null
  if (!prescription) {
    throw new PortalError(
      422,
      "PRESCRIPTION_REQUIRED",
      "Joignez l'ordonnance : elle remplace le reçu pour un bon de pharmacie."
    )
  }
  if (!PRESCRIPTION_TYPES.includes(prescription.type)) {
    throw new PortalError(
      422,
      "PRESCRIPTION_TYPE",
      "L'ordonnance doit être une photo (JPEG, PNG, WebP) ou un PDF."
    )
  }
  if (prescription.size > PRESCRIPTION_MAX_BYTES) {
    throw new PortalError(422, "PRESCRIPTION_TOO_LARGE", "L'ordonnance dépasse 5 Mo.")
  }

  const bytes = Buffer.from(await prescription.arrayBuffer())
  const hash = createHash("sha256").update(bytes).digest("hex")

  const uploaded = await uploadFile(
    new File([bytes], prescription.name || "ordonnance", { type: prescription.type }),
    {
      folder: "ipm/prescriptions",
      filename: `${randomBytes(16).toString("hex")}.${PRESCRIPTION_EXTENSION[prescription.type]}`,
      maxBytes: PRESCRIPTION_MAX_BYTES,
      allowedTypes: PRESCRIPTION_TYPES,
    }
  )

  try {
    const created = await db.$transaction((tx) =>
      issuePharmacyVoucher(tx, principal, input, { url: uploaded.url, hash })
    )
    return json(created, 201)
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await existingPharmacyRequest(db, principal, input.clientRequestId)
      if (winner) return json(winner, 200)
    }
    throw error
  }
})

export const OPTIONS = preflight
