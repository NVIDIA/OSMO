// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * ELK Layout Module
 *
 * Handles DAG layout using ELK.js (Eclipse Layout Kernel).
 * ELK provides better layout algorithms than dagre, including:
 * - Native support for variable-sized nodes
 * - Web worker support for non-blocking layout
 * - Better edge routing
 */

import ELK from "elkjs/lib/elk.bundled.js";
import type { Node, Edge } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import type { GroupWithLayout, TaskQueryResponse } from "../../workflow-types";
import type {
  LayoutDirection,
  GroupNodeData,
  NodeDimensions,
  LayoutResult,
  ElkGraph,
  ElkLayoutResult,
} from "../types";
import { getStatusCategory } from "../utils/status";
import {
  NODE_COLLAPSED_WIDTH,
  NODE_COLLAPSED_HEIGHT,
  NODE_EXPANDED_WIDTH,
  NODE_MAX_EXPANDED_HEIGHT,
  NODE_HEADER_HEIGHT,
  TASK_ROW_HEIGHT,
  TASK_LIST_PADDING,
  SPACING_NODES_TB,
  SPACING_NODES_LR,
  SPACING_RANKS_TB,
  SPACING_RANKS_LR,
  LAYOUT_MARGIN,
  EDGE_STROKE_WIDTH,
  EDGE_DASH_ARRAY,
  ARROW_WIDTH,
  ARROW_HEIGHT,
  STATUS_STYLES,
} from "../constants";

// Create ELK instance (can be moved to web worker for large graphs)
const elk = new ELK();

// ============================================================================
// Dimension Calculations
// ============================================================================

/**
 * Calculate the actual dimensions of a node based on its state.
 *
 * @param group - The group data
 * @param isExpanded - Whether the node is expanded
 * @returns Node dimensions
 */
export function getNodeDimensions(
  group: GroupWithLayout,
  isExpanded: boolean
): NodeDimensions {
  const tasks = group.tasks || [];
  const hasManyTasks = tasks.length > 1;

  if (isExpanded && hasManyTasks) {
    const taskListHeight = tasks.length * TASK_ROW_HEIGHT + TASK_LIST_PADDING;
    return {
      width: NODE_EXPANDED_WIDTH,
      height: Math.min(NODE_HEADER_HEIGHT + taskListHeight, NODE_MAX_EXPANDED_HEIGHT),
    };
  }

  return {
    width: NODE_COLLAPSED_WIDTH,
    height: NODE_COLLAPSED_HEIGHT,
  };
}

// ============================================================================
// ELK Layout Configuration
// ============================================================================

/**
 * Get ELK layout options for the given direction.
 *
 * @param direction - Layout direction (TB or LR)
 * @returns ELK layout options
 */
function getElkLayoutOptions(direction: LayoutDirection): Record<string, string> {
  return {
    "elk.algorithm": "layered",
    "elk.direction": direction === "TB" ? "DOWN" : "RIGHT",
    // Spacing between sibling nodes
    "elk.spacing.nodeNode": String(direction === "TB" ? SPACING_NODES_TB : SPACING_NODES_LR),
    // Spacing between layers/ranks
    "elk.layered.spacing.nodeNodeBetweenLayers": String(
      direction === "TB" ? SPACING_RANKS_TB : SPACING_RANKS_LR
    ),
    // Node placement strategy - network simplex minimizes edge length
    "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    // Edge routing - orthogonal for clean 90-degree edges
    "elk.edgeRouting": "ORTHOGONAL",
    // Margins
    "elk.padding": `[top=${LAYOUT_MARGIN},left=${LAYOUT_MARGIN},bottom=${LAYOUT_MARGIN},right=${LAYOUT_MARGIN}]`,
    // Align nodes considering their sizes
    "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  };
}

// ============================================================================
// Layout Calculation
// ============================================================================

/**
 * Position data returned from ELK layout.
 * Separates layout computation from node data creation.
 */
export interface LayoutPosition {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Result of pure layout calculation (positions only).
 */
export interface LayoutPositionResult {
  positions: Map<string, LayoutPosition>;
  dimensions: Map<string, NodeDimensions>;
}

/**
 * Calculate positions for DAG nodes using ELK (pure layout, no callbacks).
 *
 * @param groups - The workflow groups
 * @param expandedGroups - Set of expanded group names
 * @param direction - Layout direction
 * @returns Promise resolving to position map
 */
export async function calculatePositions(
  groups: GroupWithLayout[],
  expandedGroups: Set<string>,
  direction: LayoutDirection
): Promise<LayoutPositionResult> {
  // Build dimension map for all nodes - O(n)
  const dimensionsMap = new Map<string, NodeDimensions>();
  groups.forEach((group) => {
    const isExpanded = expandedGroups.has(group.name);
    dimensionsMap.set(group.name, getNodeDimensions(group, isExpanded));
  });

  // Build ELK graph
  const elkGraph: ElkGraph = {
    id: "root",
    layoutOptions: getElkLayoutOptions(direction),
    children: groups.map((group) => {
      const dims = dimensionsMap.get(group.name)!;
      return {
        id: group.name,
        width: dims.width,
        height: dims.height,
      };
    }),
    edges: groups.flatMap((group) => {
      const downstreams = group.downstream_groups || [];
      return downstreams.map((downstream) => ({
        id: `${group.name}-${downstream}`,
        sources: [group.name],
        targets: [downstream],
      }));
    }),
  };

  // Run ELK layout
  const layoutResult = (await elk.layout(elkGraph)) as ElkLayoutResult;

  // Build position map - O(n) lookup later
  const positions = new Map<string, LayoutPosition>();
  layoutResult.children.forEach((elkNode) => {
    const dims = dimensionsMap.get(elkNode.id);
    if (dims) {
      positions.set(elkNode.id, {
        id: elkNode.id,
        x: elkNode.x,
        y: elkNode.y,
        width: dims.width,
        height: dims.height,
      });
    }
  });

  return { positions, dimensions: dimensionsMap };
}

/**
 * Build ReactFlow nodes from layout positions and group data.
 * Separated from layout to allow callback injection at a higher level.
 *
 * @param groups - The workflow groups
 * @param positions - Position map from calculatePositions
 * @param expandedGroups - Set of expanded group names
 * @param direction - Layout direction
 * @param onSelectTask - Callback for task selection
 * @param onToggleExpand - Callback for expand/collapse
 * @returns ReactFlow nodes
 */
export function buildNodes(
  groups: GroupWithLayout[],
  positions: Map<string, LayoutPosition>,
  expandedGroups: Set<string>,
  direction: LayoutDirection,
  onSelectTask: (task: TaskQueryResponse, group: GroupWithLayout) => void,
  onToggleExpand: (groupId: string) => void
): Node<GroupNodeData>[] {
  // Build group lookup map for O(1) access
  const groupMap = new Map<string, GroupWithLayout>();
  groups.forEach((group) => groupMap.set(group.name, group));

  return groups
    .map((group) => {
      const pos = positions.get(group.name);
      if (!pos) {
        console.warn(`No position found for group: ${group.name}`);
        return null;
      }

      return {
        id: group.name,
        type: "collapsibleGroup",
        position: { x: pos.x, y: pos.y },
        // Dimensions for MiniMap and bounds calculations
        initialWidth: pos.width,
        initialHeight: pos.height,
        data: {
          group,
          isSelected: false, // Selection state managed separately
          isExpanded: expandedGroups.has(group.name),
          layoutDirection: direction,
          onSelectTask,
          onToggleExpand,
          nodeWidth: pos.width,
          nodeHeight: pos.height,
        },
      };
    })
    .filter((node): node is Node<GroupNodeData> => node !== null);
}

/**
 * Build ReactFlow edges from groups.
 *
 * @param groups - The workflow groups
 * @returns ReactFlow edges
 */
export function buildEdges(groups: GroupWithLayout[]): Edge[] {
  return groups.flatMap((group) => {
    const category = getStatusCategory(group.status);
    const edgeColor = STATUS_STYLES[category].color;
    const isTerminal = category === "completed" || category === "failed";
    const downstreams = group.downstream_groups || [];

    return downstreams.map((downstreamName) => ({
      id: `${group.name}-${downstreamName}`,
      source: group.name,
      target: downstreamName,
      sourceHandle: "source",
      targetHandle: "target",
      type: "smoothstep",
      animated: category === "running",
      style: {
        stroke: edgeColor,
        strokeWidth: EDGE_STROKE_WIDTH,
        strokeDasharray: isTerminal || category === "running" ? undefined : EDGE_DASH_ARRAY,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: edgeColor,
        width: ARROW_WIDTH,
        height: ARROW_HEIGHT,
      },
    }));
  });
}

/**
 * Calculate layout for DAG nodes and edges using ELK.
 * Convenience function that combines position calculation and node building.
 *
 * @param groups - The workflow groups
 * @param expandedGroups - Set of expanded group names
 * @param direction - Layout direction
 * @param onSelectTask - Callback for task selection
 * @param onToggleExpand - Callback for expand/collapse
 * @returns Promise resolving to layouted nodes and edges
 */
export async function calculateLayout(
  groups: GroupWithLayout[],
  expandedGroups: Set<string>,
  direction: LayoutDirection,
  onSelectTask: (task: TaskQueryResponse, group: GroupWithLayout) => void,
  onToggleExpand: (groupId: string) => void
): Promise<LayoutResult> {
  const { positions } = await calculatePositions(groups, expandedGroups, direction);
  const nodes = buildNodes(groups, positions, expandedGroups, direction, onSelectTask, onToggleExpand);
  const edges = buildEdges(groups);

  return { nodes, edges };
}

// ============================================================================
// Initial Expansion State
// ============================================================================

/**
 * Compute which groups should be initially expanded.
 *
 * @param groups - The workflow groups
 * @param taskThreshold - Collapse groups with this many tasks
 * @param groupThreshold - Collapse all if this many groups
 * @returns Set of group names that should be expanded
 */
export function computeInitialExpandedGroups(
  groups: GroupWithLayout[],
  taskThreshold = 20,
  groupThreshold = 10
): Set<string> {
  // Only multi-task groups are expandable
  const expandableGroups = groups.filter((g) => (g.tasks || []).length > 1);

  // If no expandable groups, return empty
  if (expandableGroups.length === 0) {
    return new Set();
  }

  // If only 1 expandable group, expand it
  if (expandableGroups.length === 1) {
    return new Set(expandableGroups.map((g) => g.name));
  }

  // If many groups, collapse all
  if (groups.length >= groupThreshold) {
    return new Set();
  }

  // Otherwise, expand groups with fewer tasks than threshold
  return new Set(
    expandableGroups
      .filter((g) => (g.tasks || []).length < taskThreshold)
      .map((g) => g.name)
  );
}
