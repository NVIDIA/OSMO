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

import type { Node, Edge } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import { LAYOUT_CACHE, NODE_DEFAULTS, NODE_EXPANDED, LAYOUT_SPACING, EDGE_STYLE } from "@/components/dag/constants";
import { elkWorker } from "@/components/dag/layout/elk-worker-client";
import type { LayoutDirection, NodeDimensions, ElkGraph } from "@/components/dag/types";
import type { GroupWithLayout } from "@/app/(dashboard)/workflows/[name]/lib/workflow-types";
import { getStatusCategory, STATUS_STYLES } from "@/app/(dashboard)/workflows/[name]/lib/status";

// Callbacks accessed via DAGContext to prevent re-renders
export interface GroupNodeData extends Record<string, unknown> {
  group: GroupWithLayout;
  isExpanded: boolean;
  layoutDirection: LayoutDirection;
  nodeWidth: number;
  nodeHeight: number;
  hasIncomingEdges: boolean;
  hasOutgoingEdges: boolean;
}

export interface LayoutResult {
  nodes: Node<GroupNodeData>[];
  edges: Edge[];
}

export const TASK_ROW_HEIGHT = 28;
export const NODE_HEADER_HEIGHT = 68;
export const NODE_BORDER_WIDTH = 3;

// LRU cache for layout results
const layoutCache = new Map<string, LayoutPositionResult>();
const CACHE_MAX_SIZE = LAYOUT_CACHE.MAX_SIZE;

function getLayoutCacheKey(groups: GroupWithLayout[], expandedGroups: Set<string>, direction: LayoutDirection): string {
  const parts: string[] = [direction];

  for (const g of groups) {
    parts.push(g.name, String(g.tasks?.length || 0));
  }

  const expandedSorted = [...expandedGroups].sort();
  for (const e of expandedSorted) {
    parts.push(e);
  }

  return parts.join("|");
}

function addToCache(key: string, result: LayoutPositionResult): void {
  if (layoutCache.size >= CACHE_MAX_SIZE) {
    const firstKey = layoutCache.keys().next().value;
    if (firstKey) layoutCache.delete(firstKey);
  }
  layoutCache.set(key, result);
}

function getFromCache(key: string): LayoutPositionResult | undefined {
  const result = layoutCache.get(key);
  if (result) {
    layoutCache.delete(key);
    layoutCache.set(key, result);
  }
  return result;
}

export function clearLayoutCache(): void {
  layoutCache.clear();
}

export function getNodeDimensions(group: GroupWithLayout, isExpanded: boolean): NodeDimensions {
  const tasks = group.tasks || [];
  const hasManyTasks = tasks.length > 1;

  if (isExpanded && hasManyTasks) {
    const taskListHeight = tasks.length * TASK_ROW_HEIGHT;
    const collapseLipHeight = 20;
    const totalHeight = NODE_HEADER_HEIGHT + taskListHeight + collapseLipHeight + NODE_BORDER_WIDTH;
    return {
      width: NODE_EXPANDED.width,
      height: Math.min(totalHeight, NODE_EXPANDED.maxHeight),
    };
  }

  if (hasManyTasks) {
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

export interface LayoutPosition {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutPositionResult {
  positions: Map<string, LayoutPosition>;
  dimensions: Map<string, NodeDimensions>;
}

export async function calculatePositions(
  groups: GroupWithLayout[],
  expandedGroups: Set<string>,
  direction: LayoutDirection,
): Promise<LayoutPositionResult> {
  const cacheKey = getLayoutCacheKey(groups, expandedGroups, direction);
  const cached = getFromCache(cacheKey);
  if (cached) {
    return cached;
  }

  const dimensionsMap = new Map<string, NodeDimensions>();
  const elkChildren: { id: string; width: number; height: number }[] = [];
  const elkEdges: { id: string; sources: string[]; targets: string[] }[] = [];

  for (const group of groups) {
    const isExpanded = expandedGroups.has(group.name);
    const dims = getNodeDimensions(group, isExpanded);
    dimensionsMap.set(group.name, dims);
    elkChildren.push({ id: group.name, width: dims.width, height: dims.height });

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

  const elkGraph: ElkGraph = {
    id: "root",
    layoutOptions: getElkLayoutOptions(direction),
    children: elkChildren,
    edges: elkEdges,
  };

  const layoutResult = await elkWorker.layout(elkGraph);

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

export function buildNodes(
  groups: GroupWithLayout[],
  positions: Map<string, LayoutPosition>,
  expandedGroups: Set<string>,
  direction: LayoutDirection,
): Node<GroupNodeData>[] {
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

// Pre-computed edge styles/markers/data - created once, reused for every edge
import type { StatusCategory } from "@/app/(dashboard)/workflows/[name]/lib/status-utils";

const EDGE_STYLE_SOLID = {
  strokeWidth: EDGE_STYLE.STROKE_WIDTH,
} as const;

const EDGE_STYLE_DASHED = {
  strokeWidth: EDGE_STYLE.STROKE_WIDTH,
  strokeDasharray: EDGE_STYLE.DASH_ARRAY,
} as const;

const EDGE_MARKERS: Record<
  StatusCategory,
  { type: typeof MarkerType.ArrowClosed; color: string; width: number; height: number }
> = {
  waiting: {
    type: MarkerType.ArrowClosed,
    color: STATUS_STYLES.waiting.light.color,
    width: EDGE_STYLE.ARROW_WIDTH,
    height: EDGE_STYLE.ARROW_HEIGHT,
  },
  pending: {
    type: MarkerType.ArrowClosed,
    color: STATUS_STYLES.pending.light.color,
    width: EDGE_STYLE.ARROW_WIDTH,
    height: EDGE_STYLE.ARROW_HEIGHT,
  },
  running: {
    type: MarkerType.ArrowClosed,
    color: STATUS_STYLES.running.light.color,
    width: EDGE_STYLE.ARROW_WIDTH,
    height: EDGE_STYLE.ARROW_HEIGHT,
  },
  completed: {
    type: MarkerType.ArrowClosed,
    color: STATUS_STYLES.completed.light.color,
    width: EDGE_STYLE.ARROW_WIDTH,
    height: EDGE_STYLE.ARROW_HEIGHT,
  },
  failed: {
    type: MarkerType.ArrowClosed,
    color: STATUS_STYLES.failed.light.color,
    width: EDGE_STYLE.ARROW_WIDTH,
    height: EDGE_STYLE.ARROW_HEIGHT,
  },
};

const EDGE_DATA: Record<StatusCategory, { status: StatusCategory }> = {
  waiting: { status: "waiting" },
  pending: { status: "pending" },
  running: { status: "running" },
  completed: { status: "completed" },
  failed: { status: "failed" },
};

export function buildEdges(groups: GroupWithLayout[]): Edge[] {
  const edges: Edge[] = [];

  for (const group of groups) {
    const downstreams = group.downstream_groups;
    if (!downstreams || downstreams.length === 0) continue;

    const category = getStatusCategory(group.status);
    const isTerminal = category === "completed" || category === "failed";
    const isRunning = category === "running" || category === "pending";
    const edgeStyle = isTerminal || isRunning ? EDGE_STYLE_SOLID : EDGE_STYLE_DASHED;
    const marker = EDGE_MARKERS[category];
    const data = EDGE_DATA[category];
    const className = `dag-edge dag-edge--${category}`;

    for (const downstreamName of downstreams) {
      edges.push({
        id: `${group.name}-${downstreamName}`,
        source: group.name,
        target: downstreamName,
        sourceHandle: "source",
        targetHandle: "target",
        type: "smoothstep",
        animated: isRunning,
        className,
        style: edgeStyle,
        markerEnd: marker,
        data,
      });
    }
  }

  return edges;
}

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

export function computeInitialExpandedGroups(
  groups: GroupWithLayout[],
  taskThreshold = 20,
  groupThreshold = 10,
): Set<string> {
  const expandableGroups = groups.filter((g) => (g.tasks || []).length > 1);

  if (expandableGroups.length === 0) {
    return new Set();
  }

  if (expandableGroups.length === 1) {
    return new Set(expandableGroups.map((g) => g.name));
  }

  if (groups.length >= groupThreshold) {
    return new Set();
  }

  return new Set(expandableGroups.filter((g) => (g.tasks || []).length < taskThreshold).map((g) => g.name));
}
