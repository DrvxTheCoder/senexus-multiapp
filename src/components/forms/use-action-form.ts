"use client"

import * as React from "react"
import type { FieldValues, UseFormReturn, Path } from "react-hook-form"

import type { ActionResult } from "@/lib/forms/action-result"
import { notify, SAVED } from "@/lib/toast"

/**
 * Joins a react-hook-form to a server action.
 *
 * The point is that **server-side field errors land on the right inputs**.
 * Client validation catches shape; only the server can catch "that email is
 * already taken" or "your current password is wrong", and those must appear
 * under the field rather than as a detached banner. `defineAction` returns
 * `fieldErrors` keyed by field name precisely so this hook can replay them into
 * the form.
 *
 * Anything the server could not attribute to a field becomes the form-level
 * message.
 *
 * Toasts are emitted here rather than at each call site, so every form in the
 * application reports the same way for free. The division of labour matters:
 * a **field** error stays on its field and raises no toast — the input is
 * already marked and the eye is already there — while a form-level failure
 * gets both the inline banner and a toast, because the dialog that caused it
 * may well have closed by the time the server answered.
 */
export function useActionForm<TValues extends FieldValues, TOut>(
  form: UseFormReturn<TValues>,
  action: (input: TValues) => Promise<ActionResult<TOut>>,
  options: {
    /** Shown after a successful submit, inline and as a toast. */
    success?: string
    /**
     * Shown while the submit is in flight, replaced in place by the outcome.
     * Only for work the user waits on — an upload, an import. Leave unset for
     * an ordinary dialog save, where the button spinner already says it.
     */
    loading?: string
    /** `false` silences the toasts; the inline message is unaffected. */
    toast?: boolean
    onSuccess?: (data: TOut) => void
  } = {}
) {
  const [pending, startTransition] = React.useTransition()
  const [state, setState] = React.useState<{
    message: string
    tone: "error" | "success"
  } | null>(null)

  const speaks = options.toast !== false

  const submit = form.handleSubmit((values) => {
    setState(null)
    const toastId =
      speaks && options.loading ? notify.loading(options.loading) : undefined

    startTransition(async () => {
      let result: ActionResult<TOut>
      try {
        result = await action(values)
      } catch {
        // A crash or a dropped round trip, not a refused mutation. The server
        // has already logged whatever it was.
        const message = "Une erreur inattendue est survenue. Réessayez."
        setState({ message, tone: "error" })
        if (speaks) notify.error(message, { id: toastId })
        return
      }

      if (result.ok) {
        if (options.success) {
          setState({ message: options.success, tone: "success" })
        }
        if (speaks) notify.success(options.success ?? SAVED, { id: toastId })
        options.onSuccess?.(result.data)
        return
      }

      let attributed = false
      for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
        const first = messages[0]
        if (!first) continue
        form.setError(field as Path<TValues>, { type: "server", message: first })
        attributed = true
      }

      setState({ message: result.message, tone: "error" })

      // A field error is already visible on the field it belongs to; toasting
      // it as well would say the same thing twice, in two places. The id guard
      // matters: `dismiss()` with no argument clears *every* toast on screen,
      // including ones this form never raised.
      if (speaks) {
        if (!attributed) notify.error(result.message, { id: toastId })
        else if (toastId !== undefined) notify.dismiss(toastId)
      }
    })
  })

  return {
    submit,
    pending,
    message: state?.message ?? null,
    tone: state?.tone ?? ("error" as const),
    reset: () => setState(null),
  }
}
