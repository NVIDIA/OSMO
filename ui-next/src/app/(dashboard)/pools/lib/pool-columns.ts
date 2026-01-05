/**
 * Copyright (c) 2025-2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

import type { ColumnDef, OptionalColumnDef } from "@/lib/table";
import { COLUMN_MIN_WIDTHS_REM, COLUMN_FLEX } from "@/lib/table-columns";
import type { ColumnSizeConfig } from "@/components/data-table";

// =============================================================================
// Column IDs
// =============================================================================

export type PoolColumnId = "name" | "status" | "description" | "quota" | "capacity" | "platforms" | "backend";

/** Set of all valid pool column IDs for type validation */
const VALID_COLUMN_IDS = new Set<string>([
  "name", "status", "description", "quota", "capacity", "platforms", "backend",
]);

/** Type guard to check if a string is a valid PoolColumnId */
export function isPoolColumnId(id: string): id is PoolColumnId {
  return VALID_COLUMN_IDS.has(id);
}

/** Filter and type an array of strings to PoolColumnId[] (filters out invalid IDs) */
export function asPoolColumnIds(ids: string[]): PoolColumnId[] {
  return ids.filter(isPoolColumnId);
}

// =============================================================================
// Column Labels (for menus and headers)
// =============================================================================

export const COLUMN_LABELS: Record<PoolColumnId, string> = {
  name: "Pool",
  status: "Status",
  description: "Description",
  quota: "Quota (GPU)",
  capacity: "Capacity (GPU)",
  platforms: "Platforms",
  backend: "Backend",
};

// =============================================================================
// Legacy Column Definitions (for backwards compatibility)
// =============================================================================

// Column widths:
// - { fit, share }: content-sized minimum, share controls grow/shrink
// - { min, share }: rem-based minimum floor, share controls grow/shrink
// - number: fixed width in rem (no grow/shrink)
export const MANDATORY_COLUMNS: ColumnDef<PoolColumnId>[] = [
  { id: "name", label: "Pool", menuLabel: "Pool Name", width: { fit: true, share: 1.5 }, align: "left", sortable: true },
];

export const OPTIONAL_COLUMNS: OptionalColumnDef<PoolColumnId>[] = [
  { id: "status", label: "Status", menuLabel: "Status", width: { fit: true, share: 0.5 }, align: "left", sortable: true, defaultVisible: true },
  { id: "description", label: "Description", menuLabel: "Description", width: { min: 2, share: 2 }, align: "left", sortable: false, defaultVisible: true },
  { id: "quota", label: "Quota (GPU)", menuLabel: "GPU Quota", width: { fit: true, share: 0.8 }, align: "left", sortable: true, defaultVisible: true },
  { id: "capacity", label: "Capacity (GPU)", menuLabel: "GPU Capacity", width: { fit: true, share: 0.8 }, align: "left", sortable: true, defaultVisible: true },
  { id: "platforms", label: "Platforms", menuLabel: "Platforms", width: { min: 6, share: 1.5 }, align: "left", sortable: false, defaultVisible: true },
  { id: "backend", label: "Backend", menuLabel: "Backend", width: { fit: true, share: 0.5 }, align: "left", sortable: true, defaultVisible: false },
];

export const ALL_COLUMNS: ColumnDef<PoolColumnId>[] = [
  ...MANDATORY_COLUMNS,
  ...OPTIONAL_COLUMNS.map(({ defaultVisible, ...rest }) => rest),
];

export const DEFAULT_VISIBLE_OPTIONAL: PoolColumnId[] = OPTIONAL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id);
export const DEFAULT_VISIBLE_COLUMNS: PoolColumnId[] = [...MANDATORY_COLUMNS.map((c) => c.id), ...DEFAULT_VISIBLE_OPTIONAL];
export const DEFAULT_COLUMN_ORDER: PoolColumnId[] = ALL_COLUMNS.map((c) => c.id);
export const COLUMN_MAP = new Map(ALL_COLUMNS.map((c) => [c.id, c]));
export const MANDATORY_COLUMN_IDS: ReadonlySet<PoolColumnId> = new Set(MANDATORY_COLUMNS.map((c) => c.id));

// =============================================================================
// Column Size Configuration (for DataTable)
// =============================================================================

/**
 * Column sizing configuration for the DataTable component.
 *
 * Uses rem-based minimum widths for accessibility (scales with user font size).
 * At 16px base: 1rem = 16px.
 *
 * - minWidthRem: Minimum width in rem units
 * - share: Proportional weight for space distribution (like CSS flex-grow)
 */
export const POOL_COLUMN_SIZE_CONFIG: ColumnSizeConfig[] = [
  { id: "name", minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_TRUNCATE, share: COLUMN_FLEX.PRIMARY },
  { id: "status", minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_SHORT, share: COLUMN_FLEX.TERTIARY },
  { id: "description", minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_TRUNCATE, share: COLUMN_FLEX.SECONDARY },
  { id: "quota", minWidthRem: COLUMN_MIN_WIDTHS_REM.NUMBER_WITH_UNIT, share: COLUMN_FLEX.NUMERIC_WIDE },
  { id: "capacity", minWidthRem: COLUMN_MIN_WIDTHS_REM.NUMBER_WITH_UNIT, share: COLUMN_FLEX.NUMERIC_WIDE },
  { id: "platforms", minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_TRUNCATE, share: COLUMN_FLEX.SECONDARY },
  { id: "backend", minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_SHORT, share: COLUMN_FLEX.TERTIARY },
];

// =============================================================================
// Default Sort Configuration
// =============================================================================

export const DEFAULT_SORT = { column: "name" as PoolColumnId, direction: "asc" as const };
