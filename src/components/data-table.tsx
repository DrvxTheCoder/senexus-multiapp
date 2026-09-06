"use client"

import * as React from "react"
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowData,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons"

import { cn } from "@/lib/utils"

/**
 * §4.7 + §3.6 — the table.
 *
 * TanStack Table in **manual** mode: it owns column definitions, header and
 * cell rendering, and column visibility, and nothing else. Sorting, filtering
 * and pagination are the server's job — `getSortedRowModel` and friends are
 * deliberately absent, so it is structurally impossible for a page of 50 rows
 * to be re-sorted in the browser and disagree with the 932 behind it.
 *
 * Sorting state lives in the URL, so a sorted table is a shareable link.
 *
 * Rows can expand (`renderSubRows`), which is how a list that repeats one
 * parent across many rows collapses into one row per parent. Expansion state
 * is the caller's, like sorting and selection.
 *
 * Conventions from the prototype: sticky header, 45px rows, hairline
 * separators, hover tint, selected tint.
 */

export type DataTableProps<TData> = {
  data: TData[]
  columns: ColumnDef<TData, unknown>[]
  /** Stable row id, used for selection across pages. */
  getRowId: (row: TData) => string
  sorting: SortingState
  onSortingChange: (sorting: SortingState) => void
  columnVisibility?: VisibilityState
  onColumnVisibilityChange?: (visibility: VisibilityState) => void
  selectedIds?: Set<string>
  onToggleRow?: (id: string) => void
  onRowClick?: (row: TData) => void
  /** Accessible name for the table. */
  label: string
  empty?: React.ReactNode
  /**
   * Expandable rows. `renderSubRows` draws whatever hangs under an open row —
   * it returns the `<tr>`s itself, so a child row can use the parent's columns
   * or ignore them. Rows are open when `expandedIds` holds their id; a row is
   * only expandable when `getSubRowCount` reports more than zero.
   */
  expandedIds?: Set<string>
  onToggleExpand?: (id: string) => void
  getSubRowCount?: (row: TData) => number
  renderSubRows?: (row: TData) => React.ReactNode
}

export function DataTable<TData>({
  data,
  columns,
  getRowId,
  sorting,
  onSortingChange,
  columnVisibility,
  onColumnVisibilityChange,
  selectedIds,
  onRowClick,
  label,
  empty,
  expandedIds,
  onToggleExpand,
  getSubRowCount,
  renderSubRows,
}: DataTableProps<TData>) {
  const table = useReactTable({
    data,
    columns,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    state: {
      sorting,
      ...(columnVisibility ? { columnVisibility } : {}),
    },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater
      onSortingChange(next)
    },
    onColumnVisibilityChange: onColumnVisibilityChange
      ? (updater) => {
          const current = columnVisibility ?? {}
          const next = typeof updater === "function" ? updater(current) : updater
          onColumnVisibilityChange(next)
        }
      : undefined,
  })

  const rows = table.getRowModel().rows
  const expandable = Boolean(renderSubRows)

  if (rows.length === 0 && empty) {
    return <>{empty}</>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0" aria-label={label}>
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {expandable ? (
                <th
                  scope="col"
                  // The chevron gutter: labelled for screen readers, blank on screen.
                  className="sticky top-0 z-2 h-[33px] w-[34px] border-y border-line bg-sub pl-[15px]"
                >
                  <span className="sr-only">Déplier</span>
                </th>
              ) : null}
              {headerGroup.headers.map((header) => {
                const sortable = header.column.getCanSort()
                const direction = header.column.getIsSorted()
                const align = header.column.columnDef.meta?.align ?? "left"

                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={
                      !sortable
                        ? undefined
                        : direction === "asc"
                          ? "ascending"
                          : direction === "desc"
                            ? "descending"
                            : "none"
                    }
                    style={{ width: header.column.columnDef.meta?.width }}
                    className={cn(
                      "sticky top-0 z-2 h-[33px] border-y border-line bg-sub px-2.5 text-[11.5px] font-medium whitespace-nowrap text-ink-3",
                      align === "right" ? "text-right" : "text-left",
                      expandable ? "last:pr-[15px]" : "first:pl-[15px] last:pr-[15px]"
                    )}
                  >
                    {header.isPlaceholder ? null : sortable ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn(
                          "inline-flex items-center gap-1 hover:text-ink",
                          align === "right" && "flex-row-reverse"
                        )}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {direction ? (
                          <HugeiconsIcon
                            icon={ArrowDown01Icon}
                            size={11}
                            className={cn("text-brand", direction === "asc" && "rotate-180")}
                          />
                        ) : null}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>

        <tbody>
          {rows.map((row) => {
            const id = getRowId(row.original)
            const selected = selectedIds?.has(id) ?? false
            const subRowCount = getSubRowCount?.(row.original) ?? 0
            const canExpand = expandable && subRowCount > 0
            const isExpanded = canExpand && (expandedIds?.has(id) ?? false)

            return (
              <React.Fragment key={row.id}>
                <tr
                  data-selected={selected ? "1" : "0"}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={cn(
                    "transition-colors",
                    onRowClick && "cursor-pointer",
                    selected ? "bg-brand-tint" : "hover:bg-brand-wash"
                  )}
                >
                  {expandable ? (
                    <td
                      className={cn(
                        "h-row w-[34px] pl-[15px]",
                        // An open group reads as one block: no rule under its head.
                        isExpanded ? "border-b-0" : "border-b border-line"
                      )}
                    >
                      {canExpand ? (
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          aria-label={
                            isExpanded
                              ? `Replier (${subRowCount})`
                              : `Déplier (${subRowCount})`
                          }
                          // The row itself navigates; expanding must not do both.
                          onClick={(event) => {
                            event.stopPropagation()
                            onToggleExpand?.(id)
                          }}
                          className="grid size-[22px] place-items-center rounded-[6px] text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
                        >
                          <HugeiconsIcon
                            icon={ArrowRight01Icon}
                            size={14}
                            strokeWidth={1.8}
                            className={cn("transition-transform", isExpanded && "rotate-90")}
                          />
                        </button>
                      ) : null}
                    </td>
                  ) : null}

                  {row.getVisibleCells().map((cell) => {
                    const align = cell.column.columnDef.meta?.align ?? "left"
                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          "h-row px-2.5 text-[13px] last:pr-[15px]",
                          isExpanded ? "border-b-0" : "border-b border-line",
                          !expandable && "first:pl-[15px]",
                          align === "right" && "num text-right"
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    )
                  })}
                </tr>

                {isExpanded ? renderSubRows?.(row.original) : null}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

declare module "@tanstack/react-table" {
  /* eslint-disable @typescript-eslint/no-unused-vars -- the augmentation must
     repeat TanStack's generic parameters even though only the members matter. */
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: "left" | "right"
    width?: number | string
    /** Human label for the column-visibility menu. */
    label?: string
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
}
