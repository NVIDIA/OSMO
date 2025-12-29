// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * GroupPanel Types
 *
 * Type definitions for the GroupPanel component and its sub-components.
 */

import type { TaskQueryResponse, GroupWithLayout } from "../../../workflow-types";

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

export type ColumnId = "status" | "name" | "duration" | "node" | "podIp" | "exitCode" | "startTime" | "endTime" | "retry";

/**
 * Column width specification.
 * - number: fixed width in pixels
 * - object: flexible width with min floor and share proportion
 */
export type ColumnWidth = number | { min: number; share: number };

export interface ColumnDef {
  id: ColumnId;
  label: string;        // Short label for table header
  menuLabel: string;    // Full label for dropdown menu
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

export type SortColumn = ColumnId;
export type SortDirection = "asc" | "desc";

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

// ============================================================================
// Panel Props
// ============================================================================

export interface GroupPanelProps {
  /** The group to display */
  group: GroupWithLayout;
  /** Callback when panel is closed */
  onClose: () => void;
  /** Callback when a task is selected */
  onSelectTask: (task: TaskQueryResponse, group: GroupWithLayout) => void;
  /** Current panel width percentage (optional, for resize handle) */
  panelPct?: number;
  /** Callback to resize panel (optional) */
  onPanelResize?: (pct: number) => void;
}
