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
 * SectionedTableBody
 *
 * Non-virtualized <tbody> that supports CSS sticky section headers.
 * Use this instead of VirtualTableBody for small datasets (<100 items)
 * that need sticky section headers during scrolling.
 *
 * Key differences from VirtualTableBody:
 * - Renders ALL rows (no virtualization) - for small datasets only
 * - Uses normal document flow (no absolute positioning)
 * - Enables CSS position: sticky for section headers
 * - Section headers stack at the top as you scroll
 */

"use client";

import { memo } from "react";
import { flexRender, type Row } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import type { Section } from "./types";
import { getColumnCSSValue } from "./utils/column-sizing";

// =============================================================================
// Types
// =============================================================================

export interface SectionedTableBodyProps<TData, TSectionMeta = unknown> {
  /** Sections with items */
  sections: Section<TData, TSectionMeta>[];
  /** Get TanStack table row for an item */
  getTableRow: (item: TData) => Row<TData> | undefined;
  /** Number of columns (for section header colSpan) */
  columnCount: number;
  /** Row height in pixels */
  rowHeight: number;
  /** Section header height in pixels */
  sectionHeight: number;
  /** Header height in pixels (for sticky top calculation) */
  headerHeight: number;
  /** Row click handler */
  onRowClick?: (item: TData, index: number) => void;
  /** Selected row ID */
  selectedRowId?: string;
  /** Get row ID for comparison */
  getRowId?: (item: TData) => string;
  /** Custom row class name */
  rowClassName?: string | ((item: TData) => string);
  /** Render section header */
  renderSectionHeader?: (
    section: Section<TData, TSectionMeta>,
    sectionIndex: number,
    stickyTop: number,
  ) => React.ReactNode;
  /** CSS class for section row */
  sectionRowClassName?: string | ((section: Section<TData, TSectionMeta>, sectionIndex: number) => string);
}

// =============================================================================
// Default Section Header
// =============================================================================

function DefaultSectionHeader<TData>({
  section,
  columnCount,
  sectionHeight,
}: {
  section: Section<TData, unknown>;
  columnCount: number;
  sectionHeight: number;
}) {
  return (
    <td
      role="gridcell"
      colSpan={columnCount}
      className="px-0"
    >
      <div
        className="flex items-center gap-2 px-4 text-xs font-medium tracking-wider uppercase"
        style={{ height: sectionHeight }}
      >
        <span>{section.label}</span>
        <span className="text-zinc-500 dark:text-zinc-400">({section.items.length})</span>
      </div>
    </td>
  );
}

// =============================================================================
// Component
// =============================================================================

function SectionedTableBodyInner<TData, TSectionMeta = unknown>({
  sections,
  getTableRow,
  columnCount,
  rowHeight,
  sectionHeight,
  headerHeight,
  onRowClick,
  selectedRowId,
  getRowId,
  rowClassName,
  renderSectionHeader,
  sectionRowClassName,
}: SectionedTableBodyProps<TData, TSectionMeta>) {
  const globalRowIndex = 0;

  return (
    <tbody role="rowgroup">
      {sections.map((section, sectionIndex) => {
        // Calculate sticky top for this section header
        // Section 0: sticks at headerHeight
        // Section 1: sticks at headerHeight + sectionHeight
        // Section 2: sticks at headerHeight + sectionHeight * 2
        const stickyTop = headerHeight + sectionIndex * sectionHeight;

        // Get section row class
        const sectionClass =
          typeof sectionRowClassName === "function" ? sectionRowClassName(section, sectionIndex) : sectionRowClassName;

        return (
          <SectionGroup<TData, TSectionMeta>
            key={section.id}
            section={section}
            sectionIndex={sectionIndex}
            stickyTop={stickyTop}
            columnCount={columnCount}
            rowHeight={rowHeight}
            sectionHeight={sectionHeight}
            getTableRow={getTableRow}
            onRowClick={onRowClick}
            selectedRowId={selectedRowId}
            getRowId={getRowId}
            rowClassName={rowClassName}
            renderSectionHeader={renderSectionHeader}
            sectionRowClassName={sectionClass}
            startRowIndex={globalRowIndex}
          />
        );

        // Note: We can't update globalRowIndex inside map since we return early
        // The startRowIndex is used for aria-rowindex
      })}
    </tbody>
  );
}

// =============================================================================
// Section Group Component (for memo optimization)
// =============================================================================

interface SectionGroupProps<TData, TSectionMeta> {
  section: Section<TData, TSectionMeta>;
  sectionIndex: number;
  stickyTop: number;
  columnCount: number;
  rowHeight: number;
  sectionHeight: number;
  getTableRow: (item: TData) => Row<TData> | undefined;
  onRowClick?: (item: TData, index: number) => void;
  selectedRowId?: string;
  getRowId?: (item: TData) => string;
  rowClassName?: string | ((item: TData) => string);
  renderSectionHeader?: (
    section: Section<TData, TSectionMeta>,
    sectionIndex: number,
    stickyTop: number,
  ) => React.ReactNode;
  sectionRowClassName?: string;
  startRowIndex: number;
}

function SectionGroupInner<TData, TSectionMeta>({
  section,
  sectionIndex,
  stickyTop,
  columnCount,
  rowHeight,
  sectionHeight,
  getTableRow,
  onRowClick,
  selectedRowId,
  getRowId,
  rowClassName,
  renderSectionHeader,
  sectionRowClassName,
  startRowIndex,
}: SectionGroupProps<TData, TSectionMeta>) {
  // Z-index: earlier sections have higher z-index so they stay on top when stacked
  const zIndex = 10 + (10 - sectionIndex);

  return (
    <>
      {/* Section Header Row */}
      <tr
        role="row"
        aria-rowindex={startRowIndex + 2}
        data-section={section.id}
        data-section-index={sectionIndex}
        className={cn("sectioned-table-section-row", sectionRowClassName)}
        style={{
          position: "sticky",
          top: stickyTop,
          zIndex,
          height: sectionHeight,
        }}
      >
        {renderSectionHeader ? (
          renderSectionHeader(section, sectionIndex, stickyTop)
        ) : (
          <DefaultSectionHeader
            section={section}
            columnCount={columnCount}
            sectionHeight={sectionHeight}
          />
        )}
      </tr>

      {/* Data Rows */}
      {section.items.map((item, itemIndex) => {
        const row = getTableRow(item);
        if (!row) return null;

        const rowId = getRowId?.(item);
        const isSelected = selectedRowId && rowId === selectedRowId;
        const globalIndex = startRowIndex + itemIndex;

        const customClassName = typeof rowClassName === "function" ? rowClassName(item) : rowClassName;

        return (
          <tr
            key={rowId ?? globalIndex}
            role="row"
            data-row-id={rowId}
            aria-rowindex={globalIndex + 2}
            aria-selected={isSelected ? true : undefined}
            onClick={onRowClick ? () => onRowClick(item, globalIndex) : undefined}
            className={cn(
              "sectioned-table-row border-b border-zinc-200 dark:border-zinc-800",
              onRowClick && "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900",
              isSelected && "bg-zinc-100 dark:bg-zinc-800",
              customClassName,
            )}
            style={{ height: rowHeight }}
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
                }}
                className="overflow-hidden px-4"
              >
                <div
                  className="flex items-center overflow-hidden"
                  style={{ height: rowHeight }}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
              </td>
            ))}
          </tr>
        );
      })}
    </>
  );
}

const SectionGroup = memo(SectionGroupInner) as typeof SectionGroupInner;

// Memo with generic support
export const SectionedTableBody = memo(SectionedTableBodyInner) as typeof SectionedTableBodyInner;
