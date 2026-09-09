"use client"

import * as React from "react"

import { Spinner } from "@/components/spinner"
import { cn } from "@/lib/utils"

/**
 * The field wrapper every form uses.
 *
 * It exists so that a label, its control, its error and its hint are wired to
 * each other **once** rather than in thirty forms: the label points at the
 * control, the error is announced, and `aria-invalid` / `aria-describedby` are
 * derived rather than remembered. Getting that wrong is the most common way a
 * form ends up unusable with a screen reader.
 */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  className,
  children,
}: {
  label: string
  htmlFor: string
  error?: string
  hint?: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  const errorId = error ? `${htmlFor}-error` : undefined
  const hintId = hint ? `${htmlFor}-hint` : undefined

  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[12.5px] text-ink-2">
        {label}
        {required ? (
          <span aria-hidden className="ml-0.5 text-alert">
            *
          </span>
        ) : null}
      </label>

      {children}

      {hint && !error ? (
        <p id={hintId} className="text-[11.5px] text-ink-3">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="text-[11.5px] text-alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** Props to spread onto the control inside a `Field`, so the wiring matches. */
export function fieldProps(name: string, error?: string) {
  return {
    id: name,
    name,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${name}-error` : undefined,
  } as const
}

export const inputClass =
  "h-9 w-full rounded-[7px] border border-line bg-surface px-2.5 text-[13px] outline-none transition-colors focus:border-brand aria-invalid:border-alert"

/**
 * The select trigger and the date-picker button, held to the same geometry as
 * `inputClass` so a form grid stays on one rhythm.
 *
 * The ReUI/shadcn primitives ship their own look — `h-8`, `rounded-lg`,
 * `border-input`, and a `focus-visible:ring-3` halo. That is a second visual
 * language next to the hand-built inputs, and §4.x is explicit that every
 * component reads the sx tokens, so the size, radius, hairline and the single
 * brand focus outline are overridden here rather than per call site. The
 * primitives' *behaviour* — the popup, keyboard model, typeahead — is what we
 * actually installed them for and is left alone.
 */
/**
 * For the few native `<select>`s left outside `SelectControl`. Kept identical
 * to `inputClass` so they still line up.
 */
export const selectClass = inputClass

export const selectTriggerClass = cn(
  inputClass,
  "flex items-center justify-between gap-1.5 text-left font-normal",
  // `h-9` from inputClass loses to the primitive's own `data-[size=default]:h-8`,
  // which is a data-attribute selector and so more specific. Restated here on
  // the same footing so the trigger matches the inputs beside it.
  "data-[size=default]:h-9 data-[size=sm]:h-9",
  // The primitives' focus ring, unset in favour of the global focus law.
  "focus-visible:border-brand focus-visible:ring-0",
  "data-[popup-open]:border-brand",
  "data-placeholder:text-ink-3",
  "disabled:cursor-not-allowed disabled:opacity-50"
)

/**
 * The primary submit button used across dialogs and forms.
 *
 * The pending state is the sign-in button's: the label switches to a verb in
 * the progressive and a spinner follows it. Keeping the spinner *after* the
 * text means the label does not jump sideways when it appears.
 */
export function SubmitButton({
  pending,
  children,
  pendingLabel,
  className,
  disabled,
}: {
  pending: boolean
  children: React.ReactNode
  pendingLabel?: string
  className?: string
  disabled?: boolean
}) {
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={cn(
        "inline-flex h-9 flex-row items-center justify-center gap-2 rounded-[7px] bg-ink px-3 text-[13px] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50",
        className
      )}
    >
      {pending ? (pendingLabel ?? "Enregistrement…") : children}
      {pending ? <Spinner /> : null}
    </button>
  )
}

/**
 * The destructive twin of `SubmitButton`, for the confirm step of an archive or
 * a delete. Same pending grammar; the only difference is the fill.
 */
export function DangerButton({
  pending,
  children,
  pendingLabel,
  className,
  disabled,
  onClick,
}: {
  pending: boolean
  children: React.ReactNode
  pendingLabel?: string
  className?: string
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending || disabled}
      className={cn(
        "inline-flex h-9 flex-row items-center justify-center gap-2 rounded-[7px] bg-alert px-3 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50",
        className
      )}
    >
      {pending ? (pendingLabel ?? "Suppression…") : children}
      {pending ? <Spinner /> : null}
    </button>
  )
}

/** A form-level message, for failures that belong to no single field. */
export function FormMessage({
  tone = "error",
  children,
}: {
  tone?: "error" | "success"
  children: React.ReactNode
}) {
  if (!children) return null
  return (
    <p
      role="alert"
      className={cn(
        "rounded-md px-2.5 py-1.5 text-[12.5px]",
        tone === "error" ? "bg-alert-tint text-alert" : "bg-ok-tint text-ok"
      )}
    >
      {children}
    </p>
  )
}
