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
 * Workflow DAG Layout Types
 *
 * Workflow-specific type definitions for the DAG visualization.
 */

import type { Node, Edge } from "@xyflow/react";
import type { LayoutDirection } from "@/components/dag";
import type { GroupWithLayout } from "../workflow-types";

// ============================================================================
// Workflow-Specific Node Data
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

/** Result of the workflow layout calculation */
export interface LayoutResult {
  nodes: Node<GroupNodeData>[];
  edges: Edge[];
}
