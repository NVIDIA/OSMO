// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  Node,
  Edge,
  Handle,
  Position,
  MarkerType,
  BackgroundVariant,
  PanOnScrollMode,
  type Viewport,
  type MiniMapNodeProps,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChevronLeft,
  RefreshCw,
  XCircle,
  CheckCircle,
  Clock,
  Loader2,
  FileText,
  Terminal,
  ArrowDown,
  ArrowRight,
  ChevronDown,
  ChevronRight as ChevronRightIcon,
  Maximize2,
  Minimize2,
} from "lucide-react";

import "@xyflow/react/dist/style.css";
import "./reactflow-dark.css";

// Backend-aligned types and utilities
import {
  type GroupWithLayout,
  type TaskQueryResponse,
  TaskGroupStatus,
  getStatusCategory,
  computeTopologicalLevelsFromGraph,
  calculateDuration,
  formatDuration as formatDurationUtil,
} from "../workflow-types";

import {
  EXAMPLE_WORKFLOWS,
  type WorkflowPattern,
} from "../mock-workflow-v2";

// ============================================================================
// Status Styling
// ============================================================================

// Status colors aligned with legacy UI:
// - Pending/Waiting: Muted gray (no activity yet)
// - Running: Blue
// - Completed: Green
// - Failed: Red
const statusStyles = {
  waiting: {
    bg: "bg-zinc-800/60",
    border: "border-zinc-600",
    text: "text-zinc-400",
    dot: "bg-zinc-500",
  },
  running: {
    bg: "bg-blue-950/60",
    border: "border-blue-500",
    text: "text-blue-400",
    dot: "bg-blue-500",
  },
  completed: {
    bg: "bg-emerald-950/60",
    border: "border-emerald-600",
    text: "text-emerald-400",
    dot: "bg-emerald-500",
  },
  failed: {
    bg: "bg-red-950/60",
    border: "border-red-500",
    text: "text-red-400",
    dot: "bg-red-500",
  },
};

function getStatusIcon(status: string, size = "h-4 w-4") {
  const category = getStatusCategory(status);
  switch (category) {
    case "waiting":
      return <Clock className={cn(size, "text-zinc-400")} />;
    case "running":
      return <Loader2 className={cn(size, "text-blue-400 animate-spin")} />;
    case "completed":
      return <CheckCircle className={cn(size, "text-emerald-400")} />;
    case "failed":
      return <XCircle className={cn(size, "text-red-400")} />;
  }
}

// Duration formatting imported from workflow-types.ts as formatDurationUtil

// ============================================================================
// Custom Node Components
// ============================================================================

type LayoutDirection = "TB" | "LR";

interface GroupNodeData extends Record<string, unknown> {
  group: GroupWithLayout;
  isSelected: boolean;
  isExpanded: boolean;
  layoutDirection: LayoutDirection;
  onSelect: (group: GroupWithLayout) => void;
  onToggleExpand: (groupId: string) => void;
  // Dimensions for MiniMap (since we can't set width/height on node directly)
  nodeWidth: number;
  nodeHeight: number;
}

function CollapsibleGroupNode({ data }: { data: GroupNodeData }) {
  const { group, isSelected, isExpanded, layoutDirection, onSelect, onToggleExpand } = data;
  const category = getStatusCategory(group.status);
  const style = statusStyles[category];

  const tasks = group.tasks || [];
  const totalCount = tasks.length;
  const hasManyTasks = totalCount > 1;

  // Get representative info for collapsed view
  const runningTask = tasks.find(t => getStatusCategory(t.status) === "running");
  const completedTask = tasks.find(t => t.status === TaskGroupStatus.COMPLETED);
  const representativeTask = runningTask || completedTask || tasks[0];

  // Calculate total duration from start/end times
  const totalDuration = tasks.reduce((sum, t) => {
    const duration = calculateDuration(t.start_time, t.end_time);
    return sum + (duration || 0);
  }, 0);

  const handleNodeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasManyTasks) {
      // Multi-task nodes: click to expand/collapse
      onToggleExpand(group.name);
    } else {
      // Single-task nodes: click to select
      onSelect(group);
    }
  };

  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleExpand(group.name);
  };

  // Handle positions based on layout direction
  const isVertical = layoutDirection === "TB";
  const targetPosition = isVertical ? Position.Top : Position.Left;
  const sourcePosition = isVertical ? Position.Bottom : Position.Right;

  // Fixed dimensions for consistent alignment
  // CRITICAL: Explicit heights are required for accurate positioning
  const COLLAPSED_WIDTH = 180;
  const COLLAPSED_HEIGHT = 72;
  const EXPANDED_WIDTH = 240;

  // Calculate expanded height to match getActualDimensions() in layout
  const getExpandedHeight = () => {
    const taskListHeight = Math.min(totalCount, 50) * 28 + 16;
    return Math.min(72 + taskListHeight, 320);
  };

  const nodeWidth = isExpanded && hasManyTasks ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
  // CRITICAL: Must use explicit height (not undefined) so rendered size matches layout calculation
  const nodeHeight = isExpanded && hasManyTasks ? getExpandedHeight() : COLLAPSED_HEIGHT;


  // Secondary info line content
  const getSecondaryInfo = () => {
    if (category === "waiting") {
      return "Waiting...";
    }
    if (category === "running") {
      const nodeName = representativeTask?.node_name;
      return nodeName ? `Running on ${nodeName}` : "Running...";
    }
    if (category === "failed") {
      return "Failed";
    }
    // Completed
    const nodeName = representativeTask?.node_name;
    const duration = totalDuration > 0 ? formatDurationUtil(totalDuration) : null;
    if (nodeName && duration) {
      return `${nodeName} · ${duration}`;
    }
    return nodeName || duration || "Completed";
  };

  return (
    <div
      className={cn(
        "rounded-lg border-2 backdrop-blur-sm transition-all duration-200",
        style.bg,
        style.border,
        isSelected && "ring-2 ring-cyan-500 ring-offset-2 ring-offset-zinc-950",
        category === "running" && "shadow-[0_0_20px_rgba(59,130,246,0.3)]",
        category === "failed" && "shadow-[0_0_20px_rgba(239,68,68,0.3)]"
      )}
      style={{ width: nodeWidth, height: nodeHeight }}
    >
      {/* Handles at center of node - dagre positions nodes to keep edges aligned */}
      {/* LR mode: handles at 50% height. TB mode: handles at 50% width */}
      <Handle
        type="target"
        position={targetPosition}
        id="target"
        className="!bg-zinc-600 !border-zinc-500 !w-3 !h-3"
        style={isVertical ? { left: "50%" } : { top: "50%" }}
      />
      <Handle
        type="source"
        position={sourcePosition}
        id="source"
        className="!bg-zinc-600 !border-zinc-500 !w-3 !h-3"
        style={isVertical ? { left: "50%" } : { top: "50%" }}
      />

      {/* Header - clickable to expand/collapse (multi-task) or select (single-task) */}
      <div
        className={cn(
          "px-3 py-2.5 cursor-pointer select-none",
          !isExpanded && "flex flex-col justify-center h-full"
        )}
        onClick={handleNodeClick}
      >
        {/* Row 1: Chevron + Icon + Name */}
        <div className="flex items-center gap-2">
          {hasManyTasks && (
            <button
              onClick={handleExpandClick}
              className="p-0.5 rounded hover:bg-zinc-700/50 transition-colors"
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-zinc-400" />
              ) : (
                <ChevronRightIcon className="h-4 w-4 text-zinc-400" />
              )}
            </button>
          )}
          {getStatusIcon(group.status, "h-4 w-4")}
          <span className="font-medium text-sm text-zinc-100 truncate flex-1">
            {group.name}
          </span>
        </div>

        {/* Row 2: Secondary info (node + duration or status) */}
        {!isExpanded && (
          <div className={cn("text-xs mt-1 truncate", style.text, hasManyTasks && "ml-7")}>
            {getSecondaryInfo()}
          </div>
        )}
      </div>

      {/* Expanded task list */}
      {isExpanded && hasManyTasks && (
        <div className="border-t border-zinc-700/50 px-2 py-2 max-h-[300px] overflow-y-auto">
          <div className="space-y-1">
            {tasks.slice(0, 50).map((task) => {
              const taskCategory = getStatusCategory(task.status);
              const taskStyle = statusStyles[taskCategory];
              const taskDuration = calculateDuration(task.start_time, task.end_time);
              return (
                <div
                  key={`${task.name}-${task.retry_id}`}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5 rounded text-xs",
                    "hover:bg-zinc-700/30 transition-colors"
                  )}
                >
                  {getStatusIcon(task.status, "h-3 w-3")}
                  <span className="flex-1 truncate text-zinc-300">
                    {task.name}
                  </span>
                  <span className={cn("tabular-nums", taskStyle.text)}>
                    {formatDurationUtil(taskDuration)}
                  </span>
                </div>
              );
            })}
            {tasks.length > 50 && (
              <div className="text-xs text-zinc-500 text-center py-1">
                +{tasks.length - 50} more tasks...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const nodeTypes = {
  collapsibleGroup: CollapsibleGroupNode,
};

// Custom MiniMap node that renders with correct dimensions
function MiniMapNode({ x, y, width, height, color, strokeColor, strokeWidth }: MiniMapNodeProps) {
  // Use data dimensions if available, fallback to defaults
  const nodeWidth = width || 180;
  const nodeHeight = height || 72;

  return (
    <rect
      x={x}
      y={y}
      width={nodeWidth}
      height={nodeHeight}
      fill={color || "#52525b"}
      stroke={strokeColor || "#3f3f46"}
      strokeWidth={strokeWidth || 2}
      rx={4}
      ry={4}
    />
  );
}

// ============================================================================
// Dagre Layout Algorithm
// ============================================================================

function getLayoutedElements(
  groups: GroupWithLayout[],
  expandedGroups: Set<string>,
  selectedGroup: GroupWithLayout | null,
  onSelectGroup: (group: GroupWithLayout) => void,
  onToggleExpand: (groupId: string) => void,
  direction: LayoutDirection = "TB",
  showDebug: boolean = false
): { nodes: Node<GroupNodeData>[]; edges: Edge[] } {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  // Fixed dimensions for node sizing (must match CollapsibleGroupNode's dimensions)
  const COLLAPSED_WIDTH = 180;
  const COLLAPSED_HEIGHT = 72;
  const EXPANDED_WIDTH = 240;

  // For LR layout, we use uniform heights so dagre aligns nodes correctly
  // This ensures handles (at node centers) are at the same Y for connected nodes
  const LAYOUT_HEIGHT = 72;

  // Actual render dimensions based on expanded state
  const getActualDimensions = (group: GroupWithLayout) => {
    const isExpanded = expandedGroups.has(group.name);
    const tasks = group.tasks || [];
    const hasManyTasks = tasks.length > 1;

    if (isExpanded && hasManyTasks) {
      const taskListHeight = Math.min(tasks.length, 50) * 28 + 16;
      return {
        width: EXPANDED_WIDTH,
        height: Math.min(72 + taskListHeight, 320),
      };
    }
    return { width: COLLAPSED_WIDTH, height: COLLAPSED_HEIGHT };
  };

  // Layout dimensions for dagre - uniform height in LR mode for alignment
  const getLayoutDimensions = (group: GroupWithLayout) => {
    const actualDims = getActualDimensions(group);

    if (direction === "LR") {
      // LR mode: use uniform height so dagre aligns connected nodes at same Y
      // Actual rendering will still use real heights
      return { width: actualDims.width, height: LAYOUT_HEIGHT };
    }

    // TB mode: use actual dimensions
    return actualDims;
  };

  // ============================================================================
  // Dagre Configuration
  // ============================================================================
  // Using dagre's built-in alignment. Key options:
  // - align: 'UL'|'UR'|'DL'|'DR' - how nodes align within their rank
  // - ranker: 'network-simplex'|'tight-tree'|'longest-path'
  // ============================================================================

  dagreGraph.setGraph({
    rankdir: direction,
    // No 'align' option = dagre centers nodes relative to their connections
    ranker: "network-simplex", // Best for minimizing edge length
    nodesep: direction === "TB" ? 60 : 100, // Cross-axis spacing between nodes
    ranksep: direction === "TB" ? 100 : 150, // Main-axis spacing between levels
    marginx: 50,
    marginy: 50,
  });

  // Add nodes with layout dimensions
  // In LR mode: uniform heights ensure dagre aligns connected nodes at same Y
  // In TB mode: actual dimensions for proper spacing
  groups.forEach((group) => {
    const dims = getLayoutDimensions(group);
    dagreGraph.setNode(group.name, {
      width: dims.width,
      height: dims.height
    });
  });

  // Add edges using downstream_groups (backend field name)
  groups.forEach((group) => {
    const downstreams = group.downstream_groups || [];
    downstreams.forEach((downstreamName) => {
      dagreGraph.setEdge(group.name, downstreamName);
    });
  });

  // Run dagre layout - this is the single source of truth for positioning
  dagre.layout(dagreGraph);

  // ============================================================================
  // Debug: Log dagre output for analysis
  // ============================================================================

  if (showDebug) {
    console.group(`📊 Dagre Layout Debug (${direction})`);
    console.log("Config:", {
      direction,
      nodesep: direction === "TB" ? 60 : 100,
      ranksep: direction === "TB" ? 100 : 150,
    });

    // Build upstream map for debug (computed from downstream_groups)
    const upstreamMap = new Map<string, string[]>();
    groups.forEach(g => upstreamMap.set(g.name, []));
    groups.forEach(g => {
      (g.downstream_groups || []).forEach(downstream => {
        const upstreams = upstreamMap.get(downstream);
        if (upstreams) upstreams.push(g.name);
      });
    });

    // Log each node's position and dimensions
    const nodeDebug = groups.map((group) => {
      const dagreNode = dagreGraph.node(group.name);
      const actualDims = getActualDimensions(group);
      const layoutDims = getLayoutDimensions(group);
      const isExpanded = expandedGroups.has(group.name);
      const upstreams = upstreamMap.get(group.name) || [];

      // Handle Y = dagreNode.y (center of layout box)
      const nodeTopY = dagreNode.y - actualDims.height / 2;
      const handleY = nodeTopY + actualDims.height / 2;

      return {
        name: group.name.slice(0, 20),
        level: group.level,
        expanded: isExpanded,
        actualH: actualDims.height,
        layoutH: layoutDims.height,
        nodeTopY: Math.round(nodeTopY),
        handleY: Math.round(handleY),
        parents: upstreams.length,
        children: (group.downstream_groups || []).length,
      };
    });
    console.table(nodeDebug);

    // Check for alignment issues in LR mode
    if (direction === "LR") {
      console.log("\n🔍 LR Alignment Check (center Y = handle Y, should match for 1:1 chains):");

      groups.forEach((group) => {
        const upstreams = upstreamMap.get(group.name) || [];
        if (upstreams.length === 1) {
          const parentName = upstreams[0];
          const parentNode = dagreGraph.node(parentName);
          const childNode = dagreGraph.node(group.name);
          const yDiff = Math.abs(parentNode.y - childNode.y);
          if (yDiff > 1) {
            console.warn(`  ⚠️ ${parentName.slice(0,15)} (Y=${Math.round(parentNode.y)}) → ${group.name.slice(0,15)} (Y=${Math.round(childNode.y)}) | Diff: ${Math.round(yDiff)}px`);
          } else {
            console.log(`  ✅ ${parentName.slice(0,15)} → ${group.name.slice(0,15)} aligned (Y=${Math.round(childNode.y)})`);
          }
        }
      });
    }
    console.groupEnd();
  }

  // ============================================================================
  // Convert dagre output to React Flow nodes
  // ============================================================================

  const nodes: Node<GroupNodeData>[] = groups.map((group) => {
    const dagreNode = dagreGraph.node(group.name);
    const actualDims = getActualDimensions(group);

    // Dagre returns center position based on layout dimensions
    // We render with actual dimensions, but position so the CENTER is at dagreNode.y
    // This ensures handles (at center) align with dagre's calculated positions
    return {
      id: group.name, // Use name as React Flow node ID
      type: "collapsibleGroup",
      position: {
        x: dagreNode.x - actualDims.width / 2,
        y: dagreNode.y - actualDims.height / 2,
      },
      // Initial dimensions for MiniMap - these are hints, not overrides
      // React Flow will still measure the actual node for edge routing
      initialWidth: actualDims.width,
      initialHeight: actualDims.height,
      data: {
        group,
        isSelected: selectedGroup?.name === group.name,
        isExpanded: expandedGroups.has(group.name),
        layoutDirection: direction,
        onSelect: onSelectGroup,
        onToggleExpand,
        // Pass dimensions for bounds calculations
        nodeWidth: actualDims.width,
        nodeHeight: actualDims.height,
      },
    };
  });

  // Convert to React Flow edges - always use smoothstep for 90-degree edges
  // Edge colors match status: blue=running, green=completed, gray=waiting, red=failed
  const getEdgeColor = (cat: string) => {
    switch (cat) {
      case "running": return "#3b82f6"; // blue
      case "completed": return "#10b981"; // green
      case "failed": return "#ef4444"; // red
      default: return "#52525b"; // gray for waiting
    }
  };

  const edges: Edge[] = [];

  groups.forEach((group) => {
    const category = getStatusCategory(group.status);
    const edgeColor = getEdgeColor(category);
    const isTerminal = category === "completed" || category === "failed";
    const downstreams = group.downstream_groups || [];

    downstreams.forEach((downstreamName) => {
      edges.push({
        id: `${group.name}-${downstreamName}`,
        source: group.name,
        target: downstreamName,
        sourceHandle: "source",
        targetHandle: "target",
        type: "smoothstep",
        animated: category === "running",
        style: {
          stroke: edgeColor,
          strokeWidth: 2,
          strokeDasharray: isTerminal || category === "running" ? undefined : "5 3",
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: edgeColor,
          width: 16,
          height: 16,
        },
      });
    });
  });

  return { nodes, edges };
}

// ============================================================================
// Detail Panel
// ============================================================================

function DetailPanel({
  group,
  onClose,
}: {
  group: GroupWithLayout;
  onClose: () => void;
}) {
  const tasks = group.tasks || [];
  const [selectedTask, setSelectedTask] = useState<TaskQueryResponse | null>(
    tasks[0] || null
  );
  const category = getStatusCategory(group.status);
  const style = statusStyles[category];

  // Reset selected task when group changes
  useEffect(() => {
    setSelectedTask(tasks[0] || null);
  }, [group, tasks]);

  return (
    <div className="w-80 border-l border-zinc-800 bg-zinc-900/95 backdrop-blur overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 bg-zinc-900/95 backdrop-blur border-b border-zinc-800 p-4 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getStatusIcon(group.status)}
            <h3 className="font-semibold text-zinc-100">{group.name}</h3>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <XCircle className="h-4 w-4 text-zinc-400" />
          </Button>
        </div>
        <div className={cn("text-xs mt-1", style.text)}>
          {group.status} • {tasks.length} task
          {tasks.length > 1 ? "s" : ""}
        </div>
      </div>

      {/* Task list */}
      {tasks.length > 1 && (
        <div className="p-4 border-b border-zinc-800">
          <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">
            Tasks ({tasks.length})
          </h4>
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {tasks.map((task) => {
              const taskKey = `${task.name}-${task.retry_id}`;
              const isSelected = selectedTask?.name === task.name && selectedTask?.retry_id === task.retry_id;
              const taskDuration = calculateDuration(task.start_time, task.end_time);
              return (
                <button
                  key={taskKey}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors",
                    isSelected
                      ? "bg-cyan-500/20 text-cyan-300"
                      : "hover:bg-zinc-800 text-zinc-300"
                  )}
                  onClick={() => setSelectedTask(task)}
                >
                  {getStatusIcon(task.status, "h-3.5 w-3.5")}
                  <span className="flex-1 truncate">{task.name}</span>
                  <span className="text-xs opacity-60">
                    {formatDurationUtil(taskDuration)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Selected task details */}
      {selectedTask && (
        <div className="p-4 space-y-4">
          <div>
            <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">
              Task Details
            </h4>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-zinc-400">Name</dt>
                <dd className="text-zinc-200 font-mono text-xs">
                  {selectedTask.name}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-400">Status</dt>
                <dd className={statusStyles[getStatusCategory(selectedTask.status)].text}>
                  {selectedTask.status}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-400">Duration</dt>
                <dd className="text-zinc-200">
                  {formatDurationUtil(calculateDuration(selectedTask.start_time, selectedTask.end_time))}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-400">Node</dt>
                <dd className="text-zinc-200 font-mono text-xs">
                  {selectedTask.node_name || "-"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-400">Pod</dt>
                <dd className="text-zinc-200 font-mono text-xs truncate max-w-[150px]" title={selectedTask.pod_name}>
                  {selectedTask.pod_name || "-"}
                </dd>
              </div>
              {selectedTask.retry_id > 0 && (
                <div className="flex justify-between">
                  <dt className="text-zinc-400">Retry</dt>
                  <dd className="text-zinc-200">
                    #{selectedTask.retry_id}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" asChild>
              <a href={selectedTask.logs} target="_blank" rel="noopener noreferrer">
                <FileText className="h-3 w-3 mr-1" />
                Logs
              </a>
            </Button>
            {getStatusCategory(selectedTask.status) === "running" && (
              <Button variant="outline" size="sm" className="flex-1 h-7 text-xs">
                <Terminal className="h-3 w-3 mr-1" />
                Shell
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Animated Fit View Helper
// ============================================================================

function FitViewOnLayoutChange({
  layoutDirection,
  rootNodeIds,
}: {
  layoutDirection: LayoutDirection;
  rootNodeIds: string[];
}) {
  const { setCenter, getNode } = useReactFlow();
  const prevLayout = useRef(layoutDirection);
  const hasInitialized = useRef(false);

  // Helper to zoom to first root node
  const zoomToRoot = useCallback((duration: number = 500) => {
    if (rootNodeIds.length === 0) return;

    const firstRootId = rootNodeIds[0];
    const rootNode = getNode(firstRootId);

    if (rootNode) {
      const data = rootNode.data as GroupNodeData;
      const nodeWidth = data?.nodeWidth || 180;
      const nodeHeight = data?.nodeHeight || 72;
      const centerX = rootNode.position.x + nodeWidth / 2;
      const centerY = rootNode.position.y + nodeHeight / 2;

      setCenter(centerX, centerY, {
        zoom: 1,
        duration,
      });
    }
  }, [rootNodeIds, getNode, setCenter]);

  useEffect(() => {
    // On initial mount or layout direction change, zoom to root
    if (!hasInitialized.current || prevLayout.current !== layoutDirection) {
      const timer = setTimeout(() => {
        zoomToRoot(hasInitialized.current ? 400 : 500);
        hasInitialized.current = true;
        prevLayout.current = layoutDirection;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [layoutDirection, zoomToRoot]);

  return null;
}

// ============================================================================
// Main Page
// ============================================================================

// Auto-collapse thresholds
const AUTO_COLLAPSE_TASK_THRESHOLD = 20; // Collapse groups with 20+ tasks
const AUTO_COLLAPSE_GROUP_THRESHOLD = 10; // Collapse all groups if 10+ groups

function computeInitialExpandedGroups(groups: GroupWithLayout[]): Set<string> {
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
  if (groups.length >= AUTO_COLLAPSE_GROUP_THRESHOLD) {
    return new Set();
  }

  // Otherwise, expand groups with fewer tasks than threshold
  return new Set(
    expandableGroups
      .filter((g) => (g.tasks || []).length < AUTO_COLLAPSE_TASK_THRESHOLD)
      .map((g) => g.name)
  );
}

function ReactFlowDagPageInner() {
  const [workflowPattern, setWorkflowPattern] = useState<WorkflowPattern>("complex");
  const [layoutDirection, setLayoutDirection] = useState<LayoutDirection>("TB");
  const [selectedGroup, setSelectedGroup] = useState<GroupWithLayout | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [showDebug, setShowDebug] = useState(false);

  // Generate workflow from backend-aligned mock
  const workflow = useMemo(
    () => EXAMPLE_WORKFLOWS[workflowPattern](),
    [workflowPattern]
  );

  // Compute topological levels from dependency graph (NOT from backend)
  // This transforms GroupQueryResponse[] → GroupWithLayout[]
  const groupsWithLayout = useMemo(
    () => computeTopologicalLevelsFromGraph(workflow.groups),
    [workflow.groups]
  );

  // Initialize expanded groups based on workflow structure
  useEffect(() => {
    setExpandedGroups(computeInitialExpandedGroups(groupsWithLayout));
  }, [groupsWithLayout]);

  // Toggle expand/collapse
  const handleToggleExpand = useCallback((groupName: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) {
        next.delete(groupName);
      } else {
        next.add(groupName);
      }
      return next;
    });
  }, []);

  // Expand/collapse all - only affects multi-task groups
  const handleExpandAll = useCallback(() => {
    const expandableNames = groupsWithLayout
      .filter((g) => (g.tasks || []).length > 1)
      .map((g) => g.name);
    setExpandedGroups(new Set(expandableNames));
  }, [groupsWithLayout]);

  const handleCollapseAll = useCallback(() => {
    setExpandedGroups(new Set());
  }, []);

  // Get root node IDs (level 0) for initial zoom target
  const rootNodeIds = useMemo(() => {
    return groupsWithLayout
      .filter((g) => g.level === 0)
      .map((g) => g.name);
  }, [groupsWithLayout]);

  // Layout nodes and edges using groups with computed topological levels
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () =>
      getLayoutedElements(
        groupsWithLayout,
        expandedGroups,
        selectedGroup,
        setSelectedGroup,
        handleToggleExpand,
        layoutDirection,
        showDebug
      ),
    [groupsWithLayout, expandedGroups, selectedGroup, layoutDirection, handleToggleExpand, showDebug]
  );

  const [nodes, setNodes] = useNodesState(initialNodes);
  const [edges, setEdges] = useEdgesState(initialEdges);

  // Sync nodes/edges when layout changes (expansion, direction, selection, etc.)
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // Calculate bounds from nodes for pan limiting
  // We add generous padding so edge nodes can be centered in the viewport
  const nodeBounds = useMemo(() => {
    if (nodes.length === 0) return { minX: 0, maxX: 1000, minY: 0, maxY: 1000, fitAllZoom: 0.5 };

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach((node) => {
      const data = node.data as GroupNodeData;
      const width = data?.nodeWidth || 180;
      const height = data?.nodeHeight || 72;
      minX = Math.min(minX, node.position.x);
      maxX = Math.max(maxX, node.position.x + width);
      minY = Math.min(minY, node.position.y);
      maxY = Math.max(maxY, node.position.y + height);
    });

    // Estimated viewport dimensions
    const viewportWidth = 1200;
    const viewportHeight = 800;

    // To allow centering any node (including edge nodes) at zoom 1,
    // we need padding equal to half the viewport size
    const paddingX = viewportWidth / 2;
    const paddingY = viewportHeight / 2;

    // Content dimensions for fit calculations
    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;

    const fitZoomX = viewportWidth / (contentWidth + 100);
    const fitZoomY = viewportHeight / (contentHeight + 100);
    const fitAllZoom = Math.min(fitZoomX, fitZoomY, 1);

    return {
      // Pan limits: allow centering any node in viewport
      minX: minX - paddingX,
      maxX: maxX + paddingX,
      minY: minY - paddingY,
      maxY: maxY + paddingY,
      fitAllZoom: Math.max(0.1, fitAllZoom),
    };
  }, [nodes]);

  // Pattern change - expanded groups will be recomputed by the effect
  const onPatternChange = useCallback((pattern: WorkflowPattern) => {
    setWorkflowPattern(pattern);
    setSelectedGroup(null);
  }, []);

  // Layout direction change
  const onLayoutChange = useCallback((direction: LayoutDirection) => {
    setLayoutDirection(direction);
  }, []);

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-zinc-100" asChild>
            <a href="/dev/workflow-explorer">
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </a>
          </Button>
          <div className="h-6 w-px bg-zinc-700" />
          <div>
            <h1 className="text-lg font-semibold text-zinc-100">
              React Flow + Dagre DAG
            </h1>
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <span className="text-emerald-400 flex items-center gap-1">
                {getStatusIcon(workflow.status, "h-3.5 w-3.5")}
                {workflow.status}
              </span>
              <span>•</span>
              <span>{groupsWithLayout.length} groups</span>
              <span>•</span>
              <span>{groupsWithLayout.reduce((sum, g) => sum + (g.tasks?.length || 0), 0)} tasks</span>
              <span>•</span>
              <span className="font-mono">{formatDurationUtil(workflow.duration || null)}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExpandAll}>
            <Maximize2 className="h-4 w-4 mr-2" />
            Expand All
          </Button>
          <Button variant="outline" size="sm" onClick={handleCollapseAll}>
            <Minimize2 className="h-4 w-4 mr-2" />
            Collapse All
          </Button>
          <Button variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button
            variant={showDebug ? "default" : "outline"}
            size="sm"
            onClick={() => setShowDebug(!showDebug)}
          >
            🐛 Debug
          </Button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-4">
          <Tabs value={workflowPattern} onValueChange={(v) => onPatternChange(v as WorkflowPattern)}>
            <TabsList className="bg-zinc-800/50">
              <TabsTrigger value="linear" className="data-[state=active]:bg-zinc-700">
                Linear
              </TabsTrigger>
              <TabsTrigger value="diamond" className="data-[state=active]:bg-zinc-700">
                Diamond
              </TabsTrigger>
              <TabsTrigger value="parallel" className="data-[state=active]:bg-zinc-700">
                Parallel
              </TabsTrigger>
              <TabsTrigger value="complex" className="data-[state=active]:bg-zinc-700">
                Complex
              </TabsTrigger>
              <TabsTrigger value="massiveParallel" className="data-[state=active]:bg-zinc-700">
                200 Tasks
              </TabsTrigger>
              <TabsTrigger value="manyGroups" className="data-[state=active]:bg-zinc-700">
                100 Groups
              </TabsTrigger>
              <TabsTrigger value="multiRoot" className="data-[state=active]:bg-zinc-700">
                Multi-Root
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">Layout:</span>
          <Button
            variant={layoutDirection === "TB" ? "default" : "outline"}
            size="sm"
            className="h-8"
            onClick={() => onLayoutChange("TB")}
          >
            <ArrowDown className="h-4 w-4 mr-1" />
            Vertical
          </Button>
          <Button
            variant={layoutDirection === "LR" ? "default" : "outline"}
            size="sm"
            className="h-8"
            onClick={() => onLayoutChange("LR")}
          >
            <ArrowRight className="h-4 w-4 mr-1" />
            Horizontal
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* React Flow Canvas */}
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            // Read-only DAG - no editing, but nodes are clickable
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={true}
            edgesFocusable={false}
            nodesFocusable={true}
            selectNodesOnDrag={false}
            // Default to showing root node at reasonable size
            defaultViewport={{ x: 100, y: 50, zoom: 0.8 }}
            // Zoom limits: min = calculated fit-all zoom, max = reasonable detail
            minZoom={nodeBounds.fitAllZoom}
            maxZoom={1.5}
            // Limit panning to DAG bounds
            translateExtent={[
              [nodeBounds.minX, nodeBounds.minY],
              [nodeBounds.maxX, nodeBounds.maxY],
            ]}
            // Scroll behavior: pan by default, zoom with cmd/ctrl
            panOnScroll={true}
            zoomOnScroll={false}
            panOnScrollMode={PanOnScrollMode.Free}
            zoomOnPinch={true}
            preventScrolling={true}
            proOptions={{ hideAttribution: true }}
          >
            <FitViewOnLayoutChange
              layoutDirection={layoutDirection}
              rootNodeIds={rootNodeIds}
            />
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#27272a" />
            <Controls
              showInteractive={false}
              position="bottom-left"
            />
            <MiniMap
              pannable={true}
              zoomable={true}
              position="top-left"
              style={{ background: "#18181b" }}
              maskColor="rgba(0, 0, 0, 0.6)"
              nodeStrokeWidth={2}
              nodeComponent={MiniMapNode}
              nodeColor={(node) => {
                const data = node.data as GroupNodeData;
                if (!data?.group) return "#52525b";
                const category = getStatusCategory(data.group.status);
                switch (category) {
                  case "waiting":
                    return "#71717a"; // muted zinc
                  case "running":
                    return "#3b82f6"; // blue
                  case "completed":
                    return "#10b981"; // green
                  case "failed":
                    return "#ef4444"; // red
                  default:
                    return "#52525b";
                }
              }}
              nodeStrokeColor={(node) => {
                const data = node.data as GroupNodeData;
                if (!data?.group) return "#3f3f46";
                const category = getStatusCategory(data.group.status);
                switch (category) {
                  case "waiting":
                    return "#52525b";
                  case "running":
                    return "#1d4ed8";
                  case "completed":
                    return "#047857";
                  case "failed":
                    return "#b91c1c";
                  default:
                    return "#3f3f46";
                }
              }}
            />
          </ReactFlow>
        </div>

        {/* Detail Panel */}
        {selectedGroup && (
          <DetailPanel group={selectedGroup} onClose={() => setSelectedGroup(null)} />
        )}
      </div>

      {/* Design Notes */}
      <div className="p-4 border-t border-zinc-800 bg-zinc-900/50">
        <details>
          <summary className="text-sm font-medium text-zinc-400 cursor-pointer hover:text-zinc-300">
            🎨 Design Notes (click to expand)
          </summary>
          <ul className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-500">
            <li>
              ✅ <strong>Collapsible groups</strong>: Click chevron to expand/collapse task list
            </li>
            <li>
              ✅ <strong>Scale test</strong>: 200 tasks in one group, 100 groups with 5 tasks each
            </li>
            <li>
              ✅ <strong>Multi-root DAGs</strong>: Multiple starting nodes that converge
            </li>
            <li>
              ✅ <strong>Dynamic layout</strong>: Dagre recalculates when nodes expand/collapse
            </li>
            <li>
              ✅ <strong>Expand/Collapse All</strong>: Bulk expand/collapse buttons
            </li>
            <li>
              ✅ <strong>Virtualized list</strong>: Only shows first 50 tasks when expanded
            </li>
          </ul>
        </details>
      </div>
    </div>
  );
}

// Wrap with ReactFlowProvider to enable useReactFlow hook
export default function ReactFlowDagPage() {
  return (
    <ReactFlowProvider>
      <ReactFlowDagPageInner />
    </ReactFlowProvider>
  );
}
