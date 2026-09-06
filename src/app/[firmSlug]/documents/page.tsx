import type { Metadata } from "next"
import { Suspense } from "react"

import { DocumentsView } from "@/app/[firmSlug]/documents/documents-view"
import { Panel } from "@/components/panel"
import { TableSkeleton } from "@/components/primitives"
import { TopBar } from "@/components/shell/top-bar"
import { requireFirmPage } from "@/server/auth/firm-page"
import {
  documentQuerySchema,
  documentSummary,
  listDocuments,
} from "@/server/queries/documents"
import { isScoped } from "@/server/queries/scope"

export const metadata: Metadata = { title: "Documents" }

/**
 * Documents is its own module (Q4): its route lives at the firm root rather
 * than under /hr, it has its own nav entry, and it can be switched off for a
 * firm independently — while `EmployeeDocument.employeeId` keeps binding each
 * piece to a person.
 */
export default async function DocumentsPage({
  params,
  searchParams,
}: PageProps<"/[firmSlug]/documents">) {
  const { firmSlug } = await params
  const ctx = await requireFirmPage(firmSlug, { module: "documents" })
  const raw = await searchParams

  return (
    <>
      <TopBar
        homeHref={`/${firmSlug}/dashboard`}
        crumbs={[
          { label: ctx.firm.name, href: `/${firmSlug}/dashboard` },
          { label: "Documents" },
        ]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className=" p-4.5">
          <div className="mb-3.5 flex items-center gap-3">
            <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.022em]">
              Documents
            </h1>
          </div>

          <Suspense fallback={<DocumentsSkeleton />}>
            <DocumentsPanel firmSlug={firmSlug} raw={raw} />
          </Suspense>
        </div>
      </div>
    </>
  )
}

async function DocumentsPanel({
  firmSlug,
  raw,
}: {
  firmSlug: string
  raw: Awaited<PageProps<"/[firmSlug]/documents">["searchParams"]>
}) {
  const ctx = await requireFirmPage(firmSlug, { module: "documents" })

  const query = documentQuerySchema.parse({
    search: typeof raw.q === "string" ? raw.q : undefined,
    type: typeof raw.type === "string" ? raw.type.split(",") : undefined,
    flag: typeof raw.flag === "string" ? raw.flag.split(",") : undefined,
    employeeId: typeof raw.employee === "string" ? raw.employee : undefined,
    page: typeof raw.page === "string" ? Number(raw.page) : 1,
  })

  const [page, summary] = await Promise.all([
    listDocuments(query, ctx),
    documentSummary(query, ctx),
  ])

  return (
    <DocumentsView
      firmSlug={firmSlug}
      page={page}
      summary={summary}
      scoped={isScoped(ctx)}
    />
  )
}

function DocumentsSkeleton() {
  return (
    <Panel
      title="Pièces du personnel"
      description="Expirées et non vérifiées en premier."
      padded={false}
      footer={{ summary: "Chargement…" }}
    >
      <div className="h-[49px] border-b border-line" />
      {/* Leading 3% stands in for the chevron gutter the grouped table adds. */}
      <TableSkeleton rows={12} columns={[3, 24, 16, 13, 14, 12]} />
    </Panel>
  )
}
