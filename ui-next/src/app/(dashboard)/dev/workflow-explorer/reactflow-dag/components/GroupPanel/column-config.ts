// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Column Configuration
 *
 * Defines table column structure, widths, and default visibility.
 * Uses flexible widths with min/share for responsive layouts.
 */

import type { ColumnDef, OptionalColumnDef, ColumnId, ColumnWidth } from "../../types/table";

// ============================================================================
// Column Definitions
// ============================================================================

/**
 * Mandatory columns that are always visible.
 */
export const MANDATORY_COLUMNS: ColumnDef[] = [
  { id: "status", label: "", menuLabel: "Status", width: 24, align: "left", sortable: true },
  // Name: highest priority (share: 2.8) - gets more flexible space
  { id: "name", label: "Name", menuLabel: "Name", width: { min: 150, share: 2.8 }, align: "left", sortable: true },
];

/**
 * Optional columns that can be toggled by the user.
 */
export const OPTIONAL_COLUMNS: OptionalColumnDef[] = [
  { id: "duration", label: "Duration", menuLabel: "Duration", width: { min: 70, share: 0.8 }, align: "right", sortable: true, defaultVisible: true },
  { id: "node", label: "Node", menuLabel: "Node Name", width: { min: 80, share: 1.2 }, align: "left", sortable: true, defaultVisible: true },
  { id: "podIp", label: "IP", menuLabel: "IP", width: { min: 95, share: 0.5 }, align: "left", sortable: true, defaultVisible: false },
  { id: "exitCode", label: "Exit", menuLabel: "Exit Code", width: 55, align: "right", sortable: true, defaultVisible: false },
  { id: "startTime", label: "Start", menuLabel: "Start Time", width: { min: 85, share: 0.8 }, align: "right", sortable: true, defaultVisible: false },
  { id: "endTime", label: "End", menuLabel: "End Time", width: { min: 85, share: 0.8 }, align: "right", sortable: true, defaultVisible: false },
  { id: "retry", label: "Retry", menuLabel: "Retry ID", width: 60, align: "right", sortable: true, defaultVisible: false },
];

/**
 * Alphabetically sorted column list for stable menu order.
 */
export const OPTIONAL_COLUMNS_ALPHABETICAL = [...OPTIONAL_COLUMNS].sort((a, b) => 
  a.menuLabel.localeCompare(b.menuLabel)
);

/**
 * All columns combined.
 */
export const ALL_COLUMNS: ColumnDef[] = [
  ...MANDATORY_COLUMNS,
  ...OPTIONAL_COLUMNS.map(({ defaultVisible, ...rest }) => rest),
];

/**
 * Default visible optional column IDs.
 */
export const DEFAULT_VISIBLE_OPTIONAL: ColumnId[] = OPTIONAL_COLUMNS
  .filter((c) => c.defaultVisible)
  .map((c) => c.id);

/**
 * Pre-computed column lookup maps for O(1) access.
 */
export const COLUMN_MAP = new Map(ALL_COLUMNS.map((c) => [c.id, c]));
export const OPTIONAL_COLUMN_MAP = new Map(OPTIONAL_COLUMNS.map((c) => [c.id, c]));

// ============================================================================
// Grid Template Utilities
// ============================================================================

const gridTemplateCache = new Map<string, string>();
const minWidthCache = new Map<string, number>();

/**
 * Generate CSS grid template from column definitions.
 * Uses fr units for flexible columns to guarantee alignment.
 *
 * @param columns - Array of column definitions
 * @returns CSS grid-template-columns value
 */
export function getGridTemplate(columns: ColumnDef[]): string {
  const key = columns.map((c) => c.id).join(",");
  let cached = gridTemplateCache.get(key);
  if (cached) return cached;

  cached = columns
    .map((col) => {
      if (typeof col.width === "number") return `${col.width}px`;
      // Use minmax with fr units for guaranteed alignment
      return `minmax(${col.width.min}px, ${col.width.share}fr)`;
    })
    .join(" ");

  gridTemplateCache.set(key, cached);
  return cached;
}

/**
 * Calculate minimum table width from column definitions.
 *
 * @param columns - Array of column definitions
 * @returns Minimum width in pixels
 */
export function getMinTableWidth(columns: ColumnDef[]): number {
  const key = columns.map((c) => c.id).join(",");
  let cached = minWidthCache.get(key);
  if (cached) return cached;

  const fixedWidth = columns.reduce((sum, col) => {
    if (typeof col.width === "number") return sum + col.width;
    return sum + col.width.min;
  }, 0);
  // Add gap spacing (24px per gap) + padding
  cached = fixedWidth + (columns.length - 1) * 24 + 24;

  minWidthCache.set(key, cached);
  return cached;
}
