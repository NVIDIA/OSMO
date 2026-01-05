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

import type { Node, Edge } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import type { GroupWithLayout } from "../../workflow-types";
import type { LayoutDirection, GroupNodeData, NodeDimensions, LayoutResult, ElkGraph } from "../types/dag-layout";
import { getStatusCategory } from "../utils/status";
import {
  NODE_COLLAPSED_WIDTH,
  NODE_COLLAPSED_HEIGHT,
  NODE_EXPANDED_WIDTH,
  NODE_MAX_EXPANDED_HEIGHT,
  NODE_HEADER_HEIGHT,
  NODE_BORDER_WIDTH,
  TASK_ROW_HEIGHT,
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
import { elkWorker } from "./elk-worker-client";

// ============================================================================
// Layout Cache
// ============================================================================

/**
 * Cache key for layout results.
 * Uses a stable string representation of the input parameters.
 */
function getLayoutCacheKey(groups: GroupWithLayout[], expandedGroups: Set<string>, direction: LayoutDirection): string {
  // Group names + task counts (task count affects node dimensions)
  const groupKey = groups.map((g) => `${g.name}:${g.tasks?.length || 0}`).join("|");
  // Expanded groups (sorted for stable key)
  const expandedKey = [...expandedGroups].sort().join(",");
  return `${direction}/${expandedKey}/${groupKey}`;
}

/**
 * LRU-style cache for layout results.
 * Caches LayoutPositionResult to avoid re-running ELK for identical inputs.
 */
const layoutCache = new Map<string, LayoutPositionResult>();
const CACHE_MAX_SIZE = 20; // Keep last 20 layouts

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
      width: NODE_EXPANDED_WIDTH,
      height: Math.min(totalHeight, NODE_MAX_EXPANDED_HEIGHT),
    };
  }

  // Collapsed multi-task groups are taller to accommodate expand lip
  if (hasManyTasks) {
    // Expand lip height: h-5 (20px) - reduced header bottom padding (6px saved)
    const expandLipHeight = 14;
    return {
      width: NODE_COLLAPSED_WIDTH,
      height: NODE_COLLAPSED_HEIGHT + expandLipHeight,
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
    "elk.layered.spacing.nodeNodeBetweenLayers": String(direction === "TB" ? SPACING_RANKS_TB : SPACING_RANKS_LR),
    // Node placement strategy - Brandes-Koepf produces more balanced layouts
    // with better parent-child centering than NETWORK_SIMPLEX
    "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
    // Favor balanced placement (centers nodes between their connections)
    "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
    // Edge routing - orthogonal for clean 90-degree edges
    "elk.edgeRouting": "ORTHOGONAL",
    // Margins
    "elk.padding": `[top=${LAYOUT_MARGIN},left=${LAYOUT_MARGIN},bottom=${LAYOUT_MARGIN},right=${LAYOUT_MARGIN}]`,
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

  // Run ELK layout (offloaded to web worker for performance)
  const layoutResult = await elkWorker.layout(elkGraph);

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
 * @param groups - The workflow groups
 * @returns ReactFlow edges
 */
export function buildEdges(groups: GroupWithLayout[]): Edge[] {
  return groups.flatMap((group) => {
    const category = getStatusCategory(group.status);
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
      // Use className for CSS-based styling instead of inline styles
      className: `dag-edge dag-edge--${category}`,
      // Minimal inline style - only what can't be done in CSS
      style: {
        strokeWidth: EDGE_STROKE_WIDTH,
        strokeDasharray: isTerminal || category === "running" ? undefined : EDGE_DASH_ARRAY,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        // Marker color still needs inline - ReactFlow limitation
        color: STATUS_STYLES[category].color,
        width: ARROW_WIDTH,
        height: ARROW_HEIGHT,
      },
      // Pass status data for potential future use
      data: { status: category },
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
