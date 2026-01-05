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

import { memo } from "react";
import { flexRender, type Row } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import type { VirtualizedRow } from "./hooks/use-virtualized-table";
import type { Section } from "./types";
import { getColumnCSSValue } from "./utils/column-sizing";

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
  getItem: (
    index: number,
  ) => { type: "section"; section: Section<TData, TSectionMeta> } | { type: "row"; item: TData } | null;
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
  /** Get tabIndex for a row (roving tabindex pattern) */
  getRowTabIndex?: (index: number) => 0 | -1;
  /** Row focus handler */
  onRowFocus?: (index: number) => void;
  /** Row keydown handler */
  onRowKeyDown?: (e: React.KeyboardEvent, index: number) => void;
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
  getRowTabIndex,
  onRowFocus,
  onRowKeyDown,
}: VirtualTableBodyProps<TData, TSectionMeta>) {
  return (
    <tbody
      role="rowgroup"
      className="data-table-body"
      style={{ height: totalHeight }}
    >
      {virtualRows.map((virtualRow) => {
        const item = getItem(virtualRow.index);

        if (!item) return null;

        if (item.type === "section") {
          // Use index in key to guarantee uniqueness in virtualized list
          return (
            <tr
              key={`section-${virtualRow.index}`}
              role="row"
              aria-rowindex={virtualRow.index + 2}
              data-section={item.section.id}
              className="data-table-section-row sticky bg-zinc-100 dark:bg-zinc-900"
              style={{
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <td
                role="gridcell"
                colSpan={columnCount}
                className="px-0"
              >
                {renderSectionHeader?.(item.section) ?? (
                  <div className="flex items-center gap-2 px-4 font-medium">
                    <span>{item.section.label}</span>
                    <span className="text-zinc-500 dark:text-zinc-400">({item.section.items.length})</span>
                  </div>
                )}
              </td>
            </tr>
          );
        }

        const row = getTableRow(virtualRow.index);
        if (!row) return null;

        const rowData = item.item;
        const rowId = getRowId?.(rowData);
        const isSelected = selectedRowId && rowId === selectedRowId;

        const customClassName = typeof rowClassName === "function" ? rowClassName(rowData) : rowClassName;

        // Keyboard navigation support
        const tabIndex = getRowTabIndex?.(virtualRow.index) ?? (onRowClick ? 0 : undefined);

        // Use virtual index in key to guarantee uniqueness even with duplicate data
        return (
          <tr
            key={`row-${virtualRow.index}`}
            role="row"
            data-row-id={rowId}
            aria-rowindex={virtualRow.index + 2}
            aria-selected={isSelected ? true : undefined}
            tabIndex={tabIndex}
            onClick={onRowClick ? () => onRowClick(rowData, virtualRow.index) : undefined}
            onFocus={onRowFocus ? () => onRowFocus(virtualRow.index) : undefined}
            onKeyDown={onRowKeyDown ? (e) => onRowKeyDown(e, virtualRow.index) : undefined}
            className={cn(
              "data-table-row border-b border-zinc-200 dark:border-zinc-800",
              onRowClick && "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900",
              isSelected && "bg-zinc-100 dark:bg-zinc-800",
              customClassName,
            )}
            style={{
              height: virtualRow.size,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {row.getVisibleCells().map((cell, cellIndex) => (
              <td
                key={cell.id}
                role="gridcell"
                aria-colindex={cellIndex + 1}
                data-column-id={cell.column.id}
                style={{
                  width: getColumnCSSValue(cell.column.id),
                  minWidth: getColumnCSSValue(cell.column.id),
                  flexShrink: 0, // Prevent shrinking below specified width
                }}
                className="flex items-center overflow-hidden px-4"
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
