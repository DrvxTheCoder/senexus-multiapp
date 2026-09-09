"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import type { ActionResult } from "@/lib/forms/action-result"
import { notify, SAVED } from "@/lib/toast"

/**
 * `useActionForm` for the mutations that have no form.
 *
 * Archiving a client, verifying a document, deleting a piece, running a bulk
 * renewal — none of those carry fields, so none of them need react-hook-form.
 * What they *do* need is the same four things, which were previously written by
 * hand at every call site and drifted:
 *
 *   1. a pending flag, inside a transition, so the button can disable itself;
 *   2. `router.refresh()` after the write commits, not before;
 *   3. a toast on both outcomes;
 *   4. the failure kept in local state too, so a dialog can still render it
 *      inline next to the button that caused it.
 *
 * The result contract does the work: `defineAction` never throws for a user
 * error, so there is nothing to catch here and no way for a Prisma message to
 * reach a toast. A genuine bug still rejects the promise, and that is caught
 * and reported as one sentence rather than an unhandled rejection.
 */
export function useAction<TInput, TOut>(
  action: (input: TInput) => Promise<ActionResult<TOut>>,
  options: {
    /**
     * Toast on success. `false` stays silent — for the rare chained step.
     *
     * The callback receives the input as well as the result, because several
     * messages depend on what was *asked for* rather than what came back: one
     * action both attaches and detaches a document, and only the input says
     * which just happened.
     */
    success?: string | ((data: TOut, input: TInput) => string) | false
    /**
     * Shown while the action runs, and replaced in place by the success or
     * error toast. Only worth setting for work the user waits on — an upload,
     * an import, a bulk write. A fast row action should not flash a spinner.
     */
    loading?: string
    onSuccess?: (data: TOut) => void
    onError?: (result: Extract<ActionResult<TOut>, { ok: false }>) => void
    /** `router.refresh()` once the write commits. Defaults to true. */
    refresh?: boolean
  } = {}
) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)

  // A plain function, deliberately. `options` is a fresh object literal on
  // every render, so a `useCallback` over it would be rebuilt anyway, and
  // holding it in a ref would mean writing that ref during render — which the
  // React Compiler rejects, rightly. The compiler memoises what is worth it.
  function run(input: TInput) {
    setError(null)

    const toastId = options.loading ? notify.loading(options.loading) : undefined

    startTransition(async () => {
      let result: ActionResult<TOut>
      try {
        result = await action(input)
      } catch {
        // Not a refused mutation — a crash, a dropped connection, a failed
        // server-action round trip. Say so plainly; the server already logged
        // whatever it was.
        const message = "Une erreur inattendue est survenue. Réessayez."
        setError(message)
        notify.error(message, { id: toastId })
        return
      }

      if (!result.ok) {
        setError(result.message)
        notify.error(result.message, { id: toastId })
        options.onError?.(result)
        return
      }

      if (options.success !== false) {
        const message =
          typeof options.success === "function"
            ? options.success(result.data, input)
            : (options.success ?? SAVED)
        notify.success(message, { id: toastId })
      } else if (toastId !== undefined) {
        notify.dismiss(toastId)
      }

      options.onSuccess?.(result.data)
      if (options.refresh !== false) router.refresh()
    })
  }

  return {
    run,
    pending,
    error,
    reset: () => setError(null),
  }
}
