/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * VirtualTableBody
 *
 * Virtualized <tbody> using native table elements.
 * Renders only visible rows with absolute positioning for performance.
 */

"use client";

import { memo, Fragment } from "react";
import { flexRender, type Row } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import type { VirtualizedRow } from "./hooks/use-virtualized-table";
import type { Section } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface VirtualTableBodyProps<TData, TSectionMeta = unknown> {
  /** Virtual rows to render */
  virtualRows: VirtualizedRow[];
  /** Total height of all rows */
  totalHeight: number;
  /** Get table row by virtual index */
  getTableRow: (index: number) => Row<TData> | undefined;
  /** Get item info by virtual index (for sections) */
  getItem: (index: number) => 
    | { type: "section"; section: Section<TData, TSectionMeta> }
    | { type: "row"; item: TData }
    | null;
  /** Number of columns (for section header colSpan) */
  columnCount: number;
  /** Row click handler */
  onRowClick?: (item: TData, index: number) => void;
  /** Selected row ID */
  selectedRowId?: string;
  /** Get row ID for comparison */
  getRowId?: (item: TData) => string;
  /** Custom row class name */
  rowClassName?: string | ((item: TData) => string);
  /** Render section header */
  renderSectionHeader?: (section: Section<TData, TSectionMeta>) => React.ReactNode;
}

// =============================================================================
// Component
// =============================================================================

function VirtualTableBodyInner<TData, TSectionMeta = unknown>({
  virtualRows,
  totalHeight,
  getTableRow,
  getItem,
  columnCount,
  onRowClick,
  selectedRowId,
  getRowId,
  rowClassName,
  renderSectionHeader,
}: VirtualTableBodyProps<TData, TSectionMeta>) {
  return (
    <tbody
      style={{
        height: totalHeight,
        position: "relative",
        display: "block",
      }}
    >
      {virtualRows.map((virtualRow) => {
        const item = getItem(virtualRow.index);
        
        if (!item) return null;
        
        // Section header row
        if (item.type === "section") {
          return (
            <tr
              key={virtualRow.key}
              data-section={item.section.id}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className="sticky bg-zinc-100 dark:bg-zinc-900"
            >
              <td colSpan={columnCount} className="px-0">
                {renderSectionHeader?.(item.section) ?? (
                  <div className="flex items-center gap-2 px-4 font-medium">
                    <span>{item.section.label}</span>
                    <span className="text-zinc-500 dark:text-zinc-400">
                      ({item.section.items.length})
                    </span>
                  </div>
                )}
              </td>
            </tr>
          );
        }
        
        // Data row
        const row = getTableRow(virtualRow.index);
        if (!row) return null;
        
        const rowData = item.item;
        const rowId = getRowId?.(rowData);
        const isSelected = selectedRowId && rowId === selectedRowId;
        
        const customClassName =
          typeof rowClassName === "function"
            ? rowClassName(rowData)
            : rowClassName;
        
        return (
          <tr
            key={virtualRow.key}
            data-row-id={rowId}
            aria-rowindex={virtualRow.index + 2} // +1 for header, +1 for 1-based
            onClick={onRowClick ? () => onRowClick(rowData, virtualRow.index) : undefined}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: virtualRow.size,
              transform: `translateY(${virtualRow.start}px)`,
              display: "flex",
            }}
            className={cn(
              "border-b border-zinc-200 dark:border-zinc-800",
              onRowClick && "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900",
              isSelected && "bg-zinc-100 dark:bg-zinc-800",
              customClassName,
            )}
          >
            {row.getVisibleCells().map((cell) => (
              <td
                key={cell.id}
                style={{
                  width: cell.column.getSize(),
                  minWidth: cell.column.getSize(),
                  maxWidth: cell.column.getSize(),
                }}
                className="flex items-center px-4"
              >
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        );
      })}
      
    </tbody>
  );
}

// Memo with generic support
export const VirtualTableBody = memo(VirtualTableBodyInner) as typeof VirtualTableBodyInner;
