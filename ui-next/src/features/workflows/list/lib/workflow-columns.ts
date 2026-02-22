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

import { createColumnConfig } from "@/components/data-table/create-column-config";
import { COLUMN_MIN_WIDTHS_REM, COLUMN_PREFERRED_WIDTHS_REM } from "@/components/data-table/utils/column-constants";

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

// =============================================================================
// Column Configuration (via factory)
// =============================================================================

const workflowColumnConfig = createColumnConfig<WorkflowColumnId>({
  columns: [
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
  ] as const,
  labels: {
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
  },
  mandatory: ["name"],
  defaultVisible: ["name", "status", "user", "submit_time", "duration", "pool", "priority"],
  defaultOrder: [
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
  ],
  sizeConfig: [
    {
      id: "name",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.TEXT_TRUNCATE,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.TEXT_TRUNCATE * 1.5,
    },
    {
      id: "status",
      minWidthRem: COLUMN_MIN_WIDTHS_REM.STATUS_BADGE_LONG,
      preferredWidthRem: COLUMN_PREFERRED_WIDTHS_REM.STATUS_BADGE_LONG,
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
  ],
  defaultSort: { column: "submit_time", direction: "desc" },
});

// =============================================================================
// Exports (backward compatible)
// =============================================================================

/** Type guard to check if a string is a valid WorkflowColumnId */
export const isWorkflowColumnId = workflowColumnConfig.isColumnId;

/** Filter and type an array of strings to WorkflowColumnId[] (filters out invalid IDs) */
export const asWorkflowColumnIds = workflowColumnConfig.asColumnIds;

/** Column labels for header display */
export const COLUMN_LABELS = workflowColumnConfig.COLUMN_LABELS;

/** Columns that can be toggled in the column visibility menu */
export const OPTIONAL_COLUMNS = workflowColumnConfig.OPTIONAL_COLUMNS;

/** Default visible columns */
export const DEFAULT_VISIBLE_COLUMNS = workflowColumnConfig.DEFAULT_VISIBLE_COLUMNS;

/** Default column order */
export const DEFAULT_COLUMN_ORDER = workflowColumnConfig.DEFAULT_COLUMN_ORDER;

/** Columns that cannot be hidden */
export const MANDATORY_COLUMN_IDS = workflowColumnConfig.MANDATORY_COLUMN_IDS;

/** Column sizing configuration */
export const WORKFLOW_COLUMN_SIZE_CONFIG = workflowColumnConfig.COLUMN_SIZE_CONFIG;

/** Default sort configuration */
export const DEFAULT_SORT = workflowColumnConfig.DEFAULT_SORT;
