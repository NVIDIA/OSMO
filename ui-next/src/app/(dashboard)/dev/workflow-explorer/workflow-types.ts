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

import {
  TaskGroupStatus,
  type GroupQueryResponse,
  type TaskQueryResponse,
  type WorkflowQueryResponse,
} from "@/lib/api/generated";

// Re-export backend types for convenience
export { TaskGroupStatus };
export type { GroupQueryResponse, TaskQueryResponse, WorkflowQueryResponse };

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

// Re-export from adapter layer (canonical implementation)
// The adapter provides a cleaner, more isolated transformation layer
import { transformGroups as _transformGroups } from "./reactflow-dag/adapters";

export {
  transformGroups,
  computeFullUpstreamDependencies,
  getMaxLevel,
  getGroupsByLevel,
  getRootGroups,
  getLeafGroups,
} from "./reactflow-dag/adapters";

/**
 * @deprecated Use `transformGroups` from "./reactflow-dag/adapters" instead.
 * This alias is kept for backwards compatibility.
 */
export const computeTopologicalLevelsFromGraph = _transformGroups;

/**
 * @deprecated Use `transformGroups` from "./reactflow-dag/adapters" instead.
 * This was the original implementation using remaining_upstream_groups.
 */
export const computeTopologicalLevels = _transformGroups;

// ============================================================================
// Status Helpers
// ============================================================================

// Re-export canonical implementations from reactflow-dag/utils/status
// This avoids duplication while maintaining backwards compatibility
export { isFailedStatus, getStatusCategory } from "./reactflow-dag/utils/status";

/**
 * Calculate duration in seconds from start/end time strings.
 */
export function calculateDuration(startTime?: string | null, endTime?: string | null): number | null {
  if (!startTime) return null;

  const start = new Date(startTime).getTime();
  const end = endTime ? new Date(endTime).getTime() : Date.now();

  return (end - start) / 1000;
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
