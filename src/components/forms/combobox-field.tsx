"use client"

import * as React from "react"
import { Controller } from "react-hook-form"
import type { FieldValues, Path, UseFormReturn } from "react-hook-form"

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox"
import {
  Field,
  fieldProps,
  selectTriggerClass,
} from "@/components/forms/form-field"
import { cn } from "@/lib/utils"

/**
 * A select you can type into, for the fields whose list is a **register**
 * rather than an enumeration.
 *
 * A status has five values and a plain `<SelectField>` is right for it. A
 * participant or an employer is a row in a table that grows without limit, and
 * scrolling a few hundred names to find one is not a thing anyone should be
 * asked to do at a counter. Those get this.
 *
 * Built on ReUI's combobox (Base UI underneath, matching `components.json`'s
 * `base-nova`), themed to `selectTriggerClass` so it lines up with the selects
 * and date pickers beside it rather than introducing a third control height.
 *
 * The value stays the **id string**, as every other control here does, so the
 * zod schemas and the server actions are unchanged: the item object is an
 * implementation detail of the widget.
 */

export type ComboboxOption = {
  value: string
  label: string
  /**
   * A second line — a matricule, a plan code. Searchable too, so typing a
   * matricule finds the person even though the name is what is displayed.
   */
  hint?: string
}

/** What the typed query is matched against. */
const searchText = (option: ComboboxOption) =>
  option.hint ? `${option.label} ${option.hint}` : option.label

/**
 * Accents and case folded away: the names in this register carry them and
 * nobody types them into a search box.
 */
const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()

/**
 * Substring rather than prefix.
 *
 * Base UI's default filter matches from the start of the string, so with the
 * matricule appended to the name a query of `IPM0042` matched nothing — the
 * hint was searchable in theory and useless in practice, which is the opposite
 * of the point.
 */
const matches = (option: ComboboxOption, query: string) =>
  fold(searchText(option)).includes(fold(query))

function OptionLabel({ option }: { option: ComboboxOption }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate">{option.label}</span>
      {option.hint ? (
        <span className="mono truncate text-[11.5px] text-ink-3">
          {option.hint}
        </span>
      ) : null}
    </span>
  )
}

export function ComboboxField({
  id,
  label,
  value,
  onChange,
  onBlur,
  options,
  placeholder = "Rechercher…",
  searchPlaceholder,
  emptyLabel = "Aucun résultat.",
  required,
  hint,
  error,
  className,
  disabled,
}: {
  id: string
  label: string
  /** The selected option's `value`, or "" for none. */
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  options: readonly ComboboxOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyLabel?: string
  required?: boolean
  hint?: string
  error?: string
  className?: string
  disabled?: boolean
}) {
  // The widget works in items; the form works in ids. Mapped here, in one
  // place, so no caller has to know the difference.
  const selected = React.useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value]
  )

  return (
    <Field
      label={label}
      htmlFor={id}
      required={required}
      hint={hint}
      error={error}
      className={className}
    >
      <Combobox
        items={options as ComboboxOption[]}
        value={selected}
        onValueChange={(next: ComboboxOption | null) => onChange(next?.value ?? "")}
        itemToStringValue={searchText}
        filter={matches}
        disabled={disabled}
        autoHighlight
      >
        <ComboboxTrigger
          {...fieldProps(id, error)}
          onBlur={onBlur}
          className={cn(
            selectTriggerClass,
            "w-full",
            error && "border-alert",
            // The trigger shows two lines for a selected option; let it.
            "h-auto min-h-9 py-1.5"
          )}
        >
          <ComboboxValue placeholder={placeholder}>
            {(option: ComboboxOption | null) =>
              option ? (
                <OptionLabel option={option} />
              ) : (
                <span className="text-ink-3">{placeholder}</span>
              )
            }
          </ComboboxValue>
        </ComboboxTrigger>

        <ComboboxContent>
          <ComboboxInput
            showTrigger={false}
            placeholder={searchPlaceholder ?? placeholder}
          />
          <ComboboxEmpty>{emptyLabel}</ComboboxEmpty>
          <ComboboxList>
            {(option: ComboboxOption) => (
              <ComboboxItem key={option.value} value={option}>
                <OptionLabel option={option} />
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </Field>
  )
}

/** The same combobox, bound to a react-hook-form field. */
export function ComboboxControl<T extends FieldValues>({
  form,
  name,
  label,
  options,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  required,
  hint,
  className,
  disabled,
}: {
  form: UseFormReturn<T>
  name: Path<T>
  label: string
  options: readonly ComboboxOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyLabel?: string
  required?: boolean
  hint?: string
  className?: string
  disabled?: boolean
}) {
  const errors = form.formState.errors as Record<string, { message?: string }>
  const error = errors[name]?.message

  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <ComboboxField
          id={name}
          label={label}
          value={typeof field.value === "string" ? field.value : ""}
          onChange={field.onChange}
          onBlur={field.onBlur}
          options={options}
          placeholder={placeholder}
          searchPlaceholder={searchPlaceholder}
          emptyLabel={emptyLabel}
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
