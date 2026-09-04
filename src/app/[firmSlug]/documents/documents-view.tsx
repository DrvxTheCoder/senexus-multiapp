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
import { Search01Icon } from "@hugeicons/core-free-icons"

import { DataTable } from "@/components/data-table"
import { FacetFilter } from "@/components/filters/facet-filter"
import { Pager } from "@/components/list-controls"
import { Panel } from "@/components/panel"
import { Avatar, EmptyState, StatusPill, TwoFacts } from "@/components/primitives"
import { formatDate, formatNumber, initials } from "@/lib/format"
import type { DocumentRow, DocumentSummary } from "@/server/queries/documents"
import type { Paged } from "@/server/queries/types"

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
  page: Paged<DocumentRow>
  summary: DocumentSummary
  scoped: boolean
}) {
  const router = useRouter()
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

  const now = new Date()

  const columns = React.useMemo<ColumnDef<DocumentRow, unknown>[]>(
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
        cell: ({ row }) => (
          <TwoFacts
            primary={TYPE_LABELS[row.original.documentType] ?? row.original.documentType}
            secondary={row.original.fileName}
          />
        ),
      },
      {
        id: "size",
        header: "Taille",
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="num text-ink-2">{formatSize(row.original.fileSize)}</span>
        ),
      },
      {
        id: "expiry",
        header: "Expiration",
        cell: ({ row }) => {
          const expiry = row.original.expiryDate
          if (!expiry) return <span className="text-ink-3">—</span>
          const expired = expiry < now
          const soon = !expired && expiry.getTime() - now.getTime() < 60 * 86_400_000
          return (
            <TwoFacts
              primary={
                <span
                  className={
                    expired ? "text-alert" : soon ? "text-signal" : undefined
                  }
                >
                  {formatDate(expiry)}
                </span>
              }
              secondary={expired ? "expirée" : soon ? "expire bientôt" : undefined}
            />
          )
        },
      },
      {
        id: "verified",
        header: "Vérification",
        cell: ({ row }) =>
          row.original.isVerified ? (
            <StatusPill tone="ok">Vérifiée</StatusPill>
          ) : (
            <StatusPill tone="signal">En attente</StatusPill>
          ),
      },
    ],
    [now]
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
              : `${formatNumber(from)} – ${formatNumber(to)} sur ${formatNumber(page.total)} pièces`}
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
        getRowId={(row) => row.id}
        sorting={[]}
        onSortingChange={() => {}}
        onRowClick={(row) =>
          router.push(`/${firmSlug}/hr/employees/${row.employee.id}?tab=documents`)
        }
        label="Documents"
        empty={
          <EmptyState
            title="Aucune pièce"
            description="Aucun document ne correspond aux filtres."
          />
        }
      />
    </Panel>
  )
}
