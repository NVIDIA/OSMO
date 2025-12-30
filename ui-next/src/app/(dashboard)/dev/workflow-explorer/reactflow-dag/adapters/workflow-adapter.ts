// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Workflow Adapter
 *
 * Transforms backend API data into frontend-optimized structures.
 * This adapter serves as the boundary between backend contracts and UI needs.
 *
 * Architecture:
 * - Backend types: GroupQueryResponse, TaskQueryResponse (from @/lib/api/generated)
 * - Frontend types: GroupWithLayout (adds computed level, lane, id)
 *
 * Benefits:
 * - Isolates all data transformation in one place
 * - Backend contract changes only affect this file
 * - Enables future data fetching integration (SWR/React Query)
 * - Pure functions that are easy to test
 */

import type { GroupQueryResponse } from "@/lib/api/generated";
import type { GroupWithLayout } from "../../workflow-types";

// ============================================================================
// Types
// ============================================================================

/**
 * Options for topological level computation.
 */
export interface TopologicalLevelOptions {
  /** Log warnings for cycles and missing groups (default: true) */
  warnOnIssues?: boolean;
}

// ============================================================================
// Core Transformation Functions
// ============================================================================

/**
 * Computes the full upstream dependency list for each group.
 *
 * The backend's remaining_upstream_groups only shows incomplete dependencies.
 * This reconstructs the full dependency graph from downstream_groups.
 *
 * @param groups - Array of groups from the backend
 * @returns Map of group name → list of upstream group names
 */
export function computeFullUpstreamDependencies(
  groups: GroupQueryResponse[],
): Map<string, string[]> {
  const upstreamMap = new Map<string, string[]>();

  // Initialize with empty arrays
  for (const group of groups) {
    upstreamMap.set(group.name, []);
  }

  // Build upstream from downstream references
  for (const group of groups) {
    const downstreams = group.downstream_groups ?? [];
    for (const downstreamName of downstreams) {
      const upstreams = upstreamMap.get(downstreamName);
      if (upstreams) {
        upstreams.push(group.name);
      }
    }
  }

  return upstreamMap;
}

/**
 * Transforms backend GroupQueryResponse[] into GroupWithLayout[].
 *
 * Computes topological levels for DAG visualization:
 * - Level 0 = root nodes (no upstream dependencies)
 * - Level N = max(upstream levels) + 1
 *
 * Uses Kahn's algorithm variant for topological sorting with level assignment.
 *
 * @param groups - Array of groups from the backend API
 * @param options - Optional configuration
 * @returns Array of groups with computed layout information
 *
 * @example
 * ```typescript
 * const response = await api.getWorkflow(id);
 * const groupsWithLayout = transformGroups(response.groups);
 * ```
 */
export function transformGroups(
  groups: GroupQueryResponse[],
  options: TopologicalLevelOptions = {},
): GroupWithLayout[] {
  const { warnOnIssues = true } = options;

  if (groups.length === 0) {
    return [];
  }

  // Reconstruct full upstream dependencies from downstream_groups
  const upstreamMap = computeFullUpstreamDependencies(groups);

  // Build lookup map for group data
  const groupMap = new Map<string, GroupQueryResponse>();
  for (const group of groups) {
    groupMap.set(group.name, group);
  }

  // Compute levels using memoized recursion
  const levelMap = new Map<string, number>();

  const computeLevel = (groupName: string, visited: Set<string>): number => {
    // Return cached result
    if (levelMap.has(groupName)) {
      return levelMap.get(groupName)!;
    }

    // Detect cycles
    if (visited.has(groupName)) {
      if (warnOnIssues) {
        console.warn(`[WorkflowAdapter] Cycle detected at group: ${groupName}`);
      }
      return 0;
    }
    visited.add(groupName);

    const upstreams = upstreamMap.get(groupName) ?? [];

    // Root node - no upstreams
    if (upstreams.length === 0) {
      levelMap.set(groupName, 0);
      return 0;
    }

    // Level = max(upstream levels) + 1
    let maxUpstreamLevel = -1;
    for (const upstreamName of upstreams) {
      if (groupMap.has(upstreamName)) {
        const upstreamLevel = computeLevel(upstreamName, new Set(visited));
        maxUpstreamLevel = Math.max(maxUpstreamLevel, upstreamLevel);
      } else if (warnOnIssues) {
        console.warn(`[WorkflowAdapter] Upstream group not found: ${upstreamName}`);
      }
    }

    const level = maxUpstreamLevel + 1;
    levelMap.set(groupName, level);
    return level;
  };

  // Compute levels for all groups
  for (const group of groups) {
    computeLevel(group.name, new Set());
  }

  // Group by level for lane assignment
  const groupsByLevel = new Map<number, string[]>();
  for (const group of groups) {
    const level = levelMap.get(group.name) ?? 0;
    if (!groupsByLevel.has(level)) {
      groupsByLevel.set(level, []);
    }
    groupsByLevel.get(level)!.push(group.name);
  }

  // Assign lanes within each level (sorted alphabetically for consistency)
  const laneMap = new Map<string, number>();
  for (const [, groupNames] of groupsByLevel) {
    groupNames.sort();
    groupNames.forEach((name, index) => {
      laneMap.set(name, index);
    });
  }

  // Build final result
  return groups.map((group) => ({
    ...group,
    id: group.name, // Use name as unique ID for ReactFlow
    level: levelMap.get(group.name) ?? 0,
    lane: laneMap.get(group.name) ?? 0,
  }));
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the maximum level in the DAG (for layout calculations).
 */
export function getMaxLevel(groups: GroupWithLayout[]): number {
  if (groups.length === 0) return 0;
  return Math.max(...groups.map((g) => g.level));
}

/**
 * Get groups organized by level (for layer-based rendering).
 */
export function getGroupsByLevel(groups: GroupWithLayout[]): Map<number, GroupWithLayout[]> {
  const result = new Map<number, GroupWithLayout[]>();

  for (const group of groups) {
    if (!result.has(group.level)) {
      result.set(group.level, []);
    }
    result.get(group.level)!.push(group);
  }

  return result;
}

/**
 * Get root nodes (level 0, no upstream dependencies).
 */
export function getRootGroups(groups: GroupWithLayout[]): GroupWithLayout[] {
  return groups.filter((g) => g.level === 0);
}

/**
 * Get leaf nodes (no downstream dependencies).
 */
export function getLeafGroups(groups: GroupWithLayout[]): GroupWithLayout[] {
  return groups.filter((g) => !g.downstream_groups || g.downstream_groups.length === 0);
}
