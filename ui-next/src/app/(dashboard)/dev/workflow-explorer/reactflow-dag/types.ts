// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * DAG Visualizer Types
 *
 * Type definitions for the ReactFlow DAG visualization.
 */

import type { Node, Edge } from "@xyflow/react";
import type { GroupWithLayout, TaskQueryResponse } from "../workflow-types";

// ============================================================================
// Layout Types
// ============================================================================

/** Layout direction for the DAG */
export type LayoutDirection = "TB" | "LR";

/** Node dimensions */
export interface NodeDimensions {
  width: number;
  height: number;
}

// ============================================================================
// Node Data Types
// ============================================================================

/**
 * Data passed to the GroupNode component via ReactFlow.
 * Extends Record<string, unknown> as required by ReactFlow.
 *
 * Note: Callbacks (onSelectTask, onToggleExpand) are accessed via DAGContext
 * to prevent re-renders when callbacks change reference.
 */
export interface GroupNodeData extends Record<string, unknown> {
  /** The group data from the workflow */
  group: GroupWithLayout;

  /** Whether this node is currently selected */
  isSelected: boolean;

  /** Whether this node is expanded (showing task list) */
  isExpanded: boolean;

  /** Current layout direction */
  layoutDirection: LayoutDirection;

  /** Node width for bounds calculations and MiniMap */
  nodeWidth: number;

  /** Node height for bounds calculations and MiniMap */
  nodeHeight: number;

  /** Whether this node has incoming edges (for handle rendering) */
  hasIncomingEdges: boolean;

  /** Whether this node has outgoing edges (for handle rendering) */
  hasOutgoingEdges: boolean;
}

// ============================================================================
// Layout Result Types
// ============================================================================

/** Result of the layout calculation */
export interface LayoutResult {
  nodes: Node<GroupNodeData>[];
  edges: Edge[];
}

/** Bounds of the graph for pan/zoom limits */
export interface GraphBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  fitAllZoom: number;
}

// ============================================================================
// Selection State Types
// ============================================================================

/** Current selection state */
export interface SelectionState {
  selectedGroup: GroupWithLayout | null;
  selectedTask: TaskQueryResponse | null;
}

// ============================================================================
// ELK Layout Types
// ============================================================================

/** ELK node for layout input */
export interface ElkNode {
  id: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
}

/** ELK edge for layout input */
export interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
}

/** ELK graph structure */
export interface ElkGraph {
  id: string;
  layoutOptions: Record<string, string>;
  children: ElkNode[];
  edges: ElkEdge[];
}

/** ELK layout result node */
export interface ElkLayoutNode extends ElkNode {
  x: number;
  y: number;
}

/** ELK layout result */
export interface ElkLayoutResult {
  id: string;
  children: ElkLayoutNode[];
  edges: ElkEdge[];
}
