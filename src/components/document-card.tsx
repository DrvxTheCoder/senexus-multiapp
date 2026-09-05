"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Alert02Icon,
  Clock01Icon,
  File01Icon,
  ShieldCheckIcon,
} from "@hugeicons/core-free-icons"

import {
  DOCUMENT_TYPE_LABELS,
  DocumentPreviewDialog,
  formatFileSize,
} from "@/components/document-preview"
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * §4.6 / §3.7 — a document.
 *
 * The card opens a preview rather than navigating away: looking at a CNI to
 * check it is the common case, and downloading it is not. Both the preview and
 * its two buttons point at our own authenticated route, never at the storage
 * URL — `fileUrl` is not even selected by the query that feeds this component,
 * so a raw Zipline address cannot reach the HTML by accident.
 */
export function DocumentCard({
  id,
  fileName,
  documentType,
  fileSize,
  mimeType,
  expiryDate,
  isVerified,
  firmSlug,
}: {
  id: string
  fileName: string
  documentType: string
  fileSize: number | null
  mimeType?: string | null
  expiryDate: Date | null
  isVerified: boolean
  firmSlug: string
}) {
  const [open, setOpen] = React.useState(false)

  const now = new Date()
  const expired = expiryDate !== null && expiryDate < now
  const expiringSoon =
    expiryDate !== null &&
    !expired &&
    expiryDate.getTime() - now.getTime() < 60 * 86_400_000

  const label = DOCUMENT_TYPE_LABELS[documentType] ?? documentType

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Aperçu de ${label} — ${fileName}`}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg border border-line px-2.5 py-2 text-left transition-colors",
          "hover:border-line-2 hover:bg-sub"
        )}
      >
        <HugeiconsIcon
          icon={File01Icon}
          size={17}
          className="shrink-0 text-ink-3"
          strokeWidth={1.8}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium">{label}</span>
          <span className="block truncate text-[11.5px] text-ink-3">
            {[formatFileSize(fileSize), fileName].filter(Boolean).join(" · ")}
          </span>
          {expiryDate ? (
            <span
              className={cn(
                "block truncate text-[11.5px]",
                expired ? "text-alert" : expiringSoon ? "text-signal" : "text-ink-3"
              )}
            >
              {expired ? "Expirée le " : "Expire le "}
              {formatDate(expiryDate)}
            </span>
          ) : null}
        </span>
        <HugeiconsIcon
          icon={expired ? Alert02Icon : isVerified ? ShieldCheckIcon : Clock01Icon}
          size={15}
          className={cn(
            "shrink-0",
            expired ? "text-alert" : isVerified ? "text-ok" : "text-signal"
          )}
        />
      </button>

      <DocumentPreviewDialog
        document={
          open
            ? {
                id,
                fileName,
                documentType,
                mimeType,
                fileSize,
                expiryDate,
                isVerified,
              }
            : null
        }
        firmSlug={firmSlug}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
