import "server-only"

import { Prisma } from "@prisma/client"
import { z } from "zod"

import { ActionError } from "@/server/actions/define-action"
import { IssuanceRefusedError } from "@/server/ipm/voucher-writes"
import type { ApiError } from "@/server/portal/contract"
import { StorageError } from "@/server/storage/zipline"

/**
 * HTTP plumbing for `/api/portail/*`.
 *
 * Three rules every handler gets by going through `portalRoute`, so none of
 * them depends on a handler remembering:
 *
 *   1. **every response is JSON**, errors included, as
 *      `{ error: { code, message, details? } }` with a French message the
 *      portal can show the participant as is;
 *   2. **every response carries the CORS headers**, errors included — without
 *      them the browser hides the body and the portal sees only "network
 *      error", which is the least useful thing it could show;
 *   3. **nothing unexpected leaks**: an unknown failure is logged without the
 *      request body and answered with a generic sentence.
 */

/** Thrown by portal code to answer with a given status and message. */
export class PortalError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: ApiError["error"]["details"]
  readonly headers?: Record<string, string>

  constructor(
    status: number,
    code: string,
    message: string,
    details?: ApiError["error"]["details"],
    headers?: Record<string, string>
  ) {
    super(message)
    this.name = "PortalError"
    this.status = status
    this.code = code
    this.details = details
    this.headers = headers
  }
}

/**
 * Exactly one origin may call this API: the portal's. Unset, no origin is
 * allowed, which keeps a misconfigured deployment closed rather than open.
 */
function corsHeaders(): Record<string, string> {
  const origin = process.env.PORTAL_ORIGIN?.replace(/\/$/, "")
  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  }
}

export function json(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return Response.json(body, {
    status,
    headers: {
      ...corsHeaders(),
      // Health data, per participant. Never a shared cache.
      "Cache-Control": "private, no-store",
      ...extraHeaders,
    },
  })
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: ApiError["error"]["details"],
  headers: Record<string, string> = {}
): Response {
  const body: ApiError = { error: { code, message, ...(details ? { details } : {}) } }
  return json(body, status, headers)
}

/** The preflight. Every route exports this as `OPTIONS`. */
export function preflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() })
}

function zodFields(error: z.ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_"
    ;(fields[key] ??= []).push(issue.message)
  }
  return fields
}

export function toErrorResponse(error: unknown): Response {
  if (error instanceof PortalError) {
    return errorResponse(error.status, error.code, error.message, error.details, error.headers)
  }
  if (error instanceof IssuanceRefusedError) {
    return errorResponse(422, "ISSUANCE_REFUSED", error.message, {
      refusals: error.refusals.map((refusal) => refusal.message),
    })
  }
  if (error instanceof z.ZodError) {
    return errorResponse(422, "INVALID_INPUT", "Certains champs sont invalides.", {
      fields: zodFields(error),
    })
  }
  if (error instanceof StorageError) {
    return errorResponse(502, "STORAGE_FAILED", error.message)
  }
  // An ActionError is a refusal written for a person, from the shared write
  // path: its message is already the sentence to show.
  if (error instanceof ActionError) {
    return errorResponse(409, "CONFLICT", error.message)
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  ) {
    return errorResponse(409, "RETRY", "Opération concurrente. Réessayez.")
  }

  console.error("Portal API failure", error instanceof Error ? error.name : typeof error)
  return errorResponse(500, "INTERNAL", "Une erreur inattendue est survenue. Réessayez.")
}

/** Wraps a handler so it always answers JSON with CORS, whatever it throws. */
export function portalRoute<TContext>(
  handler: (request: Request, context: TContext) => Promise<Response>
): (request: Request, context: TContext) => Promise<Response> {
  return async (request, context) => {
    try {
      return await handler(request, context)
    } catch (error) {
      return toErrorResponse(error)
    }
  }
}

/** Reads a JSON body, answering 400 rather than throwing a SyntaxError. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new PortalError(400, "BAD_REQUEST", "Requête illisible.")
  }
}
