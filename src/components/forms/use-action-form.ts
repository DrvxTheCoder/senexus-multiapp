"use client"

import * as React from "react"
import type { FieldValues, UseFormReturn, Path } from "react-hook-form"

import type { ActionResult } from "@/lib/forms/action-result"

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
 */
export function useActionForm<TValues extends FieldValues, TOut>(
  form: UseFormReturn<TValues>,
  action: (input: TValues) => Promise<ActionResult<TOut>>,
  options: {
    /** Shown after a successful submit. */
    success?: string
    onSuccess?: (data: TOut) => void
  } = {}
) {
  const [pending, startTransition] = React.useTransition()
  const [state, setState] = React.useState<{
    message: string
    tone: "error" | "success"
  } | null>(null)

  const submit = form.handleSubmit((values) => {
    setState(null)
    startTransition(async () => {
      const result = await action(values)

      if (result.ok) {
        if (options.success) {
          setState({ message: options.success, tone: "success" })
        }
        options.onSuccess?.(result.data)
        return
      }

      for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
        const first = messages[0]
        if (!first) continue
        form.setError(field as Path<TValues>, { type: "server", message: first })
      }

      setState({ message: result.message, tone: "error" })
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
