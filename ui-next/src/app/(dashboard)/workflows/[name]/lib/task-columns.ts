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
 * Uses the createColumnConfig factory to reduce boilerplate.
 */

import { COLUMN_MIN_WIDTHS_REM, COLUMN_PREFERRED_WIDTHS_REM, createColumnConfig } from "@/components/data-table";

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

// =============================================================================
// Column Configuration (via factory)
// =============================================================================

const taskColumnConfig = createColumnConfig<TaskColumnId>({
  columns: ["status", "name", "duration", "node", "podIp", "exitCode", "startTime", "endTime", "retry"] as const,
  labels: {
    status: "Status",
    name: "Name",
    duration: "Duration",
    node: "Node",
    podIp: "IP",
    exitCode: "Exit",
    startTime: "Start",
    endTime: "End",
    retry: "Retry",
  },
  mandatory: ["name"],
  defaultVisible: ["name", "status", "duration", "node"],
  defaultOrder: ["name", "status", "duration", "node", "podIp", "exitCode", "startTime", "endTime", "retry"],
  sizeConfig: [
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
  ],
  // Custom optional columns to preserve original order and use menu labels
  optionalColumns: [
    { id: "status", label: "Status", menuLabel: "Status" },
    { id: "duration", label: "Duration", menuLabel: "Duration" },
    { id: "node", label: "Node", menuLabel: "Node Name" },
    { id: "podIp", label: "IP", menuLabel: "Pod IP" },
    { id: "exitCode", label: "Exit", menuLabel: "Exit Code" },
    { id: "startTime", label: "Start", menuLabel: "Start Time" },
    { id: "endTime", label: "End", menuLabel: "End Time" },
    { id: "retry", label: "Retry", menuLabel: "Retry ID" },
  ],
  defaultSort: { column: "name", direction: "asc" },
});

// =============================================================================
// Exports (backward compatible)
// =============================================================================

/** Type guard to check if a string is a valid TaskColumnId */
export const isTaskColumnId = taskColumnConfig.isColumnId;

/** Filter and type an array of strings to TaskColumnId[] (filters out invalid IDs) */
export const asTaskColumnIds = taskColumnConfig.asColumnIds;

/** Column labels for header display */
export const COLUMN_LABELS = taskColumnConfig.COLUMN_LABELS;

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

/** Columns that can be toggled in the column visibility menu */
export const OPTIONAL_COLUMNS = taskColumnConfig.OPTIONAL_COLUMNS;

/** Alphabetically sorted optional columns for stable menu order */
export const OPTIONAL_COLUMNS_ALPHABETICAL = [...taskColumnConfig.OPTIONAL_COLUMNS].sort((a, b) =>
  (a.menuLabel ?? a.label).localeCompare(b.menuLabel ?? b.label),
);

/** Default visible columns */
export const DEFAULT_VISIBLE_COLUMNS = taskColumnConfig.DEFAULT_VISIBLE_COLUMNS;

/** Default column order */
export const DEFAULT_COLUMN_ORDER = taskColumnConfig.DEFAULT_COLUMN_ORDER;

/** Columns that cannot be hidden or reordered */
export const MANDATORY_COLUMN_IDS = taskColumnConfig.MANDATORY_COLUMN_IDS;

/** Column sizing configuration */
export const TASK_COLUMN_SIZE_CONFIG = taskColumnConfig.COLUMN_SIZE_CONFIG;

/** Tree column sizing configuration (for tree pattern table) */
export const TREE_COLUMN_SIZE_CONFIG = [
  {
    id: "_tree",
    minWidthRem: 2,
    preferredWidthRem: 2,
  },
];

/** Combined tree + task column sizing (tree column first) */
export const TASK_WITH_TREE_COLUMN_SIZE_CONFIG = [...TREE_COLUMN_SIZE_CONFIG, ...TASK_COLUMN_SIZE_CONFIG];

/** Default sort configuration */
export const DEFAULT_SORT = taskColumnConfig.DEFAULT_SORT;
