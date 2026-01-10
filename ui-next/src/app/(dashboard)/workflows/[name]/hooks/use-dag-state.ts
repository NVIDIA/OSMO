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
 * - Selected group (for GroupPanel)
 * - Selected task (for DetailPanel)
 * - Layout calculation
 *
 * Navigation flow:
 * - Click GROUP node (multi-task) → Opens GroupPanel
 * - Click task in GroupPanel → Opens DetailPanel
 * - Click SINGLE-TASK node → Opens DetailPanel directly
 */

"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useNodesState, useEdgesState } from "@xyflow/react";
import type { Node, Edge } from "@xyflow/react";
import { VIEWPORT, type LayoutDirection } from "@/components/dag";
import type { GroupWithLayout, TaskQueryResponse, GroupQueryResponse } from "../lib/workflow-types";
import { transformGroups } from "../lib/workflow-adapter";
import { calculateLayout, computeInitialExpandedGroups, clearLayoutCache, type GroupNodeData } from "../lib/dag-layout";

interface UseDAGStateOptions {
  /** Initial workflow groups from the API */
  groups: GroupQueryResponse[];
  /** Initial layout direction */
  initialDirection?: LayoutDirection;
}

/**
 * Panel view state for navigation.
 * - "none" → No panel open
 * - "group" → GroupPanel showing task list
 * - "task" → DetailPanel showing single task
 */
export type PanelView = "none" | "group" | "task";

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

  // Panel navigation state
  panelView: PanelView;
  selectedGroup: GroupWithLayout | null;
  selectedTask: TaskQueryResponse | null;

  // Panel actions
  handleSelectGroup: (group: GroupWithLayout) => void;
  handleSelectTask: (task: TaskQueryResponse, group: GroupWithLayout) => void;
  handleClosePanel: () => void;
  handleBackToGroup: () => void;

  // Node bounds (actual min/max positions) with computed fit-all zoom
  nodeBounds: { minX: number; maxX: number; minY: number; maxY: number; fitAllZoom: number };

  // Loading state
  isLayouting: boolean;
}

export function useDAGState({ groups, initialDirection = "TB" }: UseDAGStateOptions): UseDAGStateReturn {
  // Core state
  const [layoutDirection, setLayoutDirection] = useState<LayoutDirection>(initialDirection);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [isLayouting, setIsLayouting] = useState(false);

  // Panel navigation state
  const [panelView, setPanelView] = useState<PanelView>("none");
  const [selectedGroup, setSelectedGroup] = useState<GroupWithLayout | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskQueryResponse | null>(null);

  // Compute topological levels from dependency graph
  const groupsWithLayout = useMemo(() => transformGroups(groups), [groups]);

  // Get root node IDs (level 0) for initial zoom target
  const rootNodeIds = useMemo(
    () => groupsWithLayout.filter((g) => g.level === 0).map((g) => g.name),
    [groupsWithLayout],
  );

  // Initialize expanded groups when workflow changes
  useEffect(() => {
    // Clear layout cache when workflow fundamentally changes
    clearLayoutCache();

    setExpandedGroups(computeInitialExpandedGroups(groupsWithLayout));
    // Clear selection on workflow change
    setPanelView("none");
    setSelectedGroup(null);
    setSelectedTask(null);
  }, [groupsWithLayout]);

  // Cleanup on unmount - clear layout cache to free memory when navigating away
  useEffect(() => {
    return () => {
      clearLayoutCache();
    };
  }, []);

  // Callbacks for expansion state
  const handleToggleExpand = useCallback((groupName: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) {
        next.delete(groupName);
      } else {
        next.add(groupName);
      }
      return next;
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    const expandableNames = groupsWithLayout.filter((g) => (g.tasks || []).length > 1).map((g) => g.name);
    setExpandedGroups(new Set(expandableNames));
  }, [groupsWithLayout]);

  const handleCollapseAll = useCallback(() => {
    setExpandedGroups(new Set());
  }, []);

  // Panel navigation callbacks
  const handleSelectGroup = useCallback((group: GroupWithLayout) => {
    setSelectedGroup(group);
    // Single-task groups go directly to task details (consistent with node click behavior)
    if (group.tasks && group.tasks.length === 1) {
      setSelectedTask(group.tasks[0]);
      setPanelView("task");
    } else {
      setSelectedTask(null);
      setPanelView("group");
    }
  }, []);

  const handleSelectTask = useCallback((task: TaskQueryResponse, group: GroupWithLayout) => {
    setSelectedGroup(group);
    setSelectedTask(task);
    setPanelView("task");
  }, []);

  const handleClosePanel = useCallback(() => {
    setPanelView("none");
    setSelectedGroup(null);
    setSelectedTask(null);
  }, []);

  const handleBackToGroup = useCallback(() => {
    // Go back from task detail to group panel
    setSelectedTask(null);
    setPanelView("group");
  }, []);

  // ReactFlow state - typed for our node data
  const [nodes, setNodes] = useNodesState<Node<GroupNodeData>>([]);
  const [edges, setEdges] = useEdgesState<Edge>([]);

  // Calculate layout when relevant state changes
  useEffect(() => {
    let cancelled = false;

    const runLayout = async () => {
      setIsLayouting(true);
      try {
        const result = await calculateLayout(groupsWithLayout, expandedGroups, layoutDirection);

        if (!cancelled) {
          setNodes(result.nodes);
          setEdges(result.edges);
        }
      } catch (error) {
        console.error("Layout calculation failed:", error);
      } finally {
        if (!cancelled) {
          setIsLayouting(false);
        }
      }
    };

    runLayout();

    return () => {
      cancelled = true;
    };
  }, [groupsWithLayout, expandedGroups, layoutDirection, setNodes, setEdges]);

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
    panelView,
    selectedGroup,
    selectedTask,
    handleSelectGroup,
    handleSelectTask,
    handleClosePanel,
    handleBackToGroup,
    nodeBounds,
    isLayouting,
  };
}
