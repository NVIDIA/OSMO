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
 * Table Types
 *
 * Type definitions for task tables, columns, sorting, and search.
 */

import type { TaskQueryResponse } from "../workflow-types";

// ============================================================================
// Task Types
// ============================================================================

/**
 * Task with computed duration for UI display.
 * Extends the backend TaskQueryResponse with computed fields.
 */
export interface TaskWithDuration extends TaskQueryResponse {
  /** Computed duration in seconds (from start_time/end_time) */
  duration: number | null;
}

// ============================================================================
// Column Types
// ============================================================================

export type ColumnId =
  | "status"
  | "name"
  | "duration"
  | "node"
  | "podIp"
  | "exitCode"
  | "startTime"
  | "endTime"
  | "retry";

/**
 * Column width specification.
 * - number: fixed width in pixels
 * - object: flexible width with min floor and share proportion
 */
export type ColumnWidth = number | { min: number; share: number };

export interface ColumnDef {
  id: ColumnId;
  label: string; // Short label for table header
  menuLabel: string; // Full label for dropdown menu
  width: ColumnWidth;
  align: "left" | "right";
  sortable: boolean;
}

export interface OptionalColumnDef extends ColumnDef {
  defaultVisible: boolean;
}

// ============================================================================
// Sort Types
// ============================================================================

// Import SortDirection from single source of truth
import type { SortDirection } from "@/components/data-table/constants";

// Re-export for convenience
export type { SortDirection };

export type SortColumn = ColumnId;

export interface SortState {
  column: SortColumn | null;
  direction: SortDirection;
}

// ============================================================================
// Search Types
// ============================================================================

export interface SearchChip {
  field: string;
  value: string;
  label: string;
}

export interface SearchField {
  id: string;
  label: string;
  prefix: string;
  getValues: (tasks: TaskWithDuration[]) => string[];
  match: (task: TaskWithDuration, value: string) => boolean;
}
