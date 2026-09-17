"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ImageUpload01Icon,
  MultiplicationSignIcon,
  UserIcon,
} from "@hugeicons/core-free-icons"

import { Field } from "@/components/forms/form-field"
import { formatBytes, useFileUpload } from "@/hooks/use-file-upload"
import { cn } from "@/lib/utils"

/**
 * Le champ image des formulaires — choisi, pas collé.
 *
 * Every image in the administration console used to be a **URL field**: an
 * operator was expected to host the logo somewhere themselves and paste the
 * address. Nobody did, so no firm had a logo, no user had a photo, and there
 * was nowhere at all to put a signature — which is why the bon de décaissement
 * could not print its visas.
 *
 * Built on ReUI's `useFileUpload` (`@reui/use-file-upload`): the hook owns
 * drag state, the accept/size validation and the object-URL lifecycle, and
 * this component is the ReUI composition — drop zone, preview, remove control,
 * error alert — re-skinned onto the sx tokens rather than shadcn's defaults.
 *
 * ## The value is a pair, and that is the point
 *
 * A stored image and a freshly chosen file are different things, and a control
 * that collapses them cannot express "remove the logo": clearing a `File` back
 * to `null` looks identical to never having picked one. So the value carries
 * both — `url` is what the database holds today, `file` is what the operator
 * just chose — and the three states an operator can actually mean are all
 * distinguishable:
 *
 *   - `{ url: "https://…", file: null }` — unchanged;
 *   - `{ url: "https://…", file: File }` — replace;
 *   - `{ url: null, file: null }` — remove.
 *
 * ## Nothing uploads here
 *
 * Selection is local. The file reaches Zipline when the form is submitted, via
 * `uploadAsset`, and the preview costs no request because it is an object URL.
 * Picking the wrong scan and finding out only after it is stored is the
 * failure this avoids.
 */

export type AssetValue = {
  /** The stored image, or null once removed. */
  url: string | null
  /** A locally chosen replacement, not yet uploaded. */
  file: File | null
}

export const EMPTY_ASSET: AssetValue = { url: null, file: null }

/** The value a form starts from, for a record that may already have an image. */
export function assetFrom(url: string | null | undefined): AssetValue {
  return { url: url ?? null, file: null }
}

type Shape = "avatar" | "banner" | "signature"

const SHAPES: Record<
  Shape,
  { frame: string; media: string; empty: string }
> = {
  // The round crop the rest of the product shows a person in.
  avatar: {
    frame: "size-24 rounded-full",
    media: "size-full object-cover",
    empty: "flex-col gap-1",
  },
  // A logo or an en-tête: never cropped, because the whole point of a
  // letterhead is the part at its edges.
  banner: {
    frame: "h-28 w-full rounded-[9px]",
    media: "max-h-full max-w-full object-contain",
    empty: "flex-col gap-1.5",
  },
  // A signature is ink on nothing. Shown on white, whatever the theme, because
  // white is what it will be printed on — a transparent PNG that looks fine on
  // a dark background and disappears on paper is the mistake this catches.
  signature: {
    frame: "h-24 w-full rounded-[9px] bg-white",
    media: "max-h-full max-w-full object-contain",
    empty: "flex-col gap-1.5",
  },
}

export function AssetField({
  label,
  name,
  value,
  onChange,
  shape = "banner",
  hint,
  error,
  required,
  disabled,
  accept = "image/jpeg,image/png,image/webp",
  maxSize = 5 * 1024 * 1024,
  emptyLabel,
  className,
}: {
  label: string
  /** Used for the input id and the field wiring, like every other control. */
  name: string
  value: AssetValue
  onChange: (value: AssetValue) => void
  shape?: Shape
  hint?: string
  error?: string
  required?: boolean
  disabled?: boolean
  accept?: string
  maxSize?: number
  emptyLabel?: string
  className?: string
}) {
  const [
    { files, isDragging, errors },
    {
      removeFile,
      handleDragEnter,
      handleDragLeave,
      handleDragOver,
      handleDrop,
      openFileDialog,
      getInputProps,
    },
  ] = useFileUpload({
    accept,
    maxSize,
    multiple: false,
    maxFiles: 1,
    onFilesAdded: (added) => {
      const picked = added[0]?.file
      if (picked instanceof File) onChange({ ...value, file: picked })
    },
  })

  const chosen = files[0]
  const preview = chosen?.preview ?? value.url
  const geometry = SHAPES[shape]

  function clear() {
    if (chosen) removeFile(chosen.id)
    // Clears the stored image too: an operator who presses the remove control
    // beside an existing logo means "this firm has no logo", not "keep it".
    onChange(EMPTY_ASSET)
  }

  // The hook's own messages are English and generic; the size rule is the one
  // an operator can act on, so it is restated in the field's language.
  const message =
    error ??
    (errors.length
      ? `Image refusée : formats acceptés JPEG, PNG ou WebP, ${formatBytes(maxSize)} maximum.`
      : undefined)

  return (
    <Field
      label={label}
      htmlFor={name}
      required={required}
      hint={hint}
      error={message}
      className={className}
    >
      <div className={cn("flex items-start gap-3", shape !== "avatar" && "flex-col")}>
        <div className="relative">
          {/* Outside the drop zone, not inside it.
              A `<button>` may not contain interactive content, and nesting it
              also makes the click path re-enter itself: `openFileDialog` calls
              `input.click()`, whose event bubbles straight back to the
              button's own `onClick`. The specification's in-progress flag
              happens to stop that looping, which is not a thing to rely on. */}
          <input
            {...getInputProps()}
            // `aria-invalid` is not a supported attribute of role=button, so
            // it rides on the real control rather than on the drop zone. The
            // description stays on the button, which is what actually takes
            // focus.
            aria-invalid={message ? true : undefined}
            className="sr-only"
            tabIndex={-1}
          />

          <button
            type="button"
            id={name}
            disabled={disabled}
            onClick={openFileDialog}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            aria-describedby={message ? `${name}-error` : undefined}
            className={cn(
              "grid cursor-pointer place-items-center overflow-hidden border border-dashed border-line bg-sub p-1.5 transition-colors",
              "hover:border-brand focus-visible:border-brand focus-visible:outline-none",
              "disabled:cursor-not-allowed disabled:opacity-50",
              isDragging && "border-brand bg-brand-wash",
              preview && "border-solid",
              geometry.frame
            )}
          >
            {preview ? (
              /* eslint-disable-next-line @next/next/no-img-element -- object URL, or a Zipline host that comes from an env var and so cannot be in a build-time allow-list */
              <img
                src={preview}
                alt={`Aperçu — ${label.toLowerCase()}`}
                className={geometry.media}
              />
            ) : (
              <span
                className={cn(
                  "flex items-center justify-center text-ink-3",
                  geometry.empty
                )}
              >
                <HugeiconsIcon
                  icon={shape === "avatar" ? UserIcon : ImageUpload01Icon}
                  size={shape === "avatar" ? 26 : 20}
                  strokeWidth={1.6}
                />
                {shape === "avatar" ? null : (
                  <span className="text-[11.5px]">
                    {emptyLabel ?? "Glissez une image ou cliquez pour choisir"}
                  </span>
                )}
              </span>
            )}
          </button>

          {preview && !disabled ? (
            <button
              type="button"
              onClick={clear}
              aria-label={`Retirer ${label.toLowerCase()}`}
              className="absolute -end-1.5 -top-1.5 grid size-5 place-items-center rounded-full border border-line bg-surface text-ink-3 shadow-sm hover:text-alert"
            >
              <HugeiconsIcon icon={MultiplicationSignIcon} size={12} strokeWidth={2} />
            </button>
          ) : null}
        </div>

        <div className="min-w-0 space-y-1">
          {chosen?.file ? (
            <p className="truncate text-[12px]">
              {chosen.file.name}
              <span className="num ml-1.5 text-ink-3">
                {formatBytes(chosen.file.size)}
              </span>
            </p>
          ) : null}
        </div>
      </div>
    </Field>
  )
}
