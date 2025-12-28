// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

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

/**
 * Computes topological levels for groups based on dependency graph.
 * Level 0 = root nodes (no upstream dependencies)
 * Level N = max(upstream levels) + 1
 *
 * Uses Kahn's algorithm variant for topological sorting with level assignment.
 */
export function computeTopologicalLevels(groups: GroupQueryResponse[]): GroupWithLayout[] {
  // Build lookup maps
  const groupMap = new Map<string, GroupQueryResponse>();
  const levelMap = new Map<string, number>();
  const laneMap = new Map<string, number>();

  groups.forEach((group) => {
    groupMap.set(group.name, group);
  });

  // Compute levels using BFS from roots
  // Level = max(parent levels) + 1, or 0 if no parents
  const computeLevel = (groupName: string, visited: Set<string>): number => {
    if (levelMap.has(groupName)) {
      return levelMap.get(groupName)!;
    }

    // Prevent infinite loops in case of cycles
    if (visited.has(groupName)) {
      console.warn(`Cycle detected at group: ${groupName}`);
      return 0;
    }
    visited.add(groupName);

    const group = groupMap.get(groupName);
    if (!group) {
      console.warn(`Group not found: ${groupName}`);
      return 0;
    }

    // Get upstream groups (remaining_upstream_groups from backend)
    // Note: remaining_upstream_groups contains groups that haven't completed yet
    // For layout, we need the original upstream groups
    // Backend also provides downstream_groups, we can infer upstream from that
    const upstreamNames = group.remaining_upstream_groups || [];

    if (upstreamNames.length === 0) {
      // Root node
      levelMap.set(groupName, 0);
      return 0;
    }

    // Level = max(upstream levels) + 1
    let maxUpstreamLevel = -1;
    for (const upstreamName of upstreamNames) {
      const upstreamLevel = computeLevel(upstreamName, visited);
      maxUpstreamLevel = Math.max(maxUpstreamLevel, upstreamLevel);
    }

    const level = maxUpstreamLevel + 1;
    levelMap.set(groupName, level);
    return level;
  };

  // Compute levels for all groups
  groups.forEach((group) => {
    computeLevel(group.name, new Set());
  });

  // Assign lanes within each level (simple left-to-right ordering)
  const groupsByLevel = new Map<number, string[]>();
  groups.forEach((group) => {
    const level = levelMap.get(group.name) || 0;
    if (!groupsByLevel.has(level)) {
      groupsByLevel.set(level, []);
    }
    groupsByLevel.get(level)!.push(group.name);
  });

  // Sort groups within each level by name for consistent ordering
  groupsByLevel.forEach((groupNames, level) => {
    groupNames.sort();
    groupNames.forEach((name, index) => {
      laneMap.set(name, index);
    });
  });

  // Create groups with layout
  return groups.map((group) => ({
    ...group,
    id: group.name, // Use name as ID for React Flow
    level: levelMap.get(group.name) || 0,
    lane: laneMap.get(group.name) || 0,
  }));
}

/**
 * Computes the full upstream dependency list for each group.
 * The backend's remaining_upstream_groups only shows incomplete dependencies.
 * This reconstructs the full dependency graph from downstream_groups.
 */
export function computeFullUpstreamDependencies(groups: GroupQueryResponse[]): Map<string, string[]> {
  const upstreamMap = new Map<string, string[]>();

  // Initialize with empty arrays
  groups.forEach((group) => {
    upstreamMap.set(group.name, []);
  });

  // Build upstream from downstream references
  groups.forEach((group) => {
    const downstreams = group.downstream_groups || [];
    downstreams.forEach((downstreamName) => {
      const upstreams = upstreamMap.get(downstreamName);
      if (upstreams) {
        upstreams.push(group.name);
      }
    });
  });

  return upstreamMap;
}

/**
 * Enhanced topological level computation that uses both upstream and downstream info.
 * This handles the case where remaining_upstream_groups might be incomplete.
 */
export function computeTopologicalLevelsFromGraph(groups: GroupQueryResponse[]): GroupWithLayout[] {
  // First, reconstruct full upstream dependencies from downstream_groups
  const upstreamMap = computeFullUpstreamDependencies(groups);

  // Build lookup map
  const groupMap = new Map<string, GroupQueryResponse>();
  groups.forEach((group) => {
    groupMap.set(group.name, group);
  });

  // Compute levels using reconstructed upstream dependencies
  const levelMap = new Map<string, number>();

  const computeLevel = (groupName: string, visited: Set<string>): number => {
    if (levelMap.has(groupName)) {
      return levelMap.get(groupName)!;
    }

    if (visited.has(groupName)) {
      console.warn(`Cycle detected at group: ${groupName}`);
      return 0;
    }
    visited.add(groupName);

    const upstreams = upstreamMap.get(groupName) || [];

    if (upstreams.length === 0) {
      levelMap.set(groupName, 0);
      return 0;
    }

    let maxUpstreamLevel = -1;
    for (const upstreamName of upstreams) {
      if (groupMap.has(upstreamName)) {
        const upstreamLevel = computeLevel(upstreamName, new Set(visited));
        maxUpstreamLevel = Math.max(maxUpstreamLevel, upstreamLevel);
      }
    }

    const level = maxUpstreamLevel + 1;
    levelMap.set(groupName, level);
    return level;
  };

  // Compute levels for all groups
  groups.forEach((group) => {
    computeLevel(group.name, new Set());
  });

  // Assign lanes within each level
  const groupsByLevel = new Map<number, string[]>();
  groups.forEach((group) => {
    const level = levelMap.get(group.name) || 0;
    if (!groupsByLevel.has(level)) {
      groupsByLevel.set(level, []);
    }
    groupsByLevel.get(level)!.push(group.name);
  });

  const laneMap = new Map<string, number>();
  groupsByLevel.forEach((groupNames) => {
    groupNames.sort();
    groupNames.forEach((name, index) => {
      laneMap.set(name, index);
    });
  });

  return groups.map((group) => ({
    ...group,
    id: group.name,
    level: levelMap.get(group.name) || 0,
    lane: laneMap.get(group.name) || 0,
  }));
}

// ============================================================================
// Status Helpers (same logic, aligned with backend types)
// ============================================================================

/**
 * Check if a status represents a failure state.
 * All failure statuses start with "FAILED" (FAILED, FAILED_CANCELED, FAILED_TIMEOUT, etc.)
 */
export function isFailedStatus(status: string): boolean {
  return typeof status === "string" && status.startsWith(TaskGroupStatus.FAILED);
}

/**
 * Categorize status for UI styling.
 * Works with both TaskGroupStatus and WorkflowStatus.
 * Uses TaskGroupStatus enum values to avoid magic strings.
 */
export function getStatusCategory(
  status: string, // Accept string to handle both TaskGroupStatus and WorkflowStatus
): "waiting" | "running" | "completed" | "failed" {
  // Waiting/pending statuses
  if (
    status === TaskGroupStatus.WAITING ||
    status === TaskGroupStatus.SUBMITTING ||
    status === TaskGroupStatus.SCHEDULING ||
    status === TaskGroupStatus.PROCESSING
  ) {
    return "waiting";
  }

  // Running/active statuses
  if (status === TaskGroupStatus.INITIALIZING || status === TaskGroupStatus.RUNNING) {
    return "running";
  }

  // Completed statuses
  if (status === TaskGroupStatus.COMPLETED || status === TaskGroupStatus.RESCHEDULED) {
    return "completed";
  }

  // All FAILED_* and FAILED statuses
  return "failed";
}

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
