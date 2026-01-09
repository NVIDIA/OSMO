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
import type { GroupWithLayout, TaskQueryResponse, GroupQueryResponse } from "../workflow-types";
import { transformGroups } from "../adapters";
import type { LayoutDirection, GroupNodeData } from "../types/dag-layout";
import { calculateLayout, computeInitialExpandedGroups, clearLayoutCache } from "../layout/elk-layout";
import {
  ESTIMATED_VIEWPORT_WIDTH,
  ESTIMATED_VIEWPORT_HEIGHT,
  AUTO_COLLAPSE_TASK_THRESHOLD,
  AUTO_COLLAPSE_GROUP_THRESHOLD,
} from "../constants";

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

    setExpandedGroups(
      computeInitialExpandedGroups(groupsWithLayout, AUTO_COLLAPSE_TASK_THRESHOLD, AUTO_COLLAPSE_GROUP_THRESHOLD),
    );
    // Clear selection on workflow change
    setPanelView("none");
    setSelectedGroup(null);
    setSelectedTask(null);
  }, [groupsWithLayout]);

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
  const nodeBounds = useMemo(() => {
    if (nodes.length === 0) {
      return { minX: 0, maxX: 1000, minY: 0, maxY: 1000, fitAllZoom: 0.5 };
    }

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;

    nodes.forEach((node) => {
      const nodeData = node.data as GroupNodeData | undefined;
      const width = nodeData?.nodeWidth || 180;
      const height = nodeData?.nodeHeight || 72;
      minX = Math.min(minX, node.position.x);
      maxX = Math.max(maxX, node.position.x + width);
      minY = Math.min(minY, node.position.y);
      maxY = Math.max(maxY, node.position.y + height);
    });

    // Calculate zoom that fits all content
    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const fitZoomX = ESTIMATED_VIEWPORT_WIDTH / (contentWidth + 100);
    const fitZoomY = ESTIMATED_VIEWPORT_HEIGHT / (contentHeight + 100);
    const fitAllZoom = Math.max(0.1, Math.min(fitZoomX, fitZoomY, 1));

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
