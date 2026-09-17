import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { Download04Icon, Pdf01Icon } from "@hugeicons/core-free-icons"

import { cn } from "@/lib/utils"

/**
 * Le lien vers un document imprimable.
 *
 * A plain link, not a button with a fetch behind it. That is the whole design:
 * the PDF routes are authenticated GETs, so the browser can open one in its
 * own viewer, and an operator gets the print dialog, the zoom and the page
 * thumbnails they already know. A client-side download would replace all of
 * that with a spinner and a file in the Downloads folder.
 *
 * `target="_blank"` because the document is consulted *beside* the queue it
 * was opened from — an operator checks a bon and then goes on visa-ing the
 * next one, and losing the list to a PDF is how they lose their place.
 *
 * `download` flips the route to `Content-Disposition: attachment` for the
 * times they are filing rather than reading. Two links rather than one control
 * with a mode, because they are two different intentions and both are one
 * click.
 */
export function DocumentLink({
  href,
  label,
  download,
  compact,
  className,
}: {
  /** The PDF route. `?download=1` is appended when `download` is set. */
  href: string
  label: string
  download?: boolean
  /** Icon only, for a table row where a word of text would crowd the data. */
  compact?: boolean
  className?: string
}) {
  const url = download
    ? `${href}${href.includes("?") ? "&" : "?"}download=1`
    : href

  return (
    <Link
      href={url}
      target="_blank"
      rel="noopener"
      // Not `prefetch`: this is a PDF render, and prefetching one would run the
      // whole document generation for every row the user merely hovered.
      prefetch={false}
      aria-label={compact ? label : undefined}
      title={compact ? label : undefined}
      className={cn(
        "inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-[6px] border border-line px-2 text-[12px] text-ink-2 transition-colors hover:border-brand hover:text-ink",
        compact && "w-[26px] justify-center px-0",
        className
      )}
    >
      <HugeiconsIcon
        icon={download ? Download04Icon : Pdf01Icon}
        size={13}
        strokeWidth={1.8}
      />
      {compact ? null : label}
    </Link>
  )
}
