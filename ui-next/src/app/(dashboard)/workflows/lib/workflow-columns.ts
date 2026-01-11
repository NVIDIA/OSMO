// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

import {
  COLUMN_MIN_WIDTHS_REM,
  COLUMN_PREFERRED_WIDTHS_REM,
  type ColumnSizeConfig,
  type ColumnDefinition,
} from "@/components/data-table";

// =============================================================================
// Column IDs
// =============================================================================

export type WorkflowColumnId =
  | "name"
  | "status"
  | "user"
  | "submit_time"
  | "start_time"
  | "end_time"
  | "duration"
  | "queued_time"
  | "pool"
  | "priority"
  | "app_name";

/** Set of all valid workflow column IDs for type validation */
const VALID_COLUMN_IDS = new Set<string>([
  "name",
  "status",
  "user",
  "submit_time",
  "start_time",
  "end_time",
  "duration",
  "queued_time",
  "pool",
  "priority",
  "app_name",
]);

/** Type guard to check if a string is a valid WorkflowColumnId */
export function isWorkflowColumnId(id: string): id is WorkflowColumnId {
  return VALID_COLUMN_IDS.has(id);
}

/** Filter and type an array of strings to WorkflowColumnId[] (filters out invalid IDs) */
export function asWorkflowColumnIds(ids: string[]): WorkflowColumnId[] {
  return ids.filter(isWorkflowColumnId);
}

// =============================================================================
// Column Labels (for menus and headers)
// =============================================================================

export const COLUMN_LABELS: Record<WorkflowColumnId, string> = {
  name: "Name",
  status: "Status",
  user: "User",
  submit_time: "Submitted",
  start_time: "Started",
  end_time: "Ended",
  duration: "Duration",
  queued_time: "Queue Time",
  pool: "Pool",
  priority: "Priority",
  app_name: "App",
};

// =============================================================================
// Column Definitions (for toolbar column visibility menu)
// =============================================================================

/** Columns that can be toggled in the column visibility menu */
export const OPTIONAL_COLUMNS: ColumnDefinition[] = [
  { id: "status", label: "Status", menuLabel: "Status" },
  { id: "user", label: "User", menuLabel: "User" },
  { id: "submit_time", label: "Submitted", menuLabel: "Submitted" },
  { id: "start_time", label: "Started", menuLabel: "Started" },
  { id: "end_time", label: "Ended", menuLabel: "Ended" },
  { id: "duration", label: "Duration", menuLabel: "Duration" },
  { id: "queued_time", label: "Queue Time", menuLabel: "Queue Time" },
  { id: "pool", label: "Pool", menuLabel: "Pool" },
  { id: "priority", label: "Priority", menuLabel: "Priority" },
  { id: "app_name", label: "App", menuLabel: "App" },
];

/** Default visible columns */
export const DEFAULT_VISIBLE_COLUMNS: WorkflowColumnId[] = [
  "name",
  "status",
  "user",
  "submit_time",
  "duration",
  "pool",
  "priority",
];

/** Default column order */
export const DEFAULT_COLUMN_ORDER: WorkflowColumnId[] = [
  "name",
  "status",
  "user",
  "submit_time",
  "start_time",
  "end_time",
  "duration",
  "queued_time",
  "pool",
  "priority",
  "app_name",
];

/** Columns that cannot be hidden */
export const MANDATORY_COLUMN_IDS: ReadonlySet<WorkflowColumnId> = new Set(["name"]);

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
export const WORKFLOW_COLUMN_SIZE_CONFIG: ColumnSizeConfig[] = [
  {
    id: "name",
    minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_TRUNCATE,
    preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TEXT_TRUNCATE * 1.5,
  },
  {
    id: "status",
    minWidthRem: COLUMN_MIN_WIDTHS_REM.STATUS_BADGE,
    preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.STATUS_BADGE,
  },
  {
    id: "user",
    minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_SHORT,
    preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TEXT_SHORT,
  },
  {
    id: "submit_time",
    minWidthRem: COLUMN_MIN_WIDTHS_REM.TIMESTAMP,
    preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TIMESTAMP,
  },
  {
    id: "start_time",
    minWidthRem: COLUMN_MIN_WIDTHS_REM.TIMESTAMP,
    preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TIMESTAMP,
  },
  {
    id: "end_time",
    minWidthRem: COLUMN_MIN_WIDTHS_REM.TIMESTAMP,
    preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TIMESTAMP,
  },
  {
    id: "duration",
    minWidthRem: COLUMN_MIN_WIDTHS_REM.NUMBER_SHORT,
    preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.NUMBER_SHORT,
  },
  {
    id: "queued_time",
    minWidthRem: COLUMN_MIN_WIDTHS_REM.NUMBER_SHORT,
    preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.NUMBER_SHORT,
  },
  {
    id: "pool",
    minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_SHORT,
    preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TEXT_SHORT,
  },
  {
    id: "priority",
    minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_SHORT,
    preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TEXT_SHORT,
  },
  {
    id: "app_name",
    minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_SHORT,
    preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TEXT_SHORT,
  },
];

// =============================================================================
// Default Sort Configuration
// =============================================================================

export const DEFAULT_SORT = { column: "submit_time" as WorkflowColumnId, direction: "desc" as const };
