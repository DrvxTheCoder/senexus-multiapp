"use client"

import { toast as sonner } from "sonner"

/**
 * The application's toast vocabulary.
 *
 * Call sites import this, never `sonner` directly. Two reasons: the copy stays
 * French and consistent (an action that fails says one sentence, in the same
 * register as `ActionError`), and swapping the underlying library later touches
 * one file rather than thirty.
 *
 * The convention is deliberately narrow:
 *
 *   - `success` — a mutation committed. Past tense, one clause.
 *   - `error`   — a mutation was refused. The message is whatever the server
 *                 returned; it is already user-safe by construction, because
 *                 `defineAction` never leaks a stack or a Prisma message.
 *   - `loading` — an operation long enough that a disabled button is not
 *                 enough on its own: an upload, an import, a bulk renewal.
 *                 Returns the id so the caller can resolve it in place.
 *
 * Notably absent: a generic `info`. A toast that tells the user nothing
 * actionable is noise, and the brief asks for an interface that feels fast.
 */

type Options = {
  description?: string
  /** Overrides the default 4s. Use for a message worth re-reading. */
  duration?: number
  /** Resolve an existing `loading` toast in place instead of stacking. */
  id?: string | number
  action?: { label: string; onClick: () => void }
}

export const notify = {
  success(message: string, options: Options = {}) {
    return sonner.success(message, options)
  },

  error(message: string, options: Options = {}) {
    // Failures earn a beat longer: they usually say something the user has to
    // act on ("Un client porte déjà ce nom.") rather than just confirm.
    return sonner.error(message, { duration: 5500, ...options })
  },

  warning(message: string, options: Options = {}) {
    return sonner.warning(message, { duration: 5000, ...options })
  },

  /** Indeterminate work. Resolve it by passing the returned id back in. */
  loading(message: string, options: Options = {}) {
    return sonner.loading(message, options)
  },

  /**
   * Dismisses one toast — or, called with no id, **every** toast on screen.
   * Passing a possibly-undefined variable therefore clears the whole stack by
   * accident; guard the call rather than relying on the argument.
   */
  dismiss(id?: string | number) {
    return sonner.dismiss(id)
  },
}

/** The default success line, for a mutation with nothing more specific to say. */
export const SAVED = "Modifications enregistrées."
