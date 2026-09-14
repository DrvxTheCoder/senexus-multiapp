"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { Delete02Icon, ImageUpload01Icon } from "@hugeicons/core-free-icons"

import { removePersonPhoto, uploadPersonPhoto } from "@/server/actions/ipm-photos"
import type { PhotoSubject } from "@/lib/forms/ipm-schemas"
import { notify } from "@/lib/toast"
import { cn } from "@/lib/utils"

/**
 * La photo d'un participant ou d'un ayant droit.
 *
 * The photo is printed on the card, so this is not decoration: what is
 * uploaded here is what a pharmacist compares against the face at the counter.
 * Three consequences shape the component:
 *
 *   - **the preview is the card's crop**, a circle, not a square thumbnail.
 *     A photo that looks right in a rectangle and loses a chin once the card
 *     clips it is the mistake this prevents, and it costs nothing to show the
 *     real shape here;
 *   - **absence is shown, not hidden.** No photo renders as the same
 *     silhouette the card prints, so a register of faceless cards is visible
 *     rather than tidy;
 *   - **replacing is one step.** Choosing a new file uploads it and drops the
 *     old one; there is no "save" to forget.
 *
 * A plain `<img>` rather than `next/image`: photos live on a self-hosted
 * Zipline instance whose host comes from an environment variable, so it cannot
 * go in a build-time `remotePatterns` allow-list.
 */
export function PersonPhoto({
  firmSlug,
  subject,
  subjectId,
  photoUrl,
  name,
  size = 96,
  canWrite,
  className,
}: {
  firmSlug: string
  subject: PhotoSubject
  subjectId: string
  photoUrl: string | null
  /** Used for the alt text, so a missing image still says who it is. */
  name: string
  size?: number
  canWrite: boolean
  className?: string
}) {
  const router = useRouter()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [pending, setPending] = React.useState<"upload" | "remove" | null>(null)

  // Shown the instant a file is chosen, so the operator sees the new face
  // while the upload is still in flight rather than a spinner over the old one.
  const [preview, setPreview] = React.useState<string | null>(null)

  React.useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview)
    }
  }, [preview])

  async function upload(file: File) {
    // The storage layer enforces this too — that is the real guard. Checking
    // here as well turns a 5 MB phone photo into an immediate sentence instead
    // of a round trip that fails.
    if (!file.type.startsWith("image/")) {
      notify.error("Choisissez une image (JPEG, PNG ou WebP).")
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      notify.error("L'image ne doit pas dépasser 5 Mo.")
      return
    }

    const localUrl = URL.createObjectURL(file)
    setPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous)
      return localUrl
    })
    setPending("upload")

    const body = new FormData()
    body.set("firmSlug", firmSlug)
    body.set("subject", subject)
    body.set("subjectId", subjectId)
    body.set("file", file)

    const result = await uploadPersonPhoto(body)
    setPending(null)

    if (!result.ok) {
      // Drop the optimistic preview so the component stops claiming a photo
      // that was never stored.
      setPreview((previous) => {
        if (previous) URL.revokeObjectURL(previous)
        return null
      })
      notify.error(result.message)
      return
    }

    notify.success("Photo enregistrée.")
    router.refresh()
  }

  async function remove() {
    setPending("remove")
    const result = await removePersonPhoto({ firmSlug, subject, subjectId })
    setPending(null)

    if (!result.ok) {
      notify.error(result.message)
      return
    }

    setPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous)
      return null
    })
    notify.success("Photo retirée.")
    router.refresh()
  }

  const shown = preview ?? photoUrl
  const busy = pending !== null

  // Below this the buttons would dominate the row, so the photo itself becomes
  // the control: the table shows nine of these and three buttons each would
  // bury the names they belong to.
  const compact = size <= 56

  const picker = canWrite ? (
    <input
      ref={inputRef}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      className="sr-only"
      onChange={(event) => {
        const file = event.target.files?.[0]
        // Reset first, so choosing the same file twice still fires.
        event.target.value = ""
        if (file) void upload(file)
      }}
    />
  ) : null

  const frame = (
    <span
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-full border border-line bg-sub",
        canWrite && compact && "cursor-pointer hover:border-brand"
      )}
      style={{ width: size, height: size }}
    >
      {shown ? (
        // eslint-disable-next-line @next/next/no-img-element -- external host from env; see note above
        <img
          src={shown}
          alt={`Photo de ${name}`}
          width={size}
          height={size}
          className={cn(
            "h-full w-full object-cover transition-opacity",
            busy && "opacity-50"
          )}
        />
      ) : (
        <Silhouette size={size} dimmed={busy} />
      )}
    </span>
  )

  if (compact) {
    return (
      <div className={cn("flex items-center gap-1.5", className)}>
        {picker}
        {canWrite ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            title={shown ? `Remplacer la photo de ${name}` : `Ajouter une photo à ${name}`}
            className="rounded-full disabled:opacity-60"
          >
            {frame}
          </button>
        ) : (
          frame
        )}

        {canWrite && photoUrl ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            title={`Retirer la photo de ${name}`}
            className="text-ink-3 hover:text-alert disabled:opacity-60"
          >
            <HugeiconsIcon icon={Delete02Icon} size={13} strokeWidth={1.8} />
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className={cn("flex items-center gap-3", className)}>
      {frame}

      {canWrite ? (
        <div className="flex flex-col gap-1.5">
          {picker}

          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="flex h-8 items-center gap-1.5 rounded-[7px] border border-line px-2.5 text-[13px] hover:bg-sub disabled:opacity-60"
          >
            <HugeiconsIcon icon={ImageUpload01Icon} size={14} strokeWidth={1.8} />
            {pending === "upload"
              ? "Téléversement…"
              : shown
                ? "Remplacer"
                : "Ajouter une photo"}
          </button>

          {photoUrl ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove()}
              className="flex h-8 items-center gap-1.5 rounded-[7px] border border-line px-2.5 text-[13px] text-alert hover:bg-sub disabled:opacity-60"
            >
              <HugeiconsIcon icon={Delete02Icon} size={14} strokeWidth={1.8} />
              {pending === "remove" ? "Suppression…" : "Retirer"}
            </button>
          ) : null}

          <p className="text-[11.5px] text-ink-3">JPEG, PNG ou WebP · 5 Mo max.</p>
        </div>
      ) : null}
    </div>
  )
}

/** The same head-and-shoulders mark the printed card falls back to. */
function Silhouette({ size, dimmed }: { size: number; dimmed: boolean }) {
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      aria-hidden
      className={cn("text-ink-3/35 transition-opacity", dimmed && "opacity-50")}
    >
      <circle cx="20" cy="15" r="6.8" fill="currentColor" />
      <circle cx="20" cy="34.4" r="12.4" fill="currentColor" />
    </svg>
  )
}
