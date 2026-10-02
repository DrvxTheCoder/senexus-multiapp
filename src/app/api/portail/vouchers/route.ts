import { randomBytes } from "node:crypto"

import { Prisma } from "@prisma/client"

import { db } from "@/lib/db"
import { requirePortalAccount } from "@/server/portal/auth"
import { json, PortalError, portalRoute, preflight } from "@/server/portal/http"
import { voucherPayload } from "@/server/portal/snapshot"
import {
  draftLines,
  existingForRequest,
  issuePortalVoucher,
  voucherDraftSchema,
} from "@/server/portal/vouchers"
import { uploadFile } from "@/server/storage/zipline"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp"]
const RECEIPT_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}
const RECEIPT_MAX_BYTES = 5 * 1024 * 1024

/**
 * POST /api/portail/vouchers — multipart: `draft` (JSON) + `receipt` (image).
 *
 * Order matters, and is the same as the photo upload's:
 *
 *   1. authorise, from the token;
 *   2. validate everything that can be validated **before** the upload — the
 *      draft, the amount, the file — so a request that was going to fail does
 *      not leave a file behind;
 *   3. upload the receipt outside any transaction: a slow file host must not
 *      hold a sequence row lock for its whole timeout;
 *   4. issue, in one transaction.
 *
 * If step 4 fails the receipt stays on Zipline, orphaned. That is accepted.
 * The stored name carries a random suffix after the request id because Zipline
 * refuses a name it already holds: without it, a retry after such a failure
 * would be refused forever.
 *
 * **Idempotent on `clientRequestId`.** A request id already seen for this
 * firm returns the bon written the first time, 200, and writes nothing. Two
 * concurrent requests with the same id race to the unique index; the loser
 * reads the winner's bon and answers the same.
 */
export const POST = portalRoute(async (request) => {
  const principal = await requirePortalAccount(request)

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    throw new PortalError(400, "BAD_REQUEST", "Requête illisible (multipart attendu).")
  }

  const rawDraft = form.get("draft")
  let parsed: unknown
  try {
    parsed = JSON.parse(typeof rawDraft === "string" ? rawDraft : "")
  } catch {
    throw new PortalError(422, "INVALID_INPUT", "Le bon est illisible.")
  }
  const draft = voucherDraftSchema.parse(parsed)

  const seen = await existingForRequest(db, principal, draft.clientRequestId)
  if (seen) return json(await voucherPayload(principal.firmId, seen.id), 200)

  // Throws for a draft with no priced line and no total — before the upload.
  draftLines(draft)

  const receipt = form.get("receipt")
  if (!(receipt instanceof File) || receipt.size === 0) {
    throw new PortalError(422, "RECEIPT_REQUIRED", "La photo du reçu est obligatoire.")
  }
  if (!RECEIPT_TYPES.includes(receipt.type)) {
    throw new PortalError(
      422,
      "RECEIPT_TYPE",
      "Le reçu doit être une photo (JPEG, PNG ou WebP)."
    )
  }
  if (receipt.size > RECEIPT_MAX_BYTES) {
    throw new PortalError(422, "RECEIPT_TOO_LARGE", "La photo du reçu dépasse 5 Mo.")
  }

  const uploaded = await uploadFile(receipt, {
    folder: "ipm/receipts",
    // The extension tells Zipline the type; the storage layer strips it from
    // the name it sends, as Zipline appends its own.
    filename: `${draft.clientRequestId}-${randomBytes(3).toString("hex")}.${RECEIPT_EXTENSION[receipt.type]}`,
    maxBytes: RECEIPT_MAX_BYTES,
    allowedTypes: RECEIPT_TYPES,
  })

  let voucherId: string
  try {
    const created = await db.$transaction((tx) =>
      issuePortalVoucher(tx, principal, draft, uploaded.url)
    )
    voucherId = created.id
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const winner = await existingForRequest(db, principal, draft.clientRequestId)
      if (winner) return json(await voucherPayload(principal.firmId, winner.id), 200)
    }
    throw error
  }

  return json(await voucherPayload(principal.firmId, voucherId), 201)
})

export const OPTIONS = preflight
