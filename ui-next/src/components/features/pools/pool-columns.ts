/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Pool Column Definitions
 *
 * Defines the columns for the pools table including:
 * - Width specifications (min/share for responsive layout)
 * - Sortability
 * - Visibility defaults
 */

import type { ColumnUserWidths } from "@/lib/stores";

// =============================================================================
// Column Width Types
// =============================================================================

/**
 * Column width specification.
 * - number: fixed width in pixels
 * - object: flexible width with min floor and share proportion
 */
export type ColumnWidth = number | { min: number; share: number };

// =============================================================================
// Column Definition
// =============================================================================

export interface PoolColumnDef {
  /** Unique column identifier */
  id: string;
  /** Header label */
  header: string;
  /** Menu label (for show/hide dropdown) */
  menuLabel?: string;
  /** Width specification */
  width: ColumnWidth;
  /** Is this column sortable? */
  sortable?: boolean;
  /** Is this column mandatory (can't be hidden)? */
  mandatory?: boolean;
  /** Default visibility */
  defaultVisible?: boolean;
  /** Column alignment */
  align?: "left" | "center" | "right";
}

// =============================================================================
// Column Definitions
// =============================================================================

export const POOL_COLUMNS: PoolColumnDef[] = [
  {
    id: "name",
    header: "Pool",
    menuLabel: "Pool Name",
    width: { min: 180, share: 2 },
    sortable: true,
    mandatory: true,
    defaultVisible: true,
    align: "left",
  },
  {
    id: "description",
    header: "Description",
    width: { min: 150, share: 2.5 },
    sortable: false,
    defaultVisible: true,
    align: "left",
  },
  {
    id: "quota",
    header: "Quota (GPU)",
    menuLabel: "GPU Quota",
    width: { min: 140, share: 1 },
    sortable: true,
    defaultVisible: true,
    align: "left",
  },
  {
    id: "capacity",
    header: "Capacity (GPU)",
    menuLabel: "GPU Capacity",
    width: { min: 150, share: 1 },
    sortable: true,
    defaultVisible: true,
    align: "left",
  },
  {
    id: "platforms",
    header: "Platforms",
    width: { min: 120, share: 1.5 },
    sortable: true,
    defaultVisible: true,
    align: "left",
  },
  {
    id: "backend",
    header: "Backend",
    width: { min: 80, share: 0 },
    sortable: true,
    defaultVisible: false,
    align: "left",
  },
];

// Pre-computed lookup map for O(1) access
export const POOL_COLUMN_MAP = new Map(POOL_COLUMNS.map((c) => [c.id, c]));

// Mandatory column IDs (can't be hidden or reordered)
export const MANDATORY_COLUMN_IDS = new Set(POOL_COLUMNS.filter((c) => c.mandatory).map((c) => c.id));

// Default visible column IDs
export const DEFAULT_VISIBLE_COLUMNS = POOL_COLUMNS.filter((c) => c.defaultVisible !== false).map((c) => c.id);

// Default column order
export const DEFAULT_COLUMN_ORDER = POOL_COLUMNS.map((c) => c.id);

// =============================================================================
// Grid Template Generation
// =============================================================================

/**
 * Cache for grid templates to avoid recomputation.
 */
const gridTemplateCache = new Map<string, string>();

/**
 * Generate CSS grid template from column definitions.
 * Respects user overrides for manual column resizing.
 *
 * @param visibleColumnIds - Currently visible columns
 * @param columnOrder - Current column order
 * @param userWidths - User overrides from manual resize
 */
export function getGridTemplate(
  visibleColumnIds: string[],
  columnOrder: string[],
  userWidths: ColumnUserWidths = {},
): string {
  // Build ordered visible columns
  const orderedColumns = columnOrder
    .filter((id) => visibleColumnIds.includes(id))
    .map((id) => POOL_COLUMN_MAP.get(id))
    .filter((col): col is PoolColumnDef => col !== undefined);

  // Create cache key
  const key = orderedColumns
    .map((c) => {
      const user = userWidths[c.id];
      return user ? `${c.id}:${user.value}:${user.mode}` : c.id;
    })
    .join(",");

  let cached = gridTemplateCache.get(key);
  if (cached) return cached;

  // Build template
  cached = orderedColumns
    .map((col) => {
      const user = userWidths[col.id];

      // User override exists
      if (user) {
        if (user.mode === "fixed") return `${user.value}px`;
        // min mode: user value as floor, share preserved
        const share = typeof col.width === "number" ? 0 : col.width.share;
        return share > 0 ? `minmax(${user.value}px, ${share}fr)` : `${user.value}px`;
      }

      // No override: use config
      if (typeof col.width === "number") return `${col.width}px`;
      return col.width.share > 0 ? `minmax(${col.width.min}px, ${col.width.share}fr)` : `${col.width.min}px`;
    })
    .join(" ");

  gridTemplateCache.set(key, cached);
  return cached;
}

/**
 * Calculate minimum table width based on column definitions.
 */
export function getMinTableWidth(visibleColumnIds: string[], columnOrder: string[]): number {
  const orderedColumns = columnOrder
    .filter((id) => visibleColumnIds.includes(id))
    .map((id) => POOL_COLUMN_MAP.get(id))
    .filter((col): col is PoolColumnDef => col !== undefined);

  return orderedColumns.reduce((sum, col) => {
    const min = typeof col.width === "number" ? col.width : col.width.min;
    return sum + min;
  }, 0);
}
