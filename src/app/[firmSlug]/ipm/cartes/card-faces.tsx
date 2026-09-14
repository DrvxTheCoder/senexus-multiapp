"use client"

import { PREVIEW_HEIGHT, PREVIEW_WIDTH } from "@/lib/ipm/card-preview"
import { Download01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

/**
 * Les deux faces de la carte, telles qu'elles s'impriment.
 *
 * Shared by the cards list and the participant record so the two cannot drift:
 * a preview that differs from the other screen's preview is worse than no
 * preview, because it invites the operator to trust whichever they saw last.
 *
 * The images come from `/api/ipm/cards/...` rather than being embedded. No
 * card ever exists at a public URL — §6 requires the photo, the birth date and
 * the matricule to reach only a signed-in caller, and a card carries all three.
 */
export function CardFaces({
  firmSlug,
  memberId,
  /** Cache-buster, so a freshly uploaded photo is not served from memory. */
  version,
  className,
}: {
  firmSlug: string
  memberId: string
  version?: string | number
  className?: string
}) {
  const base = `/${firmSlug}/api/ipm/cards/${memberId}`
  const bust = version === undefined ? "" : `&v=${encodeURIComponent(String(version))}`

  return (
    <div className={className ?? "flex flex-wrap gap-4"}>
      {(["recto", "verso"] as const).map((face) => (
        /* eslint-disable-next-line @next/next/no-img-element -- authenticated route, no build-time host to declare */
        <img
          key={face}
          src={`${base}/${face}?preview=1${bust}`}
          alt={`Carte ${face}`}
          width={PREVIEW_WIDTH}
          height={PREVIEW_HEIGHT}
          className="rounded border border-line bg-surface"
        />
      ))}
    </div>
  )
}

/** The print files, as links. Both faces, CMYK. */
export function CardDownloads({
  firmSlug,
  memberId,
}: {
  firmSlug: string
  memberId: string
}) {
  const base = `/${firmSlug}/api/ipm/cards/${memberId}`

  return (
    <>
      {(["recto", "verso"] as const).map((face) => (
        <a
          key={face}
          href={`${base}/${face}?format=tiff`}
          className="flex flex-row gap-2 h-8 items-center rounded-[7px] border border-line px-2.5 text-[13px] capitalize hover:bg-sub"
        >
          {face}
          <HugeiconsIcon icon={Download01Icon} size={14} strokeWidth={1.8} />
        </a>
      ))}
    </>
  )
}
