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
import { ArrowDown01Icon } from "@hugeicons/core-free-icons"

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

  if (rows.length === 0 && empty) {
    return <>{empty}</>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0" aria-label={label}>
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
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
                      "first:pl-[15px] last:pr-[15px]"
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

            return (
              <tr
                key={row.id}
                data-selected={selected ? "1" : "0"}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                className={cn(
                  "transition-colors",
                  onRowClick && "cursor-pointer",
                  selected ? "bg-brand-tint" : "hover:bg-brand-wash"
                )}
              >
                {row.getVisibleCells().map((cell) => {
                  const align = cell.column.columnDef.meta?.align ?? "left"
                  return (
                    <td
                      key={cell.id}
                      className={cn(
                        "h-row border-b border-line px-2.5 text-[13px] first:pl-[15px] last:pr-[15px]",
                        align === "right" && "num text-right"
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  )
                })}
              </tr>
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
