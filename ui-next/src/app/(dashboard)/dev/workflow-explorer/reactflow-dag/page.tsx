// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * ReactFlow DAG Visualization Page
 *
 * Workflow DAG visualization using ReactFlow and ELK.js layout.
 *
 * Architecture:
 * - /constants.ts - Dimensions, styling, thresholds
 * - /types.ts - TypeScript types
 * - /components/ - React components (GroupNode, DetailPanel, GroupPanel, etc.)
 * - /layout/ - ELK.js layout logic
 * - /hooks/ - State management (useDAGState, useResizablePanel)
 * - /utils/ - Status helpers, icons
 *
 * Navigation Flow:
 * - Click GROUP node (multi-task) → Opens GroupPanel
 * - Click task in GroupPanel → Opens DetailPanel
 * - Click SINGLE-TASK node → Opens DetailPanel directly
 */

"use client";

import { useState, useMemo, useCallback } from "react";
import { ReactFlow, ReactFlowProvider, Background, MiniMap, BackgroundVariant, PanOnScrollMode } from "@xyflow/react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

import "@xyflow/react/dist/style.css";
import "./dag.css";

// Local modules
import type { LayoutDirection, GroupNodeData } from "./types";
import { DEFAULT_ZOOM, MAX_ZOOM, STATUS_STYLES, GPU_STYLES } from "./constants";
import {
  nodeTypes,
  DetailPanel,
  MiniMapNode,
  FitViewOnLayoutChange,
  DAGErrorBoundary,
  DAGHeader,
  DAGToolbar,
  DAGControls,
  GroupPanel,
} from "./components";
import { useDAGState, useResizablePanel } from "./hooks";
import { getStatusCategory } from "./utils";
import { DAGProvider } from "./context";

// Workflow data
import { EXAMPLE_WORKFLOWS, type WorkflowPattern } from "../mock-workflow-v2";

// ============================================================================
// Main Page Component
// ============================================================================

function ReactFlowDagPageInner() {
  const [workflowPattern, setWorkflowPattern] = useState<WorkflowPattern>("complex");
  const [showMinimap, setShowMinimap] = useState(true);

  // Generate workflow from mock
  const workflow = useMemo(() => EXAMPLE_WORKFLOWS[workflowPattern](), [workflowPattern]);

  // DAG state management (includes panel navigation state)
  const {
    nodes,
    edges,
    layoutDirection,
    setLayoutDirection,
    groupsWithLayout,
    rootNodeIds,
    handleExpandAll,
    handleCollapseAll,
    handleSelectGroup,
    handleSelectTask,
    handleToggleExpand,
    panelView,
    selectedGroup,
    selectedTask,
    handleClosePanel,
    handleBackToGroup,
    nodeBounds,
    isLayouting,
  } = useDAGState({
    groups: workflow.groups,
    initialDirection: "TB",
  });

  // Resizable panel (for GroupPanel)
  const { panelPct, setPanelPct, isDragging, handleMouseDown, containerRef } = useResizablePanel();

  // Pattern change handler
  const onPatternChange = useCallback((pattern: WorkflowPattern) => {
    setWorkflowPattern(pattern);
  }, []);

  // Layout direction change handler
  const onLayoutChange = useCallback(
    (direction: LayoutDirection) => {
      setLayoutDirection(direction);
    },
    [setLayoutDirection],
  );

  // Minimap toggle handler
  const handleToggleMinimap = useCallback(() => {
    setShowMinimap((prev) => !prev);
  }, []);

  // MiniMap color callbacks
  const getMiniMapNodeColor = useCallback((node: { data: unknown }) => {
    const data = node.data as GroupNodeData;
    if (!data?.group) return "#52525b";
    const category = getStatusCategory(data.group.status);
    return STATUS_STYLES[category].color;
  }, []);

  const getMiniMapStrokeColor = useCallback((node: { data: unknown }) => {
    const data = node.data as GroupNodeData;
    if (!data?.group) return "#3f3f46";
    const category = getStatusCategory(data.group.status);
    return STATUS_STYLES[category].strokeColor;
  }, []);

  // Determine if any panel is open
  const isPanelOpen = panelView !== "none";

  return (
    <DAGErrorBoundary>
      <div className="flex h-full flex-col bg-zinc-950">
        {/* Skip link for accessibility */}
        <a
          href="#dag-canvas"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-zinc-800 focus:px-4 focus:py-2 focus:text-zinc-100"
        >
          Skip to DAG visualization
        </a>

        {/* Header */}
        <DAGHeader
          status={workflow.status}
          duration={workflow.duration}
          groups={groupsWithLayout}
          isLayouting={isLayouting}
          onExpandAll={handleExpandAll}
          onCollapseAll={handleCollapseAll}
        />

        {/* Toolbar - Demo pattern selector */}
        <DAGToolbar
          workflowPattern={workflowPattern}
          onPatternChange={onPatternChange}
        />

        {/* Main Content */}
        <div ref={containerRef} className="relative flex flex-1 overflow-hidden">
          {/* ReactFlow Canvas */}
          <main
            id="dag-canvas"
            className="flex-1"
            role="application"
            aria-label="Workflow DAG visualization"
          >
            <DAGProvider
              onSelectGroup={handleSelectGroup}
              onSelectTask={handleSelectTask}
              onToggleExpand={handleToggleExpand}
            >
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                // Read-only DAG
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={true}
                edgesFocusable={false}
                nodesFocusable={true}
                selectNodesOnDrag={false}
                // Viewport settings
                defaultViewport={{ x: 100, y: 50, zoom: DEFAULT_ZOOM }}
                minZoom={nodeBounds.fitAllZoom}
                maxZoom={MAX_ZOOM}
                translateExtent={[
                  [nodeBounds.minX, nodeBounds.minY],
                  [nodeBounds.maxX, nodeBounds.maxY],
                ]}
                // Scroll behavior
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
                <Background
                  variant={BackgroundVariant.Dots}
                  gap={20}
                  size={1}
                  color="#27272a"
                />
                {/* Unified controls panel */}
                <DAGControls
                  layoutDirection={layoutDirection}
                  onLayoutChange={onLayoutChange}
                  showMinimap={showMinimap}
                  onToggleMinimap={handleToggleMinimap}
                />
                {/* Conditional minimap */}
                {showMinimap && (
                  <MiniMap
                    pannable={true}
                    zoomable={true}
                    position="top-left"
                    style={{ background: "#18181b" }}
                    maskColor="rgba(0, 0, 0, 0.6)"
                    nodeStrokeWidth={2}
                    nodeComponent={MiniMapNode}
                    nodeColor={getMiniMapNodeColor}
                    nodeStrokeColor={getMiniMapStrokeColor}
                    aria-label="Workflow minimap"
                  />
                )}
              </ReactFlow>
            </DAGProvider>
          </main>

          {/* Resize Handle (only visible when GroupPanel is open) */}
          {panelView === "group" && selectedGroup && (
            <div
              className={cn(
                "group absolute top-0 z-20 h-full w-1 cursor-ew-resize",
                isDragging ? "bg-blue-500" : "bg-transparent hover:bg-zinc-300 dark:hover:bg-zinc-600",
              )}
              style={{
                left: `${100 - panelPct}%`,
                transform: "translateX(-50%)",
                willChange: isDragging ? "left" : "auto",
              }}
              onMouseDown={handleMouseDown}
            >
              <div
                className={cn(
                  "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-zinc-200 px-0.5 py-1 shadow-md dark:bg-zinc-700",
                  isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
                style={{
                  transition: "opacity 150ms ease-out",
                  ...GPU_STYLES.accelerated,
                }}
              >
                <GripVertical className="size-4 text-zinc-600 dark:text-zinc-300" />
              </div>
            </div>
          )}

          {/* GroupPanel - Shows task list for multi-task groups */}
          {panelView === "group" && selectedGroup && (
            <div
              className="absolute inset-y-0 right-0 z-10"
              style={{ width: `${panelPct}%`, ...GPU_STYLES.accelerated }}
            >
              <GroupPanel
                group={selectedGroup}
                onClose={handleClosePanel}
                onSelectTask={handleSelectTask}
                panelPct={panelPct}
                onPanelResize={setPanelPct}
              />
            </div>
          )}

          {/* DetailPanel - Shows single task details */}
          {panelView === "task" && selectedGroup && selectedTask && (
            <DetailPanel
              group={selectedGroup}
              task={selectedTask}
              onClose={handleClosePanel}
              onBack={(selectedGroup.tasks?.length ?? 0) > 1 ? handleBackToGroup : undefined}
            />
          )}
        </div>

        {/* Footer */}
        <footer className="border-t border-zinc-800 bg-zinc-900/50 p-4">
          <details>
            <summary className="cursor-pointer text-sm font-medium text-zinc-400 hover:text-zinc-300">
              🎨 Implementation Notes
            </summary>
            <ul className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-500">
              <li>
                ✅ <strong>ELK.js layout</strong>: Better algorithms, web worker ready
              </li>
              <li>
                ✅ <strong>Virtualized task lists</strong>: Handles 200+ tasks efficiently
              </li>
              <li>
                ✅ <strong>WCAG 2.1 AA</strong>: ARIA labels, keyboard nav, focus indicators
              </li>
              <li>
                ✅ <strong>GroupPanel integration</strong>: Smart search, sortable columns
              </li>
              <li>
                ✅ <strong>Optimized re-renders</strong>: Selection doesn&apos;t trigger layout
              </li>
              <li>
                ✅ <strong>Reduced motion</strong>: Respects prefers-reduced-motion
              </li>
            </ul>
          </details>
        </footer>
      </div>
    </DAGErrorBoundary>
  );
}

// Wrap with ReactFlowProvider
export default function ReactFlowDagPage() {
  return (
    <ReactFlowProvider>
      <ReactFlowDagPageInner />
    </ReactFlowProvider>
  );
}
