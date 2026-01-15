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

/**
 * Task Table Column Configuration
 *
 * Column IDs, labels, and sizing for the task table in group details.
 * Follows the canonical pattern from workflow-columns.ts.
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

export type TaskColumnId =
  | "status"
  | "name"
  | "duration"
  | "node"
  | "podIp"
  | "exitCode"
  | "startTime"
  | "endTime"
  | "retry";

/** Set of all valid task column IDs for type validation */
const VALID_COLUMN_IDS = new Set<string>([
  "status",
  "name",
  "duration",
  "node",
  "podIp",
  "exitCode",
  "startTime",
  "endTime",
  "retry",
]);

/** Type guard to check if a string is a valid TaskColumnId */
export function isTaskColumnId(id: string): id is TaskColumnId {
  return VALID_COLUMN_IDS.has(id);
}

/** Filter and type an array of strings to TaskColumnId[] (filters out invalid IDs) */
export function asTaskColumnIds(ids: string[]): TaskColumnId[] {
  return ids.filter(isTaskColumnId);
}

// =============================================================================
// Column Labels (for menus and headers)
// =============================================================================

export const COLUMN_LABELS: Record<TaskColumnId, string> = {
  status: "Status",
  name: "Name",
  duration: "Duration",
  node: "Node",
  podIp: "IP",
  exitCode: "Exit",
  startTime: "Start",
  endTime: "End",
  retry: "Retry",
};

/** Menu labels (full names for dropdown) */
export const COLUMN_MENU_LABELS: Record<TaskColumnId, string> = {
  status: "Status",
  name: "Name",
  duration: "Duration",
  node: "Node Name",
  podIp: "Pod IP",
  exitCode: "Exit Code",
  startTime: "Start Time",
  endTime: "End Time",
  retry: "Retry ID",
};

// =============================================================================
// Column Definitions (for toolbar column visibility menu)
// =============================================================================

/** Columns that can be toggled in the column visibility menu */
export const OPTIONAL_COLUMNS: ColumnDefinition[] = [
  { id: "status", label: "Status", menuLabel: "Status" },
  { id: "duration", label: "Duration", menuLabel: "Duration" },
  { id: "node", label: "Node", menuLabel: "Node Name" },
  { id: "podIp", label: "IP", menuLabel: "Pod IP" },
  { id: "exitCode", label: "Exit", menuLabel: "Exit Code" },
  { id: "startTime", label: "Start", menuLabel: "Start Time" },
  { id: "endTime", label: "End", menuLabel: "End Time" },
  { id: "retry", label: "Retry", menuLabel: "Retry ID" },
];

/** Alphabetically sorted optional columns for stable menu order */
export const OPTIONAL_COLUMNS_ALPHABETICAL = [...OPTIONAL_COLUMNS].sort((a, b) =>
  (a.menuLabel ?? a.label).localeCompare(b.menuLabel ?? b.label),
);

/** Default visible columns */
export const DEFAULT_VISIBLE_COLUMNS: TaskColumnId[] = ["name", "status", "duration", "node"];

/** Default column order */
export const DEFAULT_COLUMN_ORDER: TaskColumnId[] = [
  "name",
  "status",
  "duration",
  "node",
  "podIp",
  "exitCode",
  "startTime",
  "endTime",
  "retry",
];

/** Columns that cannot be hidden or reordered */
export const MANDATORY_COLUMN_IDS: ReadonlySet<TaskColumnId> = new Set(["name"]);

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
export const TASK_COLUMN_SIZE_CONFIG: ColumnSizeConfig[] = [
  {
    id: "status",
    minWidthRem: COLUMN_MIN_WIDTHS_REM.STATUS_BADGE_LONG,
    preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.STATUS_BADGE_LONG,
  },
  {
    id: "name",
    minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_TRUNCATE,
    preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TEXT_TRUNCATE,
  },
  {
    id: "duration",
    minWidthRem: COLUMN_MIN_WIDTHS_REM.NUMBER_SHORT,
    preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.NUMBER_SHORT,
  },
  {
    id: "node",
    minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_SHORT,
    preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TEXT_SHORT,
  },
  {
    id: "podIp",
    minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_SHORT,
    preferredWidthRem: 7, // IPs are ~15 chars
  },
  {
    id: "exitCode",
    minWidthRem: COLUMN_MIN_WIDTHS_REM.FLAG_SHORT,
    preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.FLAG_SHORT,
  },
  {
    id: "startTime",
    minWidthRem: COLUMN_MIN_WIDTHS_REM.TIMESTAMP,
    preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TIMESTAMP,
  },
  {
    id: "endTime",
    minWidthRem: COLUMN_MIN_WIDTHS_REM.TIMESTAMP,
    preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TIMESTAMP,
  },
  {
    id: "retry",
    minWidthRem: COLUMN_MIN_WIDTHS_REM.FLAG_SHORT,
    preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.FLAG_SHORT,
  },
];

// =============================================================================
// Default Sort Configuration
// =============================================================================

export const DEFAULT_SORT = { column: "name" as TaskColumnId, direction: "asc" as const };
