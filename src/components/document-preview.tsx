"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Download04Icon,
  File01Icon,
  LinkSquare02Icon,
} from "@hugeicons/core-free-icons"

import { StatusPill } from "@/components/primitives"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatDate } from "@/lib/format"

/**
 * §3.7 — previewing a document without ever exposing where it is stored.
 *
 * Both sources — the `src` the viewer loads and the two buttons — point at
 * `/[firmSlug]/api/files/[documentId]`, our own authenticated route. `fileUrl`
 * is not selected by either query that feeds this component, so a raw Zipline
 * address cannot reach the HTML even by accident.
 *
 * Three render paths, decided from the stored MIME type and the extension as a
 * fallback, because legacy rows have `mimeType` null:
 *
 *   image  <img>
 *   pdf    <object>, with the two buttons as the fallback for browsers that
 *          refuse to embed one (mobile Safari, most notably)
 *   other  no inline preview is offered, and it says so rather than showing an
 *          empty frame
 */

export type PreviewDocument = {
  id: string
  fileName: string
  documentType: string
  mimeType?: string | null
  fileSize?: number | null
  expiryDate?: Date | null
  isVerified?: boolean
}

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
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

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return ""
  if (bytes >= 1_048_576) {
    return `${(bytes / 1_048_576).toFixed(1).replace(".", ",")} Mo`
  }
  return `${Math.round(bytes / 1024)} Ko`
}

type Kind = "image" | "pdf" | "other"

function kindOf(document: PreviewDocument): Kind {
  const mime = document.mimeType?.toLowerCase() ?? ""
  if (mime.startsWith("image/")) return "image"
  if (mime === "application/pdf") return "pdf"

  // Legacy rows were written without a MIME type; the extension is all there is.
  const extension = document.fileName.toLowerCase().split(".").pop() ?? ""
  if (["png", "jpg", "jpeg", "gif", "webp", "avif"].includes(extension)) {
    return "image"
  }
  if (extension === "pdf") return "pdf"
  return "other"
}

export function DocumentPreviewDialog({
  document,
  firmSlug,
  onClose,
}: {
  document: PreviewDocument | null
  firmSlug: string
  onClose: () => void
}) {
  if (!document) return null

  const href = `/${firmSlug}/api/files/${document.id}`
  const downloadHref = `${href}?download=1`
  const kind = kindOf(document)
  const label = DOCUMENT_TYPE_LABELS[document.documentType] ?? document.documentType
  const size = formatFileSize(document.fileSize)

  const actions = (
    <div className="flex flex-wrap items-center gap-1.5">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-line bg-surface px-2.5 text-[12.5px] font-medium hover:bg-sub"
      >
        <HugeiconsIcon icon={LinkSquare02Icon} size={14} strokeWidth={1.8} />
        Ouvrir dans un onglet
      </a>
      <a
        href={downloadHref}
        // `download` alone is not enough here: the response decides, and the
        // route only sends `attachment` when asked for it.
        download={document.fileName}
        className="inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-ink px-2.5 text-[12.5px] font-medium text-paper hover:opacity-90"
      >
        <HugeiconsIcon icon={Download04Icon} size={14} strokeWidth={1.8} />
        Télécharger
      </a>
    </div>
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[92svh] w-[min(1040px,calc(100%-2rem))] max-w-none flex-col gap-3 p-0 sm:max-w-none">
        <DialogHeader className="gap-1 px-4 pt-4 pr-12">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-[15px]">
            {label}
            {document.isVerified === true ? (
              <StatusPill tone="ok">Vérifiée</StatusPill>
            ) : document.isVerified === false ? (
              <StatusPill tone="signal">En attente</StatusPill>
            ) : null}
          </DialogTitle>
          <DialogDescription className="text-[12.5px]">
            <span className="mono">{document.fileName}</span>
            {size ? ` · ${size}` : null}
            {document.expiryDate
              ? ` · expire le ${formatDate(document.expiryDate)}`
              : null}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden border-y border-line bg-sunken">
          {kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element -- streamed through our own route; no build-time host to declare
            <img
              src={href}
              alt={`${label} — ${document.fileName}`}
              className="mx-auto max-h-[70svh] w-auto max-w-full object-contain"
            />
          ) : kind === "pdf" ? (
            <object
              data={href}
              type="application/pdf"
              aria-label={`${label} — ${document.fileName}`}
              className="h-[70svh] w-full"
            >
              <Fallback
                message="Ce navigateur n'affiche pas les PDF en ligne."
                actions={actions}
              />
            </object>
          ) : (
            <Fallback
              message="Ce type de fichier n'a pas d'aperçu."
              actions={actions}
            />
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2.5 px-4 pb-4">
          {/* <p className="min-w-0 flex-1 text-[11.5px] text-ink-3">
            Servi par l&apos;application, pas par le stockage : le lien exige
            votre session et votre accès à cette entreprise.
          </p> */}
          {actions}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Fallback({
  message,
  actions,
}: {
  message: string
  actions: React.ReactNode
}) {
  return (
    <div className="flex h-[40svh] flex-col items-center justify-center gap-3 p-6 text-center">
      <HugeiconsIcon
        icon={File01Icon}
        size={26}
        strokeWidth={1.6}
        className="text-ink-3"
      />
      <p className="text-[13px] text-ink-2">{message}</p>
      {actions}
    </div>
  )
}
