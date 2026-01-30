/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
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
import { VirtualItemTypes } from "./constants";

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
  /**
   * Get the href for a row (if clicking navigates to a page).
   * Used for middle-click behavior:
   * - If getRowHref returns a URL → middle-click opens in new tab
   * - If getRowHref returns undefined or is not provided → middle-click calls onRowClick (shows overlay)
   */
  getRowHref?: (item: TData) => string | undefined;
  /** Selected row ID */
  selectedRowId?: string;
  /** Get row ID for comparison */
  getRowId?: (item: TData) => string;
  /** Custom row class name */
  rowClassName?: string | ((item: TData) => string);
  /** Custom section row class name (for zebra striping, borders, etc.) */
  sectionClassName?: string | ((section: Section<TData, TSectionMeta>) => string);
  /** Render custom section header */
  renderSectionHeader?: (section: Section<TData, TSectionMeta>) => React.ReactNode;
  /** Get tabIndex for a row (roving tabindex pattern) */
  getRowTabIndex?: (index: number) => 0 | -1;
  /** Row focus handler */
  onRowFocus?: (index: number) => void;
  /** Row keydown handler */
  onRowKeyDown?: (e: React.KeyboardEvent, index: number) => void;
  /** Ref callback for dynamic row measurement */
  measureElement?: (node: Element | null) => void;
  /** Compact mode - reduces cell padding */
  compact?: boolean;
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
  getRowHref,
  selectedRowId,
  getRowId,
  rowClassName,
  sectionClassName,
  renderSectionHeader,
  getRowTabIndex,
  onRowFocus,
  onRowKeyDown,
  measureElement,
  compact = false,
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

        if (item.type === VirtualItemTypes.SECTION) {
          // Render section header content
          const sectionContent = renderSectionHeader ? (
            renderSectionHeader(item.section)
          ) : (
            <td
              role="gridcell"
              colSpan={columnCount}
              className="px-0"
            >
              <div className="flex items-center gap-2 px-4 font-medium">
                <span>{item.section.label}</span>
                <span className="text-zinc-500 dark:text-zinc-400">({item.section.items.length})</span>
              </div>
            </td>
          );

          // Skip rendering entire row if renderSectionHeader returns null
          // (e.g., for single-task groups that don't need a section header)
          if (sectionContent === null) {
            return null;
          }

          // Calculate custom class name for section row (zebra striping, borders)
          const customSectionClassName =
            typeof sectionClassName === "function" ? sectionClassName(item.section) : sectionClassName;

          // Use index in key to guarantee uniqueness in virtualized list
          return (
            <tr
              key={`section-${virtualRow.index}`}
              role="row"
              aria-rowindex={virtualRow.index + 2}
              data-section={item.section.id}
              className={cn("data-table-section-row sticky", customSectionClassName)}
              style={{
                height: virtualRow.size,
                // translate3d triggers GPU compositor layer for smoother animation
                transform: `translate3d(0, ${virtualRow.start}px, 0)`,
              }}
            >
              {sectionContent}
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

        // Middle-click handler:
        // - If row has an href (navigates to page) → open in new tab
        // - If no href (shows overlay) → call onRowClick
        const handleAuxClick = (e: React.MouseEvent) => {
          // Only handle middle-click (button === 1)
          if (e.button !== 1) return;

          const href = getRowHref?.(rowData);
          if (href) {
            // Row navigates to a page → open in new tab
            window.open(href, "_blank", "noopener,noreferrer");
          } else if (onRowClick) {
            // Row shows overlay → trigger normal click behavior
            onRowClick(rowData, virtualRow.index);
          }
        };

        // Use virtual index in key to guarantee uniqueness even with duplicate data
        return (
          <tr
            key={`row-${virtualRow.index}`}
            ref={measureElement}
            data-index={virtualRow.index}
            role="row"
            data-row-id={rowId}
            aria-rowindex={virtualRow.index + 2}
            aria-selected={isSelected ? true : undefined}
            tabIndex={tabIndex}
            onClick={onRowClick ? () => onRowClick(rowData, virtualRow.index) : undefined}
            onAuxClick={onRowClick || getRowHref ? handleAuxClick : undefined}
            onFocus={onRowFocus ? () => onRowFocus(virtualRow.index) : undefined}
            onKeyDown={onRowKeyDown ? (e) => onRowKeyDown(e, virtualRow.index) : undefined}
            className={cn(
              "data-table-row border-b border-zinc-200 dark:border-zinc-800",
              onRowClick && "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900",
              isSelected && "bg-zinc-100 dark:bg-zinc-800",
              customClassName,
            )}
            style={{
              // translate3d triggers GPU compositor layer for smoother animation
              transform: `translate3d(0, ${virtualRow.start}px, 0)`,
            }}
          >
            {row.getVisibleCells().map((cell, cellIndex) => {
              // Cache CSS variable string to avoid duplicate function calls
              const cssWidth = getColumnCSSValue(cell.column.id);

              // Get cell className from column meta (if provided).
              // This allows columns to inject their styling requirements
              // without VirtualTableBody needing specific knowledge of column types.
              const cellClassName = cell.column.columnDef.meta?.cellClassName;

              return (
                <td
                  key={cell.id}
                  role="gridcell"
                  aria-colindex={cellIndex + 1}
                  data-column-id={cell.column.id}
                  style={{
                    width: cssWidth,
                    minWidth: cssWidth,
                    flexShrink: 0, // Prevent shrinking below specified width
                  }}
                  className={cn(
                    "flex items-center",
                    // Use custom className if provided, otherwise apply default padding
                    cellClassName ?? (compact ? "px-4 py-1.5" : "px-4 py-3"),
                  )}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              );
            })}
          </tr>
        );
      })}
    </tbody>
  );
}

// Memo with generic support
export const VirtualTableBody = memo(VirtualTableBodyInner) as typeof VirtualTableBodyInner;
