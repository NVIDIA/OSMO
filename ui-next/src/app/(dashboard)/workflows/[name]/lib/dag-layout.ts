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
 * Workflow DAG ELK Layout
 *
 * Workflow-specific layout calculations using ELK.js.
 * Uses the generic ELK worker from @/components/dag and adds
 * workflow-specific node building and edge styling.
 */

import type { Node, Edge } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import {
  elkWorker,
  LAYOUT_CACHE,
  NODE_DEFAULTS,
  NODE_EXPANDED,
  LAYOUT_SPACING,
  EDGE_STYLE,
  type LayoutDirection,
  type NodeDimensions,
  type ElkGraph,
} from "@/components/dag";
import type { GroupWithLayout } from "./workflow-types";
import { getStatusCategory, STATUS_STYLES } from "./status";

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

/** Result of the workflow layout calculation */
export interface LayoutResult {
  nodes: Node<GroupNodeData>[];
  edges: Edge[];
}

// ============================================================================
// Layout Dimension Constants
// ============================================================================

/** Task row height in pixels (used for node sizing and virtualizer) */
export const TASK_ROW_HEIGHT = 28;

/** Header height for expanded nodes in pixels */
export const NODE_HEADER_HEIGHT = 68;

/** Node border width for dimension calculations (1.5px border × 2 sides) */
export const NODE_BORDER_WIDTH = 3;

// ============================================================================
// Layout Cache
// ============================================================================

/**
 * Cache key for layout results.
 * Uses array building for better performance than string concatenation.
 */
function getLayoutCacheKey(groups: GroupWithLayout[], expandedGroups: Set<string>, direction: LayoutDirection): string {
  // Pre-allocate array for known size
  const parts: string[] = [direction];

  // Group names + task counts (task count affects node dimensions)
  for (const g of groups) {
    parts.push(g.name, String(g.tasks?.length || 0));
  }

  // Expanded groups (sorted for stable key)
  const expandedSorted = [...expandedGroups].sort();
  for (const e of expandedSorted) {
    parts.push(e);
  }

  return parts.join("|");
}

/**
 * LRU-style cache for layout results.
 * Caches LayoutPositionResult to avoid re-running ELK for identical inputs.
 */
const layoutCache = new Map<string, LayoutPositionResult>();
const CACHE_MAX_SIZE = LAYOUT_CACHE.MAX_SIZE;

/**
 * Add to cache with LRU eviction.
 */
function addToCache(key: string, result: LayoutPositionResult): void {
  // If at capacity, remove oldest entry
  if (layoutCache.size >= CACHE_MAX_SIZE) {
    const firstKey = layoutCache.keys().next().value;
    if (firstKey) layoutCache.delete(firstKey);
  }
  layoutCache.set(key, result);
}

/**
 * Get from cache with LRU update (move to end).
 */
function getFromCache(key: string): LayoutPositionResult | undefined {
  const result = layoutCache.get(key);
  if (result) {
    // Move to end for LRU
    layoutCache.delete(key);
    layoutCache.set(key, result);
  }
  return result;
}

/**
 * Clear the layout cache.
 * Useful when workflow data changes fundamentally.
 */
export function clearLayoutCache(): void {
  layoutCache.clear();
}

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
export function getNodeDimensions(group: GroupWithLayout, isExpanded: boolean): NodeDimensions {
  const tasks = group.tasks || [];
  const hasManyTasks = tasks.length > 1;

  if (isExpanded && hasManyTasks) {
    // Task list height: tasks * row height (borders are inside elements with box-sizing: border-box)
    const taskListHeight = tasks.length * TASK_ROW_HEIGHT;
    // Collapse lip height: h-5 (20px) - border-t is inside with box-sizing: border-box
    const collapseLipHeight = 20;
    // Total height capped at max, plus node border (border-[1.5px] = 1.5px * 2 sides)
    const totalHeight = NODE_HEADER_HEIGHT + taskListHeight + collapseLipHeight + NODE_BORDER_WIDTH;
    return {
      width: NODE_EXPANDED.width,
      height: Math.min(totalHeight, NODE_EXPANDED.maxHeight),
    };
  }

  // Collapsed multi-task groups are taller to accommodate expand lip
  if (hasManyTasks) {
    // Expand lip height: h-5 (20px) - reduced header bottom padding (6px saved)
    const expandLipHeight = 14;
    return {
      width: NODE_DEFAULTS.width,
      height: NODE_DEFAULTS.height + expandLipHeight,
    };
  }

  return {
    width: NODE_DEFAULTS.width,
    height: NODE_DEFAULTS.height,
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
    "elk.spacing.nodeNode": String(direction === "TB" ? LAYOUT_SPACING.NODES_TB : LAYOUT_SPACING.NODES_LR),
    // Spacing between layers/ranks
    "elk.layered.spacing.nodeNodeBetweenLayers": String(
      direction === "TB" ? LAYOUT_SPACING.RANKS_TB : LAYOUT_SPACING.RANKS_LR,
    ),
    // Node placement strategy - Brandes-Koepf produces more balanced layouts
    // with better parent-child centering than NETWORK_SIMPLEX
    "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
    // Favor balanced placement (centers nodes between their connections)
    "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
    // Edge routing - orthogonal for clean 90-degree edges
    "elk.edgeRouting": "ORTHOGONAL",
    // Margins
    "elk.padding": `[top=${LAYOUT_SPACING.MARGIN},left=${LAYOUT_SPACING.MARGIN},bottom=${LAYOUT_SPACING.MARGIN},right=${LAYOUT_SPACING.MARGIN}]`,
    // Align nodes considering their sizes
    "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    // Center nodes within their layer
    "elk.alignment": "CENTER",
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
 * Results are cached for repeated calls with identical parameters.
 *
 * Performance: Uses for...of loops and single-pass building for better JIT optimization.
 *
 * @param groups - The workflow groups
 * @param expandedGroups - Set of expanded group names
 * @param direction - Layout direction
 * @returns Promise resolving to position map
 */
export async function calculatePositions(
  groups: GroupWithLayout[],
  expandedGroups: Set<string>,
  direction: LayoutDirection,
): Promise<LayoutPositionResult> {
  // Check cache first
  const cacheKey = getLayoutCacheKey(groups, expandedGroups, direction);
  const cached = getFromCache(cacheKey);
  if (cached) {
    return cached;
  }

  // Build dimension map, ELK children, and edges in single pass - O(n)
  const dimensionsMap = new Map<string, NodeDimensions>();
  const elkChildren: { id: string; width: number; height: number }[] = [];
  const elkEdges: { id: string; sources: string[]; targets: string[] }[] = [];

  for (const group of groups) {
    const isExpanded = expandedGroups.has(group.name);
    const dims = getNodeDimensions(group, isExpanded);
    dimensionsMap.set(group.name, dims);
    elkChildren.push({ id: group.name, width: dims.width, height: dims.height });

    // Build edges for this group
    const downstreams = group.downstream_groups;
    if (downstreams) {
      for (const downstream of downstreams) {
        elkEdges.push({
          id: `${group.name}-${downstream}`,
          sources: [group.name],
          targets: [downstream],
        });
      }
    }
  }

  // Build ELK graph
  const elkGraph: ElkGraph = {
    id: "root",
    layoutOptions: getElkLayoutOptions(direction),
    children: elkChildren,
    edges: elkEdges,
  };

  // Run ELK layout (offloaded to web worker for performance)
  const layoutResult = await elkWorker.layout(elkGraph);

  // Build position map - O(n) lookup later
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

  // Store in cache
  addToCache(cacheKey, result);

  return result;
}

/**
 * Build ReactFlow nodes from layout positions and group data.
 *
 * Note: Callbacks are accessed via DAGContext, not passed in node data.
 * This prevents layout re-calculation when callbacks change reference.
 *
 * @param groups - The workflow groups
 * @param positions - Position map from calculatePositions
 * @param expandedGroups - Set of expanded group names
 * @param direction - Layout direction
 * @returns ReactFlow nodes
 */
export function buildNodes(
  groups: GroupWithLayout[],
  positions: Map<string, LayoutPosition>,
  expandedGroups: Set<string>,
  direction: LayoutDirection,
): Node<GroupNodeData>[] {
  // Pre-compute which groups have incoming edges (are targets of other groups)
  const hasIncomingEdgesSet = new Set<string>();
  for (const group of groups) {
    const downstreams = group.downstream_groups || [];
    for (const downstream of downstreams) {
      hasIncomingEdgesSet.add(downstream);
    }
  }

  const nodes: Node<GroupNodeData>[] = [];

  for (const group of groups) {
    const pos = positions.get(group.name);
    if (!pos) {
      console.warn(`No position found for group: ${group.name}`);
      continue;
    }

    const hasOutgoingEdges = (group.downstream_groups?.length ?? 0) > 0;
    const hasIncomingEdges = hasIncomingEdgesSet.has(group.name);

    nodes.push({
      id: group.name,
      type: "collapsibleGroup" as const,
      position: { x: pos.x, y: pos.y },
      // Dimensions for MiniMap and bounds calculations
      initialWidth: pos.width,
      initialHeight: pos.height,
      data: {
        group,
        isExpanded: expandedGroups.has(group.name),
        layoutDirection: direction,
        nodeWidth: pos.width,
        nodeHeight: pos.height,
        hasIncomingEdges,
        hasOutgoingEdges,
      },
    });
  }

  return nodes;
}

/**
 * Build ReactFlow edges from groups.
 *
 * Uses CSS variables and data attributes for styling instead of inline styles.
 * This enables GPU-accelerated rendering and reduces React reconciliation work.
 *
 * Performance: Uses for...of loops instead of flatMap to avoid intermediate arrays.
 *
 * @param groups - The workflow groups
 * @returns ReactFlow edges
 */
export function buildEdges(groups: GroupWithLayout[]): Edge[] {
  const edges: Edge[] = [];

  for (const group of groups) {
    const downstreams = group.downstream_groups;
    if (!downstreams || downstreams.length === 0) continue;

    const category = getStatusCategory(group.status);
    const isTerminal = category === "completed" || category === "failed";
    const isRunning = category === "running";
    const statusColor = STATUS_STYLES[category].color;
    const dashArray = isTerminal || isRunning ? undefined : EDGE_STYLE.DASH_ARRAY;

    for (const downstreamName of downstreams) {
      edges.push({
        id: `${group.name}-${downstreamName}`,
        source: group.name,
        target: downstreamName,
        sourceHandle: "source",
        targetHandle: "target",
        type: "smoothstep",
        animated: isRunning,
        // Use className for CSS-based styling instead of inline styles
        className: `dag-edge dag-edge--${category}`,
        // Minimal inline style - only what can't be done in CSS
        style: {
          strokeWidth: EDGE_STYLE.STROKE_WIDTH,
          strokeDasharray: dashArray,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          // Marker color still needs inline - ReactFlow limitation
          color: statusColor,
          width: EDGE_STYLE.ARROW_WIDTH,
          height: EDGE_STYLE.ARROW_HEIGHT,
        },
        // Pass status data for potential future use
        data: { status: category },
      });
    }
  }

  return edges;
}

/**
 * Calculate layout for DAG nodes and edges using ELK.
 * Convenience function that combines position calculation and node building.
 *
 * @param groups - The workflow groups
 * @param expandedGroups - Set of expanded group names
 * @param direction - Layout direction
 * @returns Promise resolving to layouted nodes and edges
 */
export async function calculateLayout(
  groups: GroupWithLayout[],
  expandedGroups: Set<string>,
  direction: LayoutDirection,
): Promise<LayoutResult> {
  const { positions } = await calculatePositions(groups, expandedGroups, direction);
  const nodes = buildNodes(groups, positions, expandedGroups, direction);
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
  groupThreshold = 10,
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
  return new Set(expandableGroups.filter((g) => (g.tasks || []).length < taskThreshold).map((g) => g.name));
}
