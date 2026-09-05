/**
 * The result every server action returns.
 *
 * Isomorphic on purpose: forms read it on the client, actions build it on the
 * server. Keeping the shape in `lib` rather than `server` is the same split
 * already used for query schemas, and it means a form can render field errors
 * without importing anything that touches the database.
 */
export type FieldErrors = Record<string, string[]>

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | {
      ok: false
      /** One sentence, in French, safe to show the user. */
      message: string
      /** Per-field messages, keyed by the form field name. */
      fieldErrors?: FieldErrors
      /** Set when the failure was an authorisation decision. */
      status?: 401 | 403 | 404
    }

export function isOk<T>(
  result: ActionResult<T>
): result is { ok: true; data: T } {
  return result.ok
}

/** First message for a field, for rendering under an input. */
export function fieldError(
  result: ActionResult<unknown> | null | undefined,
  field: string
): string | undefined {
  if (!result || result.ok) return undefined
  return result.fieldErrors?.[field]?.[0]
}
