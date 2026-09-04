import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Alert02Icon,
  Clock01Icon,
  File01Icon,
  ShieldCheckIcon,
} from "@hugeicons/core-free-icons"

import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"

const TYPE_LABELS: Record<string, string> = {
  CV: "CV",
  ID_CARD: "Copie CNI",
  PASSPORT: "Passeport",
  CONTRACT: "Contrat de travail",
  PAYSLIP: "Bulletin de paie",
  CERTIFICATE: "Attestation",
  DIPLOMA: "Diplôme",
  MEDICAL_CERTIFICATE: "Certificat médical",
  LEGAL_DOCUMENT: "Document légal",
  MISSION_REPORT: "Rapport de mission",
  EXPENSE_RECEIPT: "Justificatif de frais",
  OTHER: "Autre",
}

function formatSize(bytes: number | null): string {
  if (!bytes) return ""
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1).replace(".", ",")} Mo`
  return `${Math.round(bytes / 1024)} Ko`
}

/**
 * §4.6 / §3.7 — a document.
 *
 * The link points at our own authenticated route, never at the storage URL.
 * `fileUrl` is not even selected by the query that feeds this component, so a
 * raw Zipline address cannot reach the HTML by accident.
 */
export function DocumentCard({
  id,
  fileName,
  documentType,
  fileSize,
  expiryDate,
  isVerified,
  firmSlug,
}: {
  id: string
  fileName: string
  documentType: string
  fileSize: number | null
  expiryDate: Date | null
  isVerified: boolean
  firmSlug: string
}) {
  const now = new Date()
  const expired = expiryDate !== null && expiryDate < now
  const expiringSoon =
    expiryDate !== null &&
    !expired &&
    expiryDate.getTime() - now.getTime() < 60 * 86_400_000

  return (
    <a
      href={`/${firmSlug}/api/files/${id}`}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "flex items-center gap-2.5 rounded-lg border border-line px-2.5 py-2 transition-colors",
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
        <span className="block truncate text-[12.5px] font-medium">
          {TYPE_LABELS[documentType] ?? documentType}
        </span>
        <span className="block truncate text-[11.5px] text-ink-3">
          {[formatSize(fileSize), fileName].filter(Boolean).join(" · ")}
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
    </a>
  )
}
