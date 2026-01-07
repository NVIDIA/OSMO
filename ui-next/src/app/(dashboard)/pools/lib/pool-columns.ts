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

import {
  COLUMN_MIN_WIDTHS_REM,
  COLUMN_PREFERRED_WIDTHS_REM,
  type ColumnSizeConfig,
  type ColumnDefinition,
} from "@/components/data-table";

// =============================================================================
// Column IDs
// =============================================================================

export type PoolColumnId = "name" | "status" | "description" | "quota" | "capacity" | "platforms" | "backend";

/** Set of all valid pool column IDs for type validation */
const VALID_COLUMN_IDS = new Set<string>([
  "name",
  "status",
  "description",
  "quota",
  "capacity",
  "platforms",
  "backend",
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
// Column Definitions (for toolbar column visibility menu)
// =============================================================================

/** Columns that can be toggled in the column visibility menu */
export const OPTIONAL_COLUMNS: ColumnDefinition[] = [
  { id: "status", label: "Status", menuLabel: "Status" },
  { id: "description", label: "Description", menuLabel: "Description" },
  { id: "quota", label: "Quota (GPU)", menuLabel: "GPU Quota" },
  { id: "capacity", label: "Capacity (GPU)", menuLabel: "GPU Capacity" },
  { id: "platforms", label: "Platforms", menuLabel: "Platforms" },
  { id: "backend", label: "Backend", menuLabel: "Backend" },
];

/** Default visible columns (excludes backend) */
export const DEFAULT_VISIBLE_COLUMNS: PoolColumnId[] = [
  "name",
  "status",
  "description",
  "quota",
  "capacity",
  "platforms",
];

/** Default column order */
export const DEFAULT_COLUMN_ORDER: PoolColumnId[] = [
  "name",
  "status",
  "description",
  "quota",
  "capacity",
  "platforms",
  "backend",
];

/** Columns that cannot be hidden */
export const MANDATORY_COLUMN_IDS: ReadonlySet<PoolColumnId> = new Set(["name"]);

// =============================================================================
// Column Size Configuration (for DataTable)
// =============================================================================

/**
 * Column sizing configuration.
 * Uses rem for accessibility (scales with user font size).
 *
 * - minWidthRem: Absolute floor (column never smaller than this)
 * - preferredWidthRem: Ideal width when space allows (used for initial sizing)
 */
export const POOL_COLUMN_SIZE_CONFIG: ColumnSizeConfig[] = [
  {
    id: "name",
    minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_TRUNCATE,
    preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TEXT_TRUNCATE,
  },
  {
    id: "status",
    minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_SHORT,
    preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.STATUS_BADGE,
  },
  {
    id: "description",
    minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_TRUNCATE,
    preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TEXT_TRUNCATE,
  },
  {
    id: "quota",
    minWidthRem: COLUMN_MIN_WIDTHS_REM.NUMBER_WITH_UNIT,
    preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.PROGRESS_BAR,
  },
  {
    id: "capacity",
    minWidthRem: COLUMN_MIN_WIDTHS_REM.NUMBER_WITH_UNIT,
    preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.PROGRESS_BAR,
  },
  {
    id: "platforms",
    minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_TRUNCATE,
    preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.PLATFORM_ICONS,
  },
  {
    id: "backend",
    minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_SHORT,
    preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TEXT_SHORT,
  },
];

// =============================================================================
// Default Sort Configuration
// =============================================================================

export const DEFAULT_SORT = { column: "name" as PoolColumnId, direction: "asc" as const };

/**
 * Default panel width percentage.
 */
export const DEFAULT_PANEL_WIDTH = 40;
