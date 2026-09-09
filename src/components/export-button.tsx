"use client"

import { useSearchParams } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { Download01Icon } from "@hugeicons/core-free-icons"

import { notify } from "@/lib/toast"

/**
 * Export carries the current URL verbatim, which is the whole point of §3.5:
 * the export route parses the same parameters through the same schema and runs
 * the same resolver, so the file always matches what is on screen — including
 * the caller's role scope, which it inherits rather than re-implements.
 *
 * It stays a plain anchor. Fetching the file into a blob to drive a toast to
 * completion would buffer a streamed workbook in memory and throw away
 * `streamXlsx`, which exists precisely so a large export does not. The trade is
 * that the browser owns the transfer and never tells us it finished — so the
 * toast says what is actually known, that the file is being prepared, and does
 * not claim a success it cannot observe.
 *
 * `data-no-progress` keeps the navigation bar out of it: a download changes no
 * pathname, so the bar would trickle until its safety timeout.
 */
export function ExportButton({ basePath }: { basePath: string }) {
  const searchParams = useSearchParams()
  const query = searchParams.toString()

  return (
    <a
      href={query ? `${basePath}?${query}` : basePath}
      data-no-progress
      onClick={() =>
        notify.success("Export en cours de préparation.", {
          description: "Le téléchargement démarre dès que le fichier est prêt.",
        })
      }
      className="inline-flex h-[30px] items-center gap-1.5 rounded-[7px] border border-ink bg-ink px-2.5 text-[12.5px] font-medium text-paper transition-opacity hover:opacity-90"
    >
      <HugeiconsIcon icon={Download01Icon} size={13} />
      Exporter
    </a>
  )
}
