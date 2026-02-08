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
 * Generic ELK Layout Module
 *
 * Handles DAG layout using ELK.js (Eclipse Layout Kernel).
 * This module provides generic layout calculation without domain-specific logic.
 */

import type { Edge } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import type {
  LayoutDirection,
  NodeDimensions,
  LayoutPosition,
  LayoutPositionResult,
  ElkGraph,
  DAGInputNode,
  EdgeStyle,
} from "@/components/dag/types";
import { LAYOUT_SPACING, EDGE_STYLE, LAYOUT_CACHE } from "@/components/dag/constants";
import { elkWorker } from "@/components/dag/layout/elk-worker-client";

// ============================================================================
// Layout Cache
// ============================================================================

/**
 * Generate cache key from input nodes and direction.
 * Uses array building for better performance than string concatenation.
 */
function getLayoutCacheKey(nodes: DAGInputNode[], direction: LayoutDirection): string {
  // Pre-allocate array for known size (direction + node count)
  const parts: string[] = [direction];
  for (const n of nodes) {
    parts.push(n.id, String(n.width), String(n.height));
  }
  return parts.join("|");
}

/**
 * LRU-style cache for layout results.
 * Uses Map's insertion order for O(1) LRU operations.
 */
const layoutCache = new Map<string, LayoutPositionResult>();

function addToCache(key: string, result: LayoutPositionResult): void {
  // Evict oldest entry if at capacity
  if (layoutCache.size >= LAYOUT_CACHE.MAX_SIZE) {
    const firstKey = layoutCache.keys().next().value;
    if (firstKey) layoutCache.delete(firstKey);
  }
  layoutCache.set(key, result);
}

function getFromCache(key: string): LayoutPositionResult | undefined {
  const result = layoutCache.get(key);
  if (result) {
    // Move to end (most recently used) by re-inserting
    layoutCache.delete(key);
    layoutCache.set(key, result);
  }
  return result;
}

/**
 * Clear the layout cache.
 * Call when node data changes significantly (e.g., workflow change).
 */
export function clearLayoutCache(): void {
  layoutCache.clear();
}

// ============================================================================
// ELK Layout Configuration
// ============================================================================

/**
 * Get ELK layout options for the given direction.
 */
function getElkLayoutOptions(direction: LayoutDirection): Record<string, string> {
  return {
    "elk.algorithm": "layered",
    "elk.direction": direction === "TB" ? "DOWN" : "RIGHT",
    "elk.spacing.nodeNode": String(direction === "TB" ? LAYOUT_SPACING.NODES_TB : LAYOUT_SPACING.NODES_LR),
    "elk.layered.spacing.nodeNodeBetweenLayers": String(
      direction === "TB" ? LAYOUT_SPACING.RANKS_TB : LAYOUT_SPACING.RANKS_LR,
    ),
    "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
    "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.padding": `[top=${LAYOUT_SPACING.MARGIN},left=${LAYOUT_SPACING.MARGIN},bottom=${LAYOUT_SPACING.MARGIN},right=${LAYOUT_SPACING.MARGIN}]`,
    "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    "elk.alignment": "CENTER",
  };
}

// ============================================================================
// Layout Calculation
// ============================================================================

/**
 * Calculate positions for DAG nodes using ELK.
 * Results are cached for repeated calls with identical parameters.
 *
 * Performance: Uses for...of loops for better JIT optimization than forEach.
 *
 * @param nodes - Input nodes with dimensions
 * @param direction - Layout direction
 * @returns Promise resolving to position map
 */
export async function calculatePositions(
  nodes: DAGInputNode[],
  direction: LayoutDirection,
): Promise<LayoutPositionResult> {
  const cacheKey = getLayoutCacheKey(nodes, direction);
  const cached = getFromCache(cacheKey);
  if (cached) {
    return cached;
  }

  // Build dimension map and ELK children in single pass
  const dimensionsMap = new Map<string, NodeDimensions>();
  const elkChildren: { id: string; width: number; height: number }[] = [];
  const elkEdges: { id: string; sources: string[]; targets: string[] }[] = [];

  for (const node of nodes) {
    dimensionsMap.set(node.id, { width: node.width, height: node.height });
    elkChildren.push({ id: node.id, width: node.width, height: node.height });

    // Build edges for this node
    for (const downstream of node.downstreamIds) {
      elkEdges.push({
        id: `${node.id}-${downstream}`,
        sources: [node.id],
        targets: [downstream],
      });
    }
  }

  // Build ELK graph
  const elkGraph: ElkGraph = {
    id: "root",
    layoutOptions: getElkLayoutOptions(direction),
    children: elkChildren,
    edges: elkEdges,
  };

  // Run ELK layout (off main thread via web worker)
  const layoutResult = await elkWorker.layout(elkGraph);

  // Build position map from layout results
  const positions = new Map<string, LayoutPosition>();
  for (const elkNode of layoutResult.children) {
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
  }

  const result = { positions, dimensions: dimensionsMap };
  addToCache(cacheKey, result);

  return result;
}

// ============================================================================
// Edge Building
// ============================================================================

/**
 * Edge style provider function type.
 * Given a source and target node ID, returns the edge style.
 */
export type EdgeStyleProvider = (sourceId: string, targetId: string) => EdgeStyle;

/**
 * Build ReactFlow edges from input nodes.
 *
 * Performance: Uses for...of loops instead of flatMap for better JIT optimization.
 *
 * @param nodes - Input nodes with downstream connections
 * @param getStyle - Optional function to get edge style per edge
 * @returns ReactFlow edges
 */
export function buildEdges(nodes: DAGInputNode[], getStyle?: EdgeStyleProvider): Edge[] {
  const edges: Edge[] = [];

  for (const node of nodes) {
    for (const downstreamId of node.downstreamIds) {
      const style = getStyle?.(node.id, downstreamId);

      edges.push({
        id: `${node.id}-${downstreamId}`,
        source: node.id,
        target: downstreamId,
        sourceHandle: "source",
        targetHandle: "target",
        type: "smoothstep",
        animated: style?.animated ?? false,
        style: {
          strokeWidth: EDGE_STYLE.STROKE_WIDTH,
          strokeDasharray: style?.dashed ? EDGE_STYLE.DASH_ARRAY : undefined,
          stroke: style?.color,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: style?.color ?? "#71717a",
          width: EDGE_STYLE.ARROW_WIDTH,
          height: EDGE_STYLE.ARROW_HEIGHT,
        },
      });
    }
  }

  return edges;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Find root nodes (nodes with no incoming edges).
 * Uses single-pass collection building for performance.
 */
export function findRootNodes(nodes: DAGInputNode[]): string[] {
  // Collect all nodes that are targets of edges
  const allTargets = new Set<string>();
  for (const node of nodes) {
    for (const id of node.downstreamIds) {
      allTargets.add(id);
    }
  }

  // Nodes not in allTargets are roots (no incoming edges)
  const roots: string[] = [];
  for (const node of nodes) {
    if (!allTargets.has(node.id)) {
      roots.push(node.id);
    }
  }
  return roots;
}

/**
 * Compute which nodes should be initially expanded based on thresholds.
 *
 * Performance: Uses for...of loops instead of filter/map chains for better JIT optimization.
 *
 * @param nodes - Input nodes
 * @param isExpandable - Function to determine if a node is expandable
 * @param shouldExpand - Function to determine if an expandable node should be initially expanded
 * @param groupThreshold - Collapse all if this many groups
 * @returns Set of node IDs that should be expanded
 */
export function computeInitialExpandedNodes(
  nodes: DAGInputNode[],
  isExpandable: (node: DAGInputNode) => boolean,
  shouldExpand: (node: DAGInputNode) => boolean,
  groupThreshold = 10,
): Set<string> {
  // First pass: collect expandable nodes
  const expandableNodes: DAGInputNode[] = [];
  for (const node of nodes) {
    if (isExpandable(node)) {
      expandableNodes.push(node);
    }
  }

  if (expandableNodes.length === 0) {
    return new Set();
  }

  if (expandableNodes.length === 1) {
    return new Set([expandableNodes[0].id]);
  }

  if (nodes.length >= groupThreshold) {
    return new Set();
  }

  // Second pass: collect nodes that should be expanded
  const result = new Set<string>();
  for (const node of expandableNodes) {
    if (shouldExpand(node)) {
      result.add(node.id);
    }
  }
  return result;
}
