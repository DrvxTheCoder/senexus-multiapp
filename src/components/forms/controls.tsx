"use client"

import * as React from "react"
import { Controller } from "react-hook-form"
import type { FieldValues, Path, UseFormReturn } from "react-hook-form"

import { HugeiconsIcon } from "@hugeicons/react"
import { MultiplicationSignIcon } from "@hugeicons/core-free-icons"

import {
  Field,
  fieldProps,
  inputClass,
  selectTriggerClass,
} from "@/components/forms/form-field"
import { DatePicker } from "@/components/forms/date-picker"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

/**
 * Form controls bound to react-hook-form.
 *
 * The employee wizard alone has twenty fields; writing `Field` + `register` +
 * `fieldProps` + the error lookup by hand twenty times is how a form ends up
 * with one input whose label points nowhere. These bind the four together once.
 *
 * Deliberately thin: they render the same `<input>`/`<select>` the manual form
 * would, with the same classes, so nothing here is a new component to learn.
 */

type Base<T extends FieldValues> = {
  form: UseFormReturn<T>
  name: Path<T>
  label: string
  required?: boolean
  hint?: string
  className?: string
  disabled?: boolean
}

function errorOf<T extends FieldValues>(
  form: UseFormReturn<T>,
  name: Path<T>
): string | undefined {
  const errors = form.formState.errors as Record<string, { message?: string }>
  return errors[name]?.message
}

export function TextControl<T extends FieldValues>({
  form,
  name,
  label,
  required,
  hint,
  className,
  disabled,
  type = "text",
  placeholder,
  autoFocus,
  mono,
}: Base<T> & {
  type?: "text" | "email" | "tel" | "url" | "date" | "number"
  placeholder?: string
  autoFocus?: boolean
  mono?: boolean
}) {
  const error = errorOf(form, name)
  return (
    <Field
      label={label}
      htmlFor={name}
      required={required}
      hint={hint}
      error={error}
      className={className}
    >
      <input
        {...fieldProps(name, error)}
        {...form.register(name)}
        type={type}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        className={cn(inputClass, mono && "mono")}
      />
    </Field>
  )
}

/**
 * The date **widget**, controlled by a plain value and setter.
 *
 * Not every form in the application is a react-hook-form: the bon issuance
 * screen is built around a live pre-flight and holds its own `useState`. It
 * still deserves the same picker as everything else, so the widget lives here
 * and `DateControl` below is a thin adapter onto it. One implementation, so the
 * two cannot drift into looking different.
 */
export function DateField({
  id,
  label,
  value,
  onChange,
  required,
  hint,
  error,
  className,
  disabled,
}: {
  id: string
  label: string
  /** ISO `yyyy-MM-dd`, or "" for empty. */
  value: string
  onChange: (value: string) => void
  required?: boolean
  hint?: string
  error?: string
  className?: string
  disabled?: boolean
}) {
  return (
    <Field
      label={label}
      htmlFor={id}
      required={required}
      hint={hint}
      error={error}
      className={className}
    >
      <DatePicker
        id={id}
        value={value}
        onChange={onChange}
        disabled={disabled}
        invalid={Boolean(error)}
        describedBy={error ? `${id}-error` : undefined}
      />
    </Field>
  )
}

/**
 * A date field. The value stays an ISO `yyyy-MM-dd` string in the form, which
 * is what the zod schemas and the server actions read — only the *picker* is
 * new, so nothing downstream changed.
 */
export function DateControl<T extends FieldValues>({
  form,
  name,
  label,
  required,
  hint,
  className,
  disabled,
}: Base<T>) {
  const error = errorOf(form, name)
  return (
    <Field
      label={label}
      htmlFor={name}
      required={required}
      hint={hint}
      error={error}
      className={className}
    >
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <DatePicker
            id={name}
            value={typeof field.value === "string" ? field.value : ""}
            onChange={field.onChange}
            onBlur={field.onBlur}
            disabled={disabled}
            invalid={Boolean(error)}
            describedBy={error ? `${name}-error` : undefined}
          />
        )}
      />
    </Field>
  )
}

/**
 * The select **widget**, controlled by a plain value and setter.
 *
 * `placeholder` doubles as the contract: a field that has one accepts the
 * empty string, so it also gets a clear button; a field without one must be
 * answered, and cannot be cleared back to nothing.
 *
 * Like `DateField`, this exists so a form that is not a react-hook-form gets
 * the same control as one that is. `SelectControl` below is the adapter.
 */
export function SelectField({
  id,
  label,
  value,
  onChange,
  onBlur,
  options,
  placeholder,
  required,
  hint,
  error,
  className,
  disabled,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  /** Only react-hook-form needs this, for its touched state. */
  onBlur?: () => void
  options: readonly { value: string; label: string }[]
  placeholder?: string
  required?: boolean
  hint?: string
  error?: string
  className?: string
  disabled?: boolean
}) {
  const clearable = placeholder !== undefined
  // Base UI treats `null` as "nothing selected"; callers store "".
  const selected = value === "" ? null : value

  return (
    <Field
      label={label}
      htmlFor={id}
      required={required}
      hint={hint}
      error={error}
      className={className}
    >
      <Select
        value={selected}
        onValueChange={(next) => onChange(next ?? "")}
        items={options}
        disabled={disabled}
      >
        <SelectTrigger
          {...fieldProps(id, error)}
          onBlur={onBlur}
          className={cn(
            selectTriggerClass,
            clearable && "[&>svg:last-child]:hidden!"
          )}
        >
          <SelectValue placeholder={placeholder} />
          {clearable && selected !== null ? (
            <span
              role="button"
              tabIndex={-1}
              aria-label={`Effacer ${label.toLowerCase()}`}
              /* The trigger opens the popup on *pointer down*, before a click
                 ever lands, so stopping the click alone clears the value and
                 opens the menu anyway. Both are stopped. */
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onChange("")
              }}
              className="grid size-4 shrink-0 place-items-center rounded-sm text-ink-3 transition-colors hover:text-ink"
            >
              <HugeiconsIcon icon={MultiplicationSignIcon} size={13} strokeWidth={2} />
            </span>
          ) : null}
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}

/** The same select, bound to a react-hook-form field. */
export function SelectControl<T extends FieldValues>({
  form,
  name,
  label,
  required,
  hint,
  className,
  disabled,
  options,
  placeholder,
}: Base<T> & {
  options: readonly { value: string; label: string }[]
  placeholder?: string
}) {
  const error = errorOf(form, name)

  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <SelectField
          id={name}
          label={label}
          value={typeof field.value === "string" ? field.value : ""}
          onChange={field.onChange}
          onBlur={field.onBlur}
          options={options}
          placeholder={placeholder}
          required={required}
          hint={hint}
          error={error}
          className={className}
          disabled={disabled}
        />
      )}
    />
  )
}

export function TextareaControl<T extends FieldValues>({
  form,
  name,
  label,
  required,
  hint,
  className,
  disabled,
  rows = 3,
  placeholder,
}: Base<T> & { rows?: number; placeholder?: string }) {
  const error = errorOf(form, name)
  return (
    <Field
      label={label}
      htmlFor={name}
      required={required}
      hint={hint}
      error={error}
      className={className}
    >
      <textarea
        {...fieldProps(name, error)}
        {...form.register(name)}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-[7px] border border-line bg-surface px-2.5 py-2 text-[13px] outline-none transition-colors focus:border-brand aria-invalid:border-alert"
      />
    </Field>
  )
}

/**
 * A checkbox is a control with a label to its right, not a label above a
 * control, so it does not go through `Field`.
 */
export function CheckboxControl<T extends FieldValues>({
  form,
  name,
  label,
  hint,
  className,
  disabled,
}: Omit<Base<T>, "required">) {
  const error = errorOf(form, name)
  return (
    <div className={cn("space-y-1", className)}>
      <label className="flex cursor-pointer items-start gap-2 text-[13px]">
        <input
          type="checkbox"
          {...form.register(name)}
          disabled={disabled}
          className="mt-0.5 size-3.5 shrink-0 accent-[var(--sx-brand)]"
        />
        <span>{label}</span>
      </label>
      {hint ? <p className="pl-5.5 text-[11.5px] text-ink-3">{hint}</p> : null}
      {error ? (
        <p role="alert" className="pl-5.5 text-[11.5px] text-alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/**
 * A file input that shows what was chosen **before** anything is sent.
 *
 * Nothing uploads on selection: the `File` is held in form state and only
 * reaches the server when the form is submitted. Picking the wrong scan and
 * discovering it after it is stored is the failure this avoids — the preview is
 * rendered from a local object URL, so it costs no request either.
 *
 * The object URL is revoked by the effect's cleanup when it changes or the
 * field unmounts; leaving them alive pins the file in memory for the life of
 * the tab.
 */
export function FileControl<T extends FieldValues>({
  form,
  name,
  label,
  required,
  hint,
  className,
  accept,
}: Base<T> & { accept?: string }) {
  const error = errorOf(form, name)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [chosen, setChosen] = React.useState<{
    name: string
    size: number
    type: string
    url: string
  } | null>(null)

  React.useEffect(() => {
    const url = chosen?.url
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [chosen?.url])

  function select(file: File | null) {
    setChosen(
      file
        ? {
            name: file.name,
            size: file.size,
            type: file.type,
            url: URL.createObjectURL(file),
          }
        : null
    )
    // Stored as the File itself rather than a FileList: the schema validates
    // `instanceof File`, and a server action can take one.
    form.setValue(name, (file ?? undefined) as never, { shouldValidate: true })
  }

  function clear() {
    if (inputRef.current) inputRef.current.value = ""
    select(null)
  }

  const isImage = chosen?.type.startsWith("image/") ?? false
  const isPdf = chosen?.type === "application/pdf"

  return (
    <Field
      label={label}
      htmlFor={name}
      required={required}
      hint={hint}
      error={error}
      className={className}
    >
      <input
        {...fieldProps(name, error)}
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={(event) => select(event.target.files?.[0] ?? null)}
        className="w-full rounded-[7px] border border-line bg-surface px-2.5 py-1.5 text-[12.5px] file:mr-2.5 file:rounded-[5px] file:border-0 file:bg-sub file:px-2 file:py-1 file:text-[12px]"
      />

      {chosen ? (
        <div className="rounded-lg border border-line bg-sub p-2">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[12px]">
              {chosen.name}
              <span className="num ml-1.5 text-ink-3">
                {formatBytes(chosen.size)}
              </span>
            </span>
            <button
              type="button"
              onClick={clear}
              className="shrink-0 text-[11.5px] text-ink-3 underline-offset-2 hover:text-alert hover:underline"
            >
              Retirer
            </button>
          </div>

          <div className="mt-2 overflow-hidden rounded-md border border-line bg-surface">
            {isImage ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local object URL, never a remote asset
              <img
                src={chosen.url}
                alt={`Aperçu de ${chosen.name}`}
                className="mx-auto max-h-48 w-auto max-w-full object-contain"
              />
            ) : isPdf ? (
              <object
                data={chosen.url}
                type="application/pdf"
                aria-label={`Aperçu de ${chosen.name}`}
                className="h-48 w-full"
              >
                <p className="p-3 text-center text-[12px] text-ink-3">
                  Ce navigateur n&apos;affiche pas les PDF en ligne. Le fichier
                  sera envoyé tel quel.
                </p>
              </object>
            ) : (
              <p className="p-3 text-center text-[12px] text-ink-3">
                Pas d&apos;aperçu pour ce type de fichier.
              </p>
            )}
          </div>

          <p className="mt-1.5 text-[11px] text-ink-3">
            Rien n&apos;est envoyé tant que le formulaire n&apos;est pas validé.
          </p>
        </div>
      ) : null}
    </Field>
  )
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) {
    return `${(bytes / 1_048_576).toFixed(1).replace(".", ",")} Mo`
  }
  return `${Math.max(1, Math.round(bytes / 1024))} Ko`
}

/** Two columns on anything but a phone. Dialog forms use it throughout. */
export function FieldGrid({
  children,
  columns = 2,
  className,
}: {
  children: React.ReactNode
  columns?: 2 | 3
  className?: string
}) {
  return (
    <div
      className={cn(
        "grid gap-3",
        columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3",
        className
      )}
    >
      {children}
    </div>
  )
}
