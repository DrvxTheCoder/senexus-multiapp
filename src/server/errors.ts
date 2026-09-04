/**
 * Typed access errors.
 *
 * `requireFirmAccess` throws these; route handlers and server actions map them
 * to a status with `statusForError`, and pages let them bubble into the
 * matching Next.js interrupt (unauthorized / forbidden / notFound).
 *
 * There is exactly one implementation of each. Do not hand-roll a 403.
 */

export class AccessError extends Error {
  readonly status: 401 | 403 | 404

  constructor(status: 401 | 403 | 404, message: string) {
    super(message)
    this.name = new.target.name
    this.status = status
  }
}

/** No usable session. The caller has not signed in. */
export class UnauthorizedError extends AccessError {
  constructor(message = "Authentification requise.") {
    super(401, message)
  }
}

/** Signed in, but not a member of this firm, or below the required role. */
export class ForbiddenError extends AccessError {
  constructor(message = "Accès refusé.") {
    super(403, message)
  }
}

/**
 * The firm slug does not exist, or the requested module is not enabled for it.
 * Deliberately indistinguishable from "exists but you cannot see it" for
 * non-members, so slugs cannot be enumerated.
 */
export class NotFoundError extends AccessError {
  constructor(message = "Ressource introuvable.") {
    super(404, message)
  }
}

export function isAccessError(error: unknown): error is AccessError {
  return error instanceof AccessError
}

export function statusForError(error: unknown): 401 | 403 | 404 | 500 {
  return isAccessError(error) ? error.status : 500
}
