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
 * Generic DAG Component
 *
 * A reusable directed acyclic graph (DAG) visualization component built on ReactFlow.
 *
 * Features:
 * - ELK.js layout with web worker support
 * - Viewport boundary management
 * - Generic node/edge types for any domain
 *
 * Note: For resizable panels, import from `@/components/panel`.
 * For domain-specific context (e.g., workflow DAG), create your own context.
 *
 * @example
 * ```tsx
 * import { calculatePositions, buildEdges, DAGControls, VIEWPORT } from "@/components/dag";
 * import { useResizablePanel } from "@/components/panel";
 *
 * function MyDAG() {
 *   const positions = await calculatePositions(nodes, "TB");
 *   const edges = buildEdges(nodes, getEdgeStyle);
 *
 *   return (
 *     <ReactFlow nodes={flowNodes} edges={edges}>
 *       <DAGControls ... />
 *     </ReactFlow>
 *   );
 * }
 * ```
 */

// Import CSS (consumers should import this or the component)
import "./dag.css";

// Types
export type {
  LayoutDirection,
  NodeDimensions,
  DAGNodeData,
  DAGInputNode,
  DAGInput,
  LayoutResult,
  LayoutPosition,
  LayoutPositionResult,
  ElkNode,
  ElkEdge,
  ElkGraph,
  ElkLayoutNode,
  ElkLayoutResult,
  EdgeStyle,
  OnNodeSelect,
  OnNodeToggleExpand,
} from "./types";

// Constants
export {
  remToPx,
  NODE_DEFAULTS,
  NODE_EXPANDED,
  LAYOUT_SPACING,
  VIEWPORT,
  VIEWPORT_THRESHOLDS,
  MINIMAP,
  BACKGROUND,
  HANDLE_OFFSET,
  EDGE_STYLE,
  ANIMATION,
  PANEL,
  LAYOUT_CACHE,
} from "./constants";

// Layout utilities
export {
  elkWorker,
  preloadElkWorker,
  isElkWorkerReady,
  calculatePositions,
  buildEdges,
  findRootNodes,
  computeInitialExpandedNodes,
  clearLayoutCache,
  type EdgeStyleProvider,
} from "./layout";

// Hooks
export {
  useViewportBoundaries,
  type UseViewportBoundariesOptions,
  type ViewportBoundariesResult,
  type NodeBounds,
} from "./hooks";

// Components
export { DAGControls, DAGErrorBoundary, MiniMapNode, MINIMAP_COLORS } from "./components";
export type { DAGControlsProps } from "./components";

// Debug utilities (console logging only, gated by ?debug=true)
export { dagDebug } from "./lib/dag-debug";
