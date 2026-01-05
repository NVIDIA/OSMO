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
 * - /components/ - React components (GroupNode, DetailsPanel, etc.)
 * - /layout/ - ELK.js layout logic
 * - /hooks/ - State management (useDAGState, useResizablePanel)
 * - /utils/ - Status helpers, icons
 *
 * Navigation Flow:
 * - Click GROUP node (multi-task) → Opens DetailsPanel with GroupDetails
 * - Click task in GroupDetails → Transitions to TaskDetails (same panel)
 * - Click SINGLE-TASK node → Opens DetailsPanel with TaskDetails directly
 * - Sibling navigation in TaskDetails → Jump between tasks in same group
 */

"use client";

import { useState, useMemo, useCallback } from "react";
import { ReactFlow, ReactFlowProvider, Background, MiniMap, BackgroundVariant, PanOnScrollMode } from "@xyflow/react";
import { useTheme } from "next-themes";

import "@xyflow/react/dist/style.css";
import "./dag.css";

// Local modules
import type { LayoutDirection } from "./types/dag-layout";
import { DEFAULT_ZOOM, MAX_ZOOM, MINIMAP, BACKGROUND } from "./constants";
import { usePage } from "@/components/shell";

import {
  nodeTypes,
  MiniMapNode,
  FitViewOnLayoutChange,
  DAGErrorBoundary,
  DAGHeader,
  DAGToolbar,
  DAGControls,
  DetailsPanel,
} from "./components";
import { useDAGState, useResizablePanel, useViewportBoundaries } from "./hooks";
import { DAGProvider } from "./context";

// MiniMap color functions (pure, extracted to utils for memoization)
import { getMiniMapNodeColor, getMiniMapStrokeColor } from "./utils";

// Workflow data
import { EXAMPLE_WORKFLOWS, type WorkflowPattern } from "../mock-workflow-v2";

// ============================================================================
// Main Page Component
// ============================================================================

function ReactFlowDagPageInner() {
  usePage({
    title: "ReactFlow DAG",
    breadcrumbs: [
      { label: "Dev", href: "/dev" },
      { label: "Workflow Explorer", href: "/dev/workflow-explorer" },
    ],
  });

  const [workflowPattern, setWorkflowPattern] = useState<WorkflowPattern>("complex");
  const [showMinimap, setShowMinimap] = useState(true);
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(false);
  const { resolvedTheme } = useTheme();

  // Determine background color based on theme
  const backgroundDotColor = resolvedTheme === "dark" ? BACKGROUND.COLOR_DARK : BACKGROUND.COLOR_LIGHT;

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

  // Resizable panel
  const { panelPct, setPanelPct, isDragging, handleMouseDown, containerRef } = useResizablePanel();

  // Determine if panel is open (needed for viewport boundaries)
  const isPanelOpen = panelView !== "none" && selectedGroup !== null;

  // Viewport boundary management (auto-pan, pan limits, resize handling)
  const { handleMove, handleMoveEnd } = useViewportBoundaries({
    nodeBounds,
    panelPct,
    isPanelOpen,
    containerRef,
    selectedGroupName: selectedGroup?.name ?? null,
    panelView,
    nodes,
  });

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

  // Details expansion toggle (persists across group/task navigation)
  const handleToggleDetailsExpanded = useCallback(() => {
    setIsDetailsExpanded((prev) => !prev);
  }, []);

  // Note: getMiniMapNodeColor and getMiniMapStrokeColor are imported from utils
  // They're pure functions extracted outside the component for better performance

  return (
    <DAGErrorBoundary>
      <div className="flex h-full flex-col bg-gray-50 dark:bg-zinc-950">
        {/* Skip link for accessibility */}
        <a
          href="#dag-canvas"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-gray-100 focus:px-4 focus:py-2 focus:text-gray-900 dark:focus:bg-zinc-800 dark:focus:text-zinc-100"
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
        <div
          ref={containerRef}
          className="relative flex flex-1 overflow-hidden"
        >
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
                // Enforce boundaries during and after pan/zoom
                onMove={handleMove}
                onMoveEnd={handleMoveEnd}
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
                  gap={BACKGROUND.GAP}
                  size={BACKGROUND.DOT_SIZE}
                  color={backgroundDotColor}
                />
                {/* Unified controls panel */}
                <DAGControls
                  layoutDirection={layoutDirection}
                  onLayoutChange={onLayoutChange}
                  showMinimap={showMinimap}
                  onToggleMinimap={handleToggleMinimap}
                />
                {/* Conditional minimap - styled via CSS variables in dag.css */}
                {showMinimap && (
                  <MiniMap
                    pannable
                    zoomable
                    position="top-left"
                    style={{
                      width: MINIMAP.WIDTH,
                      height: MINIMAP.HEIGHT,
                    }}
                    nodeStrokeWidth={MINIMAP.NODE_STROKE_WIDTH}
                    nodeComponent={MiniMapNode}
                    nodeColor={getMiniMapNodeColor}
                    nodeStrokeColor={getMiniMapStrokeColor}
                    aria-label="Workflow minimap"
                  />
                )}
              </ReactFlow>
            </DAGProvider>
          </main>

          {/* Unified Details Panel */}
          {isPanelOpen && selectedGroup && (
            <DetailsPanel
              view={panelView as "group" | "task"}
              group={selectedGroup}
              allGroups={groupsWithLayout}
              task={selectedTask}
              onClose={handleClosePanel}
              onBackToGroup={handleBackToGroup}
              onSelectTask={handleSelectTask}
              onSelectGroup={handleSelectGroup}
              panelPct={panelPct}
              onPanelResize={setPanelPct}
              isDragging={isDragging}
              onResizeMouseDown={handleMouseDown}
              isDetailsExpanded={isDetailsExpanded}
              onToggleDetailsExpanded={handleToggleDetailsExpanded}
            />
          )}
        </div>

        {/* Footer */}
        <footer className="border-t border-gray-200 bg-gray-100/50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
          <details>
            <summary className="cursor-pointer text-sm font-medium text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-300">
              🎨 Implementation Notes
            </summary>
            <ul className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-zinc-500">
              <li>
                ✅ <strong>Unified DetailsPanel</strong>: Seamless group ↔ task navigation
              </li>
              <li>
                ✅ <strong>ELK.js layout</strong>: Better algorithms, web worker ready
              </li>
              <li>
                ✅ <strong>Virtualized task lists</strong>: Handles 200+ tasks efficiently
              </li>
              <li>
                ✅ <strong>Sibling navigation</strong>: Jump between tasks in same group
              </li>
              <li>
                ✅ <strong>Smart search</strong>: Chip-based filters, NLP time parsing
              </li>
              <li>
                ✅ <strong>WCAG 2.1 AA</strong>: ARIA labels, keyboard nav, reduced motion
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
