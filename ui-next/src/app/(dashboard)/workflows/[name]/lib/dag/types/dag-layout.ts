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
 * DAG Layout Types
 *
 * Type definitions for the ReactFlow DAG visualization layout.
 */

import type { Node, Edge } from "@xyflow/react";
import type { GroupWithLayout } from "../workflow-types";

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
