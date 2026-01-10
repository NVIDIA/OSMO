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
 * - Resizable side panels
 * - Generic node/edge types for any domain
 *
 * @example
 * ```tsx
 * import { DAGProvider, calculatePositions, buildEdges, DAGControls } from "@/components/dag";
 *
 * function MyDAG() {
 *   const positions = await calculatePositions(nodes, "TB");
 *   const edges = buildEdges(nodes, getEdgeStyle);
 *
 *   return (
 *     <DAGProvider onSelectNode={handleSelect} onToggleExpand={handleToggle}>
 *       <ReactFlow nodes={flowNodes} edges={edges}>
 *         <DAGControls ... />
 *       </ReactFlow>
 *     </DAGProvider>
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
  useResizablePanel,
  type UseViewportBoundariesOptions,
  type ViewportBoundariesResult,
  type NodeBounds,
  type UseResizablePanelOptions,
  type UseResizablePanelReturn,
} from "./hooks";

// Components
export { DAGControls, DAGErrorBoundary, FitViewOnLayoutChange, MiniMapNode, MINIMAP_COLORS } from "./components";
export type { DAGControlsProps, FitViewOnLayoutChangeProps } from "./components";

// Context
export { DAGProvider, useDAGContext, type DAGContextValue, type DAGProviderProps } from "./context";
