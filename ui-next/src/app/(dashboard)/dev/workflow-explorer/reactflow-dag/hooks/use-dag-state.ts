// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

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
import type { GroupWithLayout, TaskQueryResponse, GroupQueryResponse } from "../../workflow-types";
import { computeTopologicalLevelsFromGraph } from "../../workflow-types";
import type { LayoutDirection, GraphBounds, GroupNodeData } from "../types";
import { calculateLayout, computeInitialExpandedGroups } from "../layout/elk-layout";
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

  // Legacy (for backwards compatibility)
  handleCloseDetail: () => void;

  // Bounds for viewport
  nodeBounds: GraphBounds;

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
  const groupsWithLayout = useMemo(() => computeTopologicalLevelsFromGraph(groups), [groups]);

  // Get root node IDs (level 0) for initial zoom target
  const rootNodeIds = useMemo(
    () => groupsWithLayout.filter((g) => g.level === 0).map((g) => g.name),
    [groupsWithLayout],
  );

  // Initialize expanded groups when workflow changes
  useEffect(() => {
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
    setSelectedTask(null);
    setPanelView("group");
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

  // Legacy alias for backwards compatibility
  const handleCloseDetail = handleClosePanel;

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

  // Calculate bounds for viewport
  const nodeBounds = useMemo((): GraphBounds => {
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

    const paddingX = ESTIMATED_VIEWPORT_WIDTH / 2;
    const paddingY = ESTIMATED_VIEWPORT_HEIGHT / 2;
    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const fitZoomX = ESTIMATED_VIEWPORT_WIDTH / (contentWidth + 100);
    const fitZoomY = ESTIMATED_VIEWPORT_HEIGHT / (contentHeight + 100);
    const fitAllZoom = Math.min(fitZoomX, fitZoomY, 1);

    return {
      minX: minX - paddingX,
      maxX: maxX + paddingX,
      minY: minY - paddingY,
      maxY: maxY + paddingY,
      fitAllZoom: Math.max(0.1, fitAllZoom),
    };
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
    handleCloseDetail,
    nodeBounds,
    isLayouting,
  };
}
