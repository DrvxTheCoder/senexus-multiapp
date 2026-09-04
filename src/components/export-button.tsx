"use client"

import { useSearchParams } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { Download01Icon } from "@hugeicons/core-free-icons"

/**
 * Export carries the current URL verbatim, which is the whole point of §3.5:
 * the export route parses the same parameters through the same schema and runs
 * the same resolver, so the file always matches what is on screen — including
 * the caller's role scope, which it inherits rather than re-implements.
 */
export function ExportButton({ basePath }: { basePath: string }) {
  const searchParams = useSearchParams()
  const query = searchParams.toString()

  return (
    <a
      href={query ? `${basePath}?${query}` : basePath}
      className="inline-flex h-[30px] items-center gap-1.5 rounded-[7px] border border-ink bg-ink px-2.5 text-[12.5px] font-medium text-paper transition-opacity hover:opacity-90"
    >
      <HugeiconsIcon icon={Download01Icon} size={13} />
      Exporter
    </a>
  )
}
