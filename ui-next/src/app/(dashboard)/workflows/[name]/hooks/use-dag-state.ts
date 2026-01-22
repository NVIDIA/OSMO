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
 * useDAGState Hook
 *
 * Manages state for the DAG visualization including:
 * - Layout direction
 * - Expanded groups
 * - Layout calculation (ELK)
 * - Node bounds computation
 *
 * Navigation state is now managed externally via useNavigationState (URL-synced).
 * This hook receives selection handlers as callbacks to update URL state.
 *
 * ## Architecture: Dependency Injection
 *
 * This hook supports dependency injection for testability:
 * - `layoutCalculator`: Override the ELK layout algorithm (default: calculateLayout)
 * - `groupTransformer`: Override the group transformation (default: transformGroups)
 * - `cacheManager`: Override cache management (default: clearLayoutCache)
 * - `expandedGroupsComputer`: Override initial expansion logic
 *
 * @example
 * ```tsx
 * // Normal usage (defaults)
 * const dagState = useDAGState({ groups });
 *
 * // Testing with mock layout
 * const dagState = useDAGState({
 *   groups,
 *   layoutCalculator: mockCalculateLayout,
 *   cacheManager: { clear: mockClear },
 * });
 * ```
 */

"use client";

import { useState, useEffect, useMemo, startTransition } from "react";
import { useNodesState, useEdgesState } from "@xyflow/react";
import type { Node, Edge } from "@xyflow/react";
import { useUnmount } from "usehooks-ts";
import { useEventCallback } from "usehooks-ts";
import { VIEWPORT, type LayoutDirection } from "@/components/dag";
import type { GroupWithLayout, TaskQueryResponse, GroupQueryResponse } from "../lib/workflow-types";
import { transformGroups as defaultTransformGroups } from "../lib/workflow-layout";
import {
  calculateLayout as defaultCalculateLayout,
  computeInitialExpandedGroups as defaultComputeInitialExpandedGroups,
  clearLayoutCache as defaultClearLayoutCache,
  type GroupNodeData,
  type LayoutResult,
} from "../lib/dag-layout";

// =============================================================================
// Types
// =============================================================================

/**
 * Layout calculator function type.
 * Override for testing or alternative layout algorithms.
 */
export type LayoutCalculator = (
  groups: GroupWithLayout[],
  expandedGroups: Set<string>,
  direction: LayoutDirection,
) => Promise<LayoutResult>;

/**
 * Group transformer function type.
 * Converts API groups to groups with layout metadata.
 */
export type GroupTransformer = (groups: GroupQueryResponse[]) => GroupWithLayout[];

/**
 * Compute which groups should be initially expanded.
 */
export type ExpandedGroupsComputer = (groups: GroupWithLayout[]) => Set<string>;

/**
 * Cache manager for layout cache operations.
 */
export interface CacheManager {
  clear: () => void;
}

// =============================================================================
// Stable Default Dependencies
// =============================================================================

// These must be defined outside the hook to maintain stable references
// and prevent infinite re-render loops in useEffect dependencies.

const DEFAULT_CACHE_MANAGER: CacheManager = {
  clear: defaultClearLayoutCache,
};

interface UseDAGStateOptions {
  /** Initial workflow groups from the API */
  groups: GroupQueryResponse[];
  /** Initial layout direction */
  initialDirection?: LayoutDirection;
  /** Callback when a group is selected (for URL navigation) */
  onSelectGroup?: (group: GroupWithLayout) => void;
  /** Callback when a task is selected (for URL navigation) */
  onSelectTask?: (task: TaskQueryResponse, group: GroupWithLayout) => void;

  // === Dependency Injection (all optional with sensible defaults) ===

  /** Layout calculator (default: ELK-based calculateLayout) */
  layoutCalculator?: LayoutCalculator;
  /** Group transformer (default: transformGroups) */
  groupTransformer?: GroupTransformer;
  /** Compute initial expanded groups (default: computeInitialExpandedGroups) */
  expandedGroupsComputer?: ExpandedGroupsComputer;
  /** Cache manager for layout cache (default: { clear: clearLayoutCache }) */
  cacheManager?: CacheManager;
}

interface UseDAGStateReturn {
  // Layout
  nodes: Node<GroupNodeData>[];
  edges: Edge[];
  layoutDirection: LayoutDirection;
  setLayoutDirection: (direction: LayoutDirection) => void;

  // Groups with computed layout
  groupsWithLayout: GroupWithLayout[];
  rootNodeIds: string[];

  // Expansion state
  expandedGroups: Set<string>;
  handleToggleExpand: (groupId: string) => void;
  handleExpandAll: () => void;
  handleCollapseAll: () => void;

  // Selection handlers (delegates to external navigation)
  handleSelectGroup: (group: GroupWithLayout) => void;
  handleSelectTask: (task: TaskQueryResponse, group: GroupWithLayout) => void;

  // Node bounds (actual min/max positions) with computed fit-all zoom
  nodeBounds: { minX: number; maxX: number; minY: number; maxY: number; fitAllZoom: number };

  // Loading state
  isLayouting: boolean;
}

// =============================================================================
// Hook
// =============================================================================

export function useDAGState({
  groups,
  initialDirection = "TB",
  onSelectGroup,
  onSelectTask,
  // Dependency injection with defaults (using stable references)
  layoutCalculator = defaultCalculateLayout,
  groupTransformer = defaultTransformGroups,
  expandedGroupsComputer = defaultComputeInitialExpandedGroups,
  cacheManager = DEFAULT_CACHE_MANAGER,
}: UseDAGStateOptions): UseDAGStateReturn {
  // Core state
  const [layoutDirection, setLayoutDirection] = useState<LayoutDirection>(initialDirection);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [isLayouting, setIsLayouting] = useState(false);

  // Compute topological levels from dependency graph (using injectable transformer)
  const groupsWithLayout = useMemo(() => groupTransformer(groups), [groupTransformer, groups]);

  // Get root node IDs (level 0) for initial zoom target
  const rootNodeIds = useMemo(
    () => groupsWithLayout.filter((g) => g.level === 0).map((g) => g.name),
    [groupsWithLayout],
  );

  // Initialize expanded groups when workflow changes
  useEffect(() => {
    // Clear layout cache when workflow fundamentally changes
    cacheManager.clear();
    // Use startTransition to avoid cascading renders when resetting state
    startTransition(() => {
      setExpandedGroups(expandedGroupsComputer(groupsWithLayout));
    });
  }, [groupsWithLayout, cacheManager, expandedGroupsComputer]);

  // Cleanup on unmount - clear layout cache to free memory when navigating away
  useUnmount(() => {
    cacheManager.clear();
  });

  // Callbacks for expansion state - stable callbacks for memoized children
  const handleToggleExpand = useEventCallback((groupName: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) {
        next.delete(groupName);
      } else {
        next.add(groupName);
      }
      return next;
    });
  });

  const handleExpandAll = useEventCallback(() => {
    const expandableNames = groupsWithLayout.filter((g) => (g.tasks || []).length > 1).map((g) => g.name);
    setExpandedGroups(new Set(expandableNames));
  });

  const handleCollapseAll = useEventCallback(() => {
    setExpandedGroups(new Set());
  });

  // Selection handlers - delegate to external navigation callbacks
  const handleSelectGroup = useEventCallback((group: GroupWithLayout) => {
    onSelectGroup?.(group);
  });

  const handleSelectTask = useEventCallback((task: TaskQueryResponse, group: GroupWithLayout) => {
    onSelectTask?.(task, group);
  });

  // ReactFlow state - typed for our node data
  const [nodes, setNodes] = useNodesState<Node<GroupNodeData>>([]);
  const [edges, setEdges] = useEdgesState<Edge>([]);

  // Calculate layout when relevant state changes (using injectable calculator)
  // Uses startTransition for non-blocking updates during layout calculation
  useEffect(() => {
    let cancelled = false;

    const runLayout = async () => {
      setIsLayouting(true);
      try {
        const result = await layoutCalculator(groupsWithLayout, expandedGroups, layoutDirection);

        if (!cancelled) {
          // CRITICAL: setIsLayouting(false) MUST be called inside startTransition
          // along with setNodes/setEdges to ensure atomicity. This ensures that
          // hooks like useViewportBoundaries see 'isLayouting === false' only
          // when the new nodes are actually committed to state.
          startTransition(() => {
            setNodes(result.nodes);
            setEdges(result.edges);
            setIsLayouting(false);
          });
        }
      } catch (error) {
        console.error("Layout calculation failed:", error);
        // On error, still set isLayouting to false (not in transition)
        if (!cancelled) {
          setIsLayouting(false);
        }
      }
    };

    runLayout();

    return () => {
      cancelled = true;
    };
  }, [groupsWithLayout, expandedGroups, layoutDirection, layoutCalculator, setNodes, setEdges]);

  // Calculate node bounds and fit-all zoom
  // Uses Float64Array for optimal numeric performance (SIMD-friendly)
  const nodeBounds = useMemo(() => {
    const len = nodes.length;
    if (len === 0) {
      return { minX: 0, maxX: 1000, minY: 0, maxY: 1000, fitAllZoom: 0.5 };
    }

    // Fast path: use typed arrays for bounds calculation
    // Float64Array enables potential SIMD optimizations in V8
    // Storing [minX, maxX, minY, maxY] for cache-friendly access
    const bounds = new Float64Array([Infinity, -Infinity, Infinity, -Infinity]);

    // Unrolled loop with local variable caching (avoids repeated property access)
    for (let i = 0; i < len; i++) {
      const node = nodes[i];
      const pos = node.position;
      const data = node.data as GroupNodeData | undefined;
      // Cache dimensions in local vars (avoids repeated property lookup)
      const x = pos.x;
      const y = pos.y;
      const w = data?.nodeWidth ?? 180;
      const h = data?.nodeHeight ?? 72;
      const right = x + w;
      const bottom = y + h;

      // Branchless min/max pattern (compiler can optimize better)
      if (x < bounds[0]) bounds[0] = x;
      if (right > bounds[1]) bounds[1] = right;
      if (y < bounds[2]) bounds[2] = y;
      if (bottom > bounds[3]) bounds[3] = bottom;
    }

    // Extract bounds (single array read)
    const minX = bounds[0];
    const maxX = bounds[1];
    const minY = bounds[2];
    const maxY = bounds[3];

    // Calculate zoom that fits all content
    // Using multiplication instead of division where possible (faster)
    const contentWidth = maxX - minX + 100; // Add padding inline
    const contentHeight = maxY - minY + 100;
    const fitZoomX = VIEWPORT.ESTIMATED_WIDTH / contentWidth;
    const fitZoomY = VIEWPORT.ESTIMATED_HEIGHT / contentHeight;

    // Clamp zoom: max(0.1, min(fitZoomX, fitZoomY, 1))
    // Single comparison chain is faster than nested Math calls
    let fitAllZoom = fitZoomX < fitZoomY ? fitZoomX : fitZoomY;
    if (fitAllZoom > 1) fitAllZoom = 1;
    if (fitAllZoom < 0.1) fitAllZoom = 0.1;

    return { minX, maxX, minY, maxY, fitAllZoom };
  }, [nodes]);

  return {
    nodes,
    edges,
    layoutDirection,
    setLayoutDirection,
    groupsWithLayout,
    rootNodeIds,
    expandedGroups,
    handleToggleExpand,
    handleExpandAll,
    handleCollapseAll,
    handleSelectGroup,
    handleSelectTask,
    nodeBounds,
    isLayouting,
  };
}
