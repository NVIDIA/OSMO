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
 * Workflow Types - Aligned with Backend API
 *
 * These types match the actual backend GroupQueryResponse and TaskQueryResponse
 * from external/src/service/core/workflow/objects.py
 *
 * For DAG visualization, we compute topological levels from the dependency graph
 * rather than relying on backend-provided layout hints.
 */

import { TaskGroupStatus } from "@/lib/api/generated";
import type { GroupQueryResponse, TaskQueryResponse, WorkflowQueryResponse } from "@/lib/api/adapter/types";
import { isTaskOngoing } from "@/lib/api/status-metadata.generated";

// Re-export backend types for convenience
export { TaskGroupStatus };
export type { GroupQueryResponse, TaskQueryResponse, WorkflowQueryResponse };

// ============================================================================
// Task Types (with computed fields)
// ============================================================================

/**
 * Task with computed duration for UI display.
 * Extends the backend TaskQueryResponse with computed fields.
 */
export interface TaskWithDuration extends TaskQueryResponse {
  /** Computed duration in seconds (from start_time/end_time) */
  duration: number | null;
  /** Group name this task belongs to (for identification) */
  _groupName?: string;
  /** Whether this is the last VISIBLE task (after filtering/sorting) */
  _isLastTask?: boolean;
  /** Index within the visible task list (after filtering/sorting) */
  _taskIndex?: number;
  /**
   * Whether this task is a single-task group.
   * When true:
   * - Group row is skipped
   * - Task renders with empty circle (○) instead of L-connector
   * - Task name is NOT indented (flush with header)
   */
  _isSingleTaskGroup?: boolean;
  /**
   * Visual row index for zebra striping (alternating row colors).
   * Counts visible rows (section headers that aren't skipped + all task rows).
   * Used for consistent striping across groups.
   */
  _visualRowIndex?: number;
}

// ============================================================================
// Computed Layout Types (derived from dependency graph)
// ============================================================================

/**
 * A group with computed layout information for DAG visualization.
 * The base data comes from the backend, layout is computed on the frontend.
 */
export interface GroupWithLayout extends GroupQueryResponse {
  /** Computed topological level (0 = root, increases downstream) */
  level: number;
  /** Computed lane within level (for cross-axis ordering) */
  lane: number;
  /** Unique ID for React Flow (same as name for groups) */
  id: string;
}

/**
 * A workflow with computed layout information for all groups.
 */
export interface WorkflowWithLayout extends Omit<WorkflowQueryResponse, "groups"> {
  groups: GroupWithLayout[];
  /** Maximum topological level in the DAG */
  maxLevel: number;
  /** Map of level -> groups at that level */
  groupsByLevel: Map<number, GroupWithLayout[]>;
}

// ============================================================================
// Topological Level Computation
// ============================================================================

// Re-export from layout module (canonical implementation)
export {
  transformGroups,
  computeFullUpstreamDependencies,
  getMaxLevel,
  getGroupsByLevel,
  getRootGroups,
  getLeafGroups,
  type TopologicalLevelOptions,
} from "./workflow-layout";

// ============================================================================
// Status Helpers
// ============================================================================

// Re-export canonical implementations from status utilities
export { getStatusCategory, isTaskFailed, isTaskOngoing } from "./status";

// ============================================================================
// Duration Helpers
// ============================================================================

/**
 * Calculate duration in seconds from start/end time strings.
 * Timestamps are normalized in the adapter layer (useWorkflow hook),
 * so we can safely use new Date() directly.
 *
 * NOTE: This is a low-level utility that doesn't consider status.
 * For status-aware duration calculation, use `calculateTaskDuration`.
 *
 * @param startTime - Start time string
 * @param endTime - End time string (null for running tasks)
 * @param now - Current timestamp in milliseconds (for running tasks, use synchronized tick)
 */
export function calculateDuration(startTime?: string | null, endTime?: string | null, now?: number): number | null {
  if (!startTime) return null;

  const start = new Date(startTime).getTime();
  const end = endTime ? new Date(endTime).getTime() : (now ?? Date.now());

  return Math.max(0, (end - start) / 1000);
}

/**
 * Calculate duration for a task/group using data-driven status semantics.
 *
 * This function uses generated metadata to determine if duration is ongoing:
 * - Running/Initializing statuses: duration = start_time → now (live)
 * - Terminal statuses (completed/failed): duration = start_time → end_time (static)
 * - Pending statuses: duration = null (not started)
 *
 * @param startTime - Start time string
 * @param endTime - End time string
 * @param status - Task/group status (used to determine if duration is ongoing)
 * @param now - Current timestamp in milliseconds (from useTick for synchronized updates)
 */
export function calculateTaskDuration(
  startTime: string | null | undefined,
  endTime: string | null | undefined,
  status: TaskGroupStatus,
  now: number,
): number | null {
  if (!startTime) return null;

  const start = new Date(startTime).getTime();

  // Use generated metadata to determine if duration is ongoing
  if (isTaskOngoing(status)) {
    // Running/Initializing: duration is live (start → now)
    return Math.max(0, (now - start) / 1000);
  }

  // Terminal status: use end_time if available
  if (endTime) {
    return Math.max(0, (new Date(endTime).getTime() - start) / 1000);
  }

  // Terminal but no end_time (shouldn't happen in practice)
  return null;
}

/**
 * Format duration in human-readable form.
 */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "-";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
