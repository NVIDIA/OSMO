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

import { createColumnConfig } from "@/components/data-table/create-column-config";
import { COLUMN_MIN_WIDTHS_REM, COLUMN_PREFERRED_WIDTHS_REM } from "@/components/data-table/utils/column-constants";

// =============================================================================
// Column IDs
// =============================================================================

export type PoolColumnId = "name" | "status" | "description" | "quota" | "capacity" | "platforms" | "backend";

// =============================================================================
// Column Configuration (via factory)
// =============================================================================

const poolColumnConfig = createColumnConfig<PoolColumnId>({
  columns: ["name", "status", "description", "quota", "capacity", "platforms", "backend"] as const,
  labels: {
    name: "Pool",
    status: "Status",
    description: "Description",
    quota: "Quota (GPU)",
    capacity: "Capacity (GPU)",
    platforms: "Platforms",
    backend: "Backend",
  },
  mandatory: ["name"],
  defaultVisible: ["name", "status", "description", "quota", "capacity", "platforms"],
  defaultOrder: ["name", "status", "description", "quota", "capacity", "platforms", "backend"],
  sizeConfig: [
    {
      id: "name",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_TRUNCATE,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TEXT_TRUNCATE,
    },
    {
      id: "status",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_TRUNCATE,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.STATUS_BADGE,
    },
    {
      id: "description",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_TRUNCATE,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TEXT_TRUNCATE,
    },
    {
      id: "quota",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.NUMBER_WITH_PROGRESS_BAR,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.PROGRESS_BAR,
    },
    {
      id: "capacity",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.NUMBER_WITH_PROGRESS_BAR + COLUMN_MIN_WIDTHS_REM.ACTIONS_ICON,
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
  ],
  defaultSort: { column: "name", direction: "asc" },
  defaultPanelWidth: 40,
});

// =============================================================================
// Exports (backward compatible)
// =============================================================================

/** Type guard to check if a string is a valid PoolColumnId */
export const isPoolColumnId = poolColumnConfig.isColumnId;

/** Filter and type an array of strings to PoolColumnId[] (filters out invalid IDs) */
export const asPoolColumnIds = poolColumnConfig.asColumnIds;

/** Column labels for header display */
export const COLUMN_LABELS = poolColumnConfig.COLUMN_LABELS;

/** Columns that can be toggled in the column visibility menu */
export const OPTIONAL_COLUMNS = poolColumnConfig.OPTIONAL_COLUMNS;

/** Default visible columns (excludes backend) */
export const DEFAULT_VISIBLE_COLUMNS = poolColumnConfig.DEFAULT_VISIBLE_COLUMNS;

/** Default column order */
export const DEFAULT_COLUMN_ORDER = poolColumnConfig.DEFAULT_COLUMN_ORDER;

/** Columns that cannot be hidden */
export const MANDATORY_COLUMN_IDS = poolColumnConfig.MANDATORY_COLUMN_IDS;

/** Column sizing configuration */
export const POOL_COLUMN_SIZE_CONFIG = poolColumnConfig.COLUMN_SIZE_CONFIG;

/** Default sort configuration */
export const DEFAULT_SORT = poolColumnConfig.DEFAULT_SORT;

/** Default panel width percentage */
export const DEFAULT_PANEL_WIDTH = poolColumnConfig.DEFAULT_PANEL_WIDTH;
