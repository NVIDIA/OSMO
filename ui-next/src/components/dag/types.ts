/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Generic DAG Types
 *
 * Type definitions for the generic DAG visualization component.
 * These types are framework-agnostic and can be used with any domain data.
 */

import type { Node, Edge } from "@xyflow/react";

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
// Generic Node Data
// ============================================================================

/**
 * Base interface for DAG node data.
 * Consumers should extend this with their domain-specific properties.
 *
 * @example
 * ```tsx
 * interface WorkflowNodeData extends DAGNodeData {
 *   group: WorkflowGroup;
 *   status: string;
 * }
 * ```
 */
export interface DAGNodeData extends Record<string, unknown> {
  /** Unique identifier for the node */
  id: string;

  /** Display label for the node */
  label: string;

  /** Whether this node is expanded (for collapsible nodes) */
  isExpanded?: boolean;

  /** Current layout direction */
  layoutDirection: LayoutDirection;

  /** Node width for bounds calculations */
  nodeWidth: number;

  /** Node height for bounds calculations */
  nodeHeight: number;

  /** Whether this node has incoming edges (for handle rendering) */
  hasIncomingEdges: boolean;

  /** Whether this node has outgoing edges (for handle rendering) */
  hasOutgoingEdges: boolean;
}

// ============================================================================
// Graph Input Types
// ============================================================================

/**
 * Input node for DAG layout calculation.
 * Represents a node before layout positioning.
 */
export interface DAGInputNode {
  /** Unique identifier */
  id: string;

  /** Display label */
  label: string;

  /** Node width in pixels */
  width: number;

  /** Node height in pixels */
  height: number;

  /** IDs of downstream/child nodes */
  downstreamIds: string[];

  /** Optional additional data to pass to the node */
  data?: Record<string, unknown>;
}

/**
 * Input for DAG layout calculation.
 */
export interface DAGInput {
  /** Nodes to layout */
  nodes: DAGInputNode[];

  /** Layout direction */
  direction: LayoutDirection;
}

// ============================================================================
// Layout Result Types
// ============================================================================

/** Result of the layout calculation */
export interface LayoutResult<TNodeData extends DAGNodeData = DAGNodeData> {
  nodes: Node<TNodeData>[];
  edges: Edge[];
}

/**
 * Position data returned from layout calculation.
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

// ============================================================================
// Edge Styling Types
// ============================================================================

/**
 * Edge style configuration.
 * Used for styling edges based on status or other criteria.
 */
export interface EdgeStyle {
  /** Stroke color */
  color: string;

  /** Stroke color for selected/hover state */
  strokeColor: string;

  /** Whether the edge should be animated */
  animated?: boolean;

  /** Whether the edge should be dashed */
  dashed?: boolean;
}

// ============================================================================
// Callback Types
// ============================================================================

/**
 * Callback when a node is selected.
 */
export type OnNodeSelect<T = unknown> = (nodeId: string, data: T) => void;

/**
 * Callback when a node's expanded state changes.
 */
export type OnNodeToggleExpand = (nodeId: string) => void;
