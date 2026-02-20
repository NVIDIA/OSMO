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

import { memo, useCallback, useRef } from "react";
import { flexRender, type Row } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import type { VirtualizedRow } from "@/components/data-table/hooks/use-virtualized-table";
import type { Section } from "@/components/data-table/types";
import { getColumnCSSValue } from "@/components/data-table/utils/column-sizing";
import { VirtualItemTypes } from "@/components/data-table/constants";

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
  /** Row double-click handler */
  onRowDoubleClick?: (item: TData, index: number) => void;
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
  onRowDoubleClick,
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
  /**
   * Stores the row item resolved at mousedown time (first click of a potential
   * double-click). Used as a fallback in handleTbodyDoubleClick when the
   * virtualizer has remounted rows between the first click and the dblclick
   * event (e.g. because opening a slideout panel narrowed the table).
   */
  const lastMouseDownItemRef = useRef<{ item: TData; index: number } | null>(null);

  /**
   * Resolve row data from a delegated event target.
   * Walks up the DOM to find the row element, parses its index,
   * and returns the row item if it's a data row (not a section header).
   */
  const resolveRowItem = useCallback(
    (target: HTMLElement): { item: TData; index: number } | null => {
      const row = target.closest<HTMLTableRowElement>('[role="row"][data-index]');
      if (!row) return null;
      const index = parseInt(row.dataset.index!, 10);
      const entry = getItem(index);
      if (!entry || entry.type !== VirtualItemTypes.ROW) return null;
      return { item: entry.item, index };
    },
    [getItem],
  );

  const handleTbodyClick = useCallback(
    (e: React.MouseEvent<HTMLTableSectionElement>) => {
      if (!onRowClick && !getRowHref) return;

      // When a double-click handler is registered, skip the second click
      // (detail >= 2) of a multi-click sequence. Without this guard the second
      // click fires onRowClick → startViewTransition a second time, and the
      // resulting document.startViewTransition competes with the one triggered
      // by the immediately-following dblclick event. The browser cannot
      // reliably run two overlapping view-transition update callbacks, so the
      // dblclick's router.push never executes.
      if (onRowDoubleClick && e.detail >= 2) return;

      const resolved = resolveRowItem(e.target as HTMLElement);
      if (!resolved) return;

      if (e.metaKey || e.ctrlKey) {
        const href = getRowHref?.(resolved.item);
        if (href) {
          window.open(href, "_blank", "noopener,noreferrer");
          return;
        }
      }

      onRowClick?.(resolved.item, resolved.index);
    },
    [onRowClick, onRowDoubleClick, getRowHref, resolveRowItem],
  );

  const handleTbodyFocus = useCallback(
    (e: React.FocusEvent<HTMLTableSectionElement>) => {
      if (!onRowFocus) return;
      const target = e.target as HTMLElement;
      if (target.getAttribute("role") === "row" && target.dataset.index) {
        const index = parseInt(target.dataset.index, 10);
        onRowFocus(index);
      }
    },
    [onRowFocus],
  );

  const handleTbodyKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTableSectionElement>) => {
      if (!onRowKeyDown) return;
      const target = e.target as HTMLElement;
      if (target.getAttribute("role") === "row" && target.dataset.index) {
        const index = parseInt(target.dataset.index, 10);
        onRowKeyDown(e, index);
      }
    },
    [onRowKeyDown],
  );

  const handleTbodyAuxClick = useCallback(
    (e: React.MouseEvent<HTMLTableSectionElement>) => {
      if (e.button !== 1) return;
      if (!onRowClick && !getRowHref) return;
      const resolved = resolveRowItem(e.target as HTMLElement);
      if (!resolved) return;

      const href = getRowHref?.(resolved.item);
      if (href) {
        window.open(href, "_blank", "noopener,noreferrer");
      } else {
        onRowClick?.(resolved.item, resolved.index);
      }
    },
    [onRowClick, getRowHref, resolveRowItem],
  );

  const handleTbodyMouseDown = useCallback(
    (e: React.MouseEvent<HTMLTableSectionElement>) => {
      if (!onRowDoubleClick) return;
      // Only capture on the first press of a potential double-click (detail=1).
      // This is used as a fallback in handleTbodyDoubleClick in case the
      // virtualizer remounts rows between the first click and the dblclick event.
      if (e.detail !== 1) return;
      lastMouseDownItemRef.current = resolveRowItem(e.target as HTMLElement);
    },
    [onRowDoubleClick, resolveRowItem],
  );

  const handleTbodyDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLTableSectionElement>) => {
      if (!onRowDoubleClick) return;
      // Fall back to the item captured at mousedown if the target element is no
      // longer in the DOM (e.g. virtualizer remounted rows while panel opened).
      const resolved = resolveRowItem(e.target as HTMLElement) ?? lastMouseDownItemRef.current;
      if (!resolved) return;
      onRowDoubleClick(resolved.item, resolved.index);
    },
    [onRowDoubleClick, resolveRowItem],
  );

  return (
    <tbody
      role="rowgroup"
      className="data-table-body"
      style={{ height: totalHeight }}
      onMouseDown={onRowDoubleClick ? handleTbodyMouseDown : undefined}
      onClick={handleTbodyClick}
      onDoubleClick={onRowDoubleClick ? handleTbodyDoubleClick : undefined}
      onAuxClick={onRowClick || getRowHref ? handleTbodyAuxClick : undefined}
      onFocus={handleTbodyFocus}
      onKeyDown={handleTbodyKeyDown}
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
