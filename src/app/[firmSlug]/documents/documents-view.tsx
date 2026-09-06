"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useQueryStates } from "nuqs"
import {
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
} from "nuqs"
import type { ColumnDef } from "@tanstack/react-table"
import { HugeiconsIcon } from "@hugeicons/react"
import { EyeIcon, Search01Icon } from "@hugeicons/core-free-icons"

import { DataTable } from "@/components/data-table"
import {
  DOCUMENT_TYPE_LABELS,
  DocumentPreviewDialog,
  type PreviewDocument,
} from "@/components/document-preview"
import { FacetFilter } from "@/components/filters/facet-filter"
import { Pager } from "@/components/list-controls"
import { Panel } from "@/components/panel"
import { Avatar, EmptyState, StatusPill, TwoFacts } from "@/components/primitives"
import { formatDate, formatNumber, initials } from "@/lib/format"
import { cn } from "@/lib/utils"
import type {
  DocumentGroup,
  DocumentRow,
  DocumentSummary,
} from "@/server/queries/documents"
import type { Paged } from "@/server/queries/types"

const searchParamsDef = {
  q: parseAsString,
  type: parseAsArrayOf(parseAsString, ","),
  flag: parseAsArrayOf(parseAsString, ","),
  employee: parseAsString,
  page: parseAsInteger.withDefault(1),
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "—"
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1).replace(".", ",")} Mo`
  return `${Math.round(bytes / 1024)} Ko`
}

export function DocumentsView({
  firmSlug,
  page,
  summary,
  scoped,
}: {
  firmSlug: string
  page: Paged<DocumentGroup>
  summary: DocumentSummary
  scoped: boolean
}) {
  const router = useRouter()
  const [preview, setPreview] = React.useState<PreviewDocument | null>(null)
  const [params, setParams] = useQueryStates(searchParamsDef, {
    shallow: false,
    history: "push",
  })

  const urlSearch = params.q ?? ""
  const [search, setSearch] = React.useState({ draft: urlSearch, url: urlSearch })
  if (search.url !== urlSearch) setSearch({ draft: urlSearch, url: urlSearch })

  React.useEffect(() => {
    if (search.draft === urlSearch) return
    const timer = setTimeout(() => {
      void setParams({ q: search.draft || null, page: null })
    }, 300)
    return () => clearTimeout(timer)
  }, [search.draft, urlSearch, setParams])

  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())

  const toggleExpand = React.useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }, [])

  const now = React.useMemo(() => new Date(), [])

  /**
   * Two column sets over the same grid. The parent row summarises a person's
   * pieces — how many, the soonest expiry, how many still await verification —
   * and the child rows carry each piece. The employee, which was repeated on
   * every row before, is now written once.
   */
  const columns = React.useMemo<ColumnDef<DocumentGroup, unknown>[]>(
    () => [
      {
        id: "employee",
        header: "Employé",
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <Avatar
              initials={initials(row.original.employee.firstName, row.original.employee.lastName)}
            />
            <TwoFacts
              primary={
                <span className="font-medium">
                  {row.original.employee.firstName} {row.original.employee.lastName}
                </span>
              }
              secondary={<span className="mono">{row.original.employee.matricule}</span>}
            />
          </div>
        ),
      },
      {
        id: "type",
        header: "Pièce",
        cell: ({ row }) => {
          const count = row.original.documents.length
          return (
            <span className="text-ink-2">
              <span className="num font-medium text-ink">{formatNumber(count)}</span>{" "}
              {count > 1 ? "pièces" : "pièce"}
            </span>
          )
        },
      },
      {
        id: "size",
        header: "Taille",
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="num text-ink-3">{formatSize(row.original.totalSize || null)}</span>
        ),
      },
      {
        id: "expiry",
        header: "Expiration",
        cell: ({ row }) => {
          const { expired, nextExpiry } = row.original
          if (expired > 0) {
            return (
              <TwoFacts
                primary={<span className="text-alert">{formatDate(nextExpiry!)}</span>}
                secondary={
                  expired > 1 ? `${formatNumber(expired)} expirées` : "expirée"
                }
              />
            )
          }
          if (!nextExpiry) return <span className="text-ink-3">—</span>
          const soon = nextExpiry.getTime() - now.getTime() < 60 * 86_400_000
          return (
            <TwoFacts
              primary={
                <span className={soon ? "text-signal" : undefined}>
                  {formatDate(nextExpiry)}
                </span>
              }
              secondary={soon ? "expire bientôt" : undefined}
            />
          )
        },
      },
      {
        id: "verified",
        header: "Vérification",
        cell: ({ row }) => {
          const { unverified, documents } = row.original
          if (unverified === 0) return <StatusPill tone="ok">Vérifiées</StatusPill>
          return (
            <StatusPill tone="signal">
              {unverified === documents.length
                ? "En attente"
                : `${formatNumber(unverified)} en attente`}
            </StatusPill>
          )
        },
      },
      {
        id: "preview",
        header: "",
        meta: { align: "right" },
        cell: () => null,
      },
    ],
    [now]
  )

  /** One child row per piece, drawn on the parent's grid. */
  const renderSubRows = React.useCallback(
    (group: DocumentGroup) => (
      <>
        {group.documents.map((document, index) => (
          <DocumentSubRow
            key={document.id}
            document={document}
            firmSlug={firmSlug}
            now={now}
            last={index === group.documents.length - 1}
            onPreview={setPreview}
          />
        ))}
      </>
    ),
    [firmSlug, now]
  )

  const from = page.total === 0 ? 0 : (page.page - 1) * page.perPage + 1
  const to = Math.min(page.page * page.perPage, page.total)

  return (
    <Panel
      title="Pièces du personnel"
      description="Expirées et non vérifiées en premier."
      stats={[
        { label: "Pièces", value: formatNumber(summary.matching) },
        {
          label: "Expirées",
          value: formatNumber(summary.expired),
          tone: summary.expired > 0 ? "alert" : "default",
        },
        {
          label: "À vérifier",
          value: formatNumber(summary.unverified),
          tone: summary.unverified > 0 ? "signal" : "default",
        },
      ]}
      padded={false}
      footer={{
        summary: (
          <span className="num">
            {page.total === 0
              ? "Aucune pièce"
              : `${formatNumber(from)} – ${formatNumber(to)} sur ${formatNumber(page.total)} employés · ${formatNumber(summary.matching)} pièces`}
            {summary.expiring > 0
              ? ` · ${formatNumber(summary.expiring)} expirent sous 60 jours`
              : null}
            {scoped ? " · restreint à vos clients" : null}
          </span>
        ),
        action: (
          <Pager
            page={page.page}
            pageCount={page.pageCount}
            onChange={(next) => void setParams({ page: next })}
          />
        ),
      }}
    >
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-[15px] py-2.5">
        <div className="flex h-[29px] w-[222px] items-center gap-2 rounded-[7px] border border-line px-2.5">
          <HugeiconsIcon icon={Search01Icon} size={13} className="text-ink-3" />
          <input
            value={search.draft}
            onChange={(event) =>
              setSearch((current) => ({ ...current, draft: event.target.value }))
            }
            placeholder="Employé, matricule ou fichier…"
            aria-label="Rechercher une pièce"
            className="w-full border-none bg-transparent text-[12.5px] outline-none"
          />
        </div>

        <FacetFilter
          label="Type"
          options={page.facets.type ?? []}
          selected={params.type ?? []}
          onChange={(values) =>
            void setParams({ type: values.length ? values : null, page: null })
          }
        />
        <FacetFilter
          label="État"
          options={page.facets.flag ?? []}
          selected={params.flag ?? []}
          onChange={(values) =>
            void setParams({ flag: values.length ? values : null, page: null })
          }
        />

        {params.employee ? (
          <button
            type="button"
            onClick={() => void setParams({ employee: null, page: null })}
            className="inline-flex h-[29px] items-center gap-1.5 rounded-[7px] border border-brand bg-brand-wash px-2.5 text-[12.5px] font-medium text-brand"
          >
            Un seul employé · retirer
          </button>
        ) : null}
      </div>

      <DataTable
        data={page.rows}
        columns={columns}
        getRowId={(row) => row.employee.id}
        sorting={[]}
        onSortingChange={() => {}}
        onRowClick={(row) =>
          router.push(`/${firmSlug}/hr/employees/${row.employee.id}?tab=documents`)
        }
        expandedIds={expanded}
        onToggleExpand={toggleExpand}
        getSubRowCount={(row) => row.documents.length}
        renderSubRows={renderSubRows}
        label="Documents"
        empty={
          <EmptyState
            title="Aucune pièce"
            description="Aucun document ne correspond aux filtres."
          />
        }
      />

      <DocumentPreviewDialog
        document={preview}
        firmSlug={firmSlug}
        onClose={() => setPreview(null)}
      />
    </Panel>
  )
}

/**
 * A piece, under its employee. It borrows the parent's grid — the employee
 * column becomes the indented file line, so the eye reads down one column
 * rather than across a repeated name.
 */
function DocumentSubRow({
  document,
  firmSlug,
  now,
  last,
  onPreview,
}: {
  document: DocumentRow
  firmSlug: string
  now: Date
  last: boolean
  onPreview: (document: PreviewDocument) => void
}) {
  const router = useRouter()
  const expiry = document.expiryDate
  const expired = expiry ? expiry < now : false
  const soon =
    expiry && !expired ? expiry.getTime() - now.getTime() < 60 * 86_400_000 : false

  const cell = "px-2.5 text-[13px] align-middle h-[41px]"
  const rule = last ? "border-b border-line" : "border-b-0"

  return (
    <tr
      onClick={() =>
        router.push(`/${firmSlug}/hr/employees/${document.employee.id}?tab=documents`)
      }
      className="cursor-pointer bg-sunken/35 transition-colors hover:bg-brand-wash"
    >
      {/* The chevron gutter, left empty so children sit under their parent. */}
      <td className={cn("w-[34px] pl-[15px]", rule)} />

      <td className={cn(cell, rule)}>
        <div className="flex items-center gap-2.5 pl-[9px]">
          {/* A short elbow, drawn in the avatar's lane. */}
          <span aria-hidden className="h-px w-3.5 shrink-0 bg-line" />
          <TwoFacts
            primary={DOCUMENT_TYPE_LABELS[document.documentType] ?? document.documentType}
            secondary={document.fileName}
          />
        </div>
      </td>

      <td className={cn(cell, rule)} />

      <td className={cn(cell, rule, "num text-right")}>
        <span className="text-ink-2">{formatSize(document.fileSize)}</span>
      </td>

      <td className={cn(cell, rule)}>
        {!expiry ? (
          <span className="text-ink-3">—</span>
        ) : (
          <TwoFacts
            primary={
              <span className={expired ? "text-alert" : soon ? "text-signal" : undefined}>
                {formatDate(expiry)}
              </span>
            }
            secondary={expired ? "expirée" : soon ? "expire bientôt" : undefined}
          />
        )}
      </td>

      <td className={cn(cell, rule)}>
        {document.isVerified ? (
          <StatusPill tone="ok">Vérifiée</StatusPill>
        ) : (
          <StatusPill tone="signal">En attente</StatusPill>
        )}
      </td>

      <td className={cn(cell, rule, "pr-[15px] text-right")}>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={`Aperçu de ${document.fileName}`}
          title="Aperçu"
          // The row itself opens the employee record; this must not do both.
          onClick={(event) => {
            event.stopPropagation()
            onPreview(document)
          }}
          className="grid size-7 place-items-center rounded-[7px] text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
        >
          <HugeiconsIcon icon={EyeIcon} size={15} strokeWidth={1.8} />
        </button>
      </td>
    </tr>
  )
}
