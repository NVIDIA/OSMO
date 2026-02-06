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
 * WorkflowDAGContent Component
 *
 * Pure DAG visualization without panel/shell. Handles ReactFlow rendering,
 * layout, minimap, and controls. Panel and shell are composed externally.
 */

"use client";

import { useState, useMemo, useRef, useCallback, memo, type RefObject } from "react";
import { usePrevious, useIsomorphicLayoutEffect } from "@react-hookz/web";
import { useTheme } from "next-themes";
import { ReactFlowProvider, ReactFlow, Background, MiniMap, PanOnScrollMode, BackgroundVariant } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { SIDEBAR } from "@/components/chrome/constants";
import { useSidebar } from "@/components/shadcn/sidebar";
import { useEventCallback, useResizeObserver } from "usehooks-ts";
import { PANEL } from "@/components/panel/panel-header-controls";
import { nodeTypes } from "./dag/GroupNode";
import { DAGProvider } from "./dag/dag-context";
import { MiniMapNode } from "@/components/dag/components/MiniMapNode";
import { DAGControls } from "@/components/dag/components/DAGControls";
import { VIEWPORT, MINIMAP, BACKGROUND } from "@/components/dag/constants";
import { useViewportBoundaries } from "@/components/dag/hooks/use-viewport-boundaries";
import { useMiniMapColors } from "../lib/status";
import { useDAGState } from "../hooks/use-dag-state";
import type { GroupWithLayout, TaskQueryResponse, WorkflowQueryResponse } from "../lib/workflow-types";

import "../styles/dag.css";

// =============================================================================
// Types
// =============================================================================

export interface WorkflowDAGContentProps {
  /** Workflow data */
  workflow: WorkflowQueryResponse;
  /** Groups with layout information */
  groups: GroupWithLayout[];
  /** Currently selected group name (from URL) */
  selectedGroupName: string | null;
  /** Currently selected task name (from URL) */
  selectedTaskName: string | null;
  /** Currently selected task retry ID (from URL) */
  selectedTaskRetryId: number | null;
  /** Group selection handler */
  onSelectGroup: (group: GroupWithLayout) => void;
  /** Task selection handler */
  onSelectTask: (task: TaskQueryResponse, group: GroupWithLayout) => void;
  /** Panning state (for tick control) */
  isPanning: boolean;
  /** Panning state change handler */
  onPanningChange: (isPanning: boolean) => void;
  /** Selection key for re-center detection */
  selectionKey: string | null;
  /** Container ref for viewport calculations */
  containerRef?: RefObject<HTMLDivElement | null>;
  /** Panel width percentage (for viewport calculations) */
  panelPct: number;
  /** Panel collapsed state (for viewport calculations) */
  isPanelCollapsed: boolean;
  /** Whether panel is being dragged (suppresses viewport recalculation) */
  isDragging?: boolean;
}

// =============================================================================
// Component Implementation
// =============================================================================

function WorkflowDAGContentImpl(props: WorkflowDAGContentProps) {
  const {
    groups,
    selectedGroupName,
    selectedTaskName: _selectedTaskName,
    selectedTaskRetryId: _selectedTaskRetryId,
    isPanelCollapsed,
    isPanning,
    onPanningChange,
    panelPct,
    selectionKey,
    onSelectGroup,
    onSelectTask,
    isDragging = false,
  } = props;

  // DAG-specific state
  const [showMinimap, setShowMinimap] = useState(true);
  const [reCenterTrigger, setReCenterTrigger] = useState(0);
  const { resolvedTheme } = useTheme();

  // Theme-aware minimap color functions
  const { getMiniMapNodeColor, getMiniMapStrokeColor } = useMiniMapColors();

  // Sidebar state for viewport re-centering
  const { state: sidebarState } = useSidebar();
  const isSidebarCollapsed = sidebarState === "collapsed";

  // Container ref
  const dagContainerRef = useRef<HTMLDivElement>(null);

  // Observe container dimensions for viewport calculations
  const { height: containerHeight = VIEWPORT.ESTIMATED_HEIGHT } = useResizeObserver({
    ref: dagContainerRef as React.RefObject<HTMLElement>,
    box: "border-box",
  });

  // Background color based on theme
  const backgroundDotColor = resolvedTheme === "dark" ? BACKGROUND.COLOR_DARK : BACKGROUND.COLOR_LIGHT;

  // DAG state management (layout, expansion)
  const {
    nodes,
    edges,
    layoutDirection,
    setLayoutDirection,
    groupsWithLayout: dagGroups,
    rootNodeIds,
    handleSelectGroup,
    handleSelectTask,
    handleToggleExpand,
    nodeBounds,
    isLayouting,
  } = useDAGState({
    groups,
    initialDirection: "TB",
    onSelectGroup,
    onSelectTask,
  });

  // Find selected group from DAG groups
  const selectedGroup = useMemo(
    () => dagGroups.find((g) => g.name === selectedGroupName) ?? null,
    [dagGroups, selectedGroupName],
  );

  // ---------------------------------------------------------------------------
  // Viewport Re-centering Logic
  // ---------------------------------------------------------------------------

  const prevPanelCollapsedRef = useRef(isPanelCollapsed);
  const prevSidebarCollapsedRef = useRef(isSidebarCollapsed);

  // Trigger re-center when panel collapse state changes
  useIsomorphicLayoutEffect(() => {
    const prevCollapsed = prevPanelCollapsedRef.current;
    prevPanelCollapsedRef.current = isPanelCollapsed;

    const panelCollapsedChanged = prevCollapsed !== isPanelCollapsed;

    if (panelCollapsedChanged) {
      setReCenterTrigger((t) => t + 1);
    }
  }, [isPanelCollapsed]);

  // Sidebar changes
  useIsomorphicLayoutEffect(() => {
    const prevCollapsed = prevSidebarCollapsedRef.current;
    prevSidebarCollapsedRef.current = isSidebarCollapsed;

    if (prevCollapsed !== isSidebarCollapsed) {
      setReCenterTrigger((t) => t + 1);
    }
  }, [isSidebarCollapsed]);

  // Panel resize changes (panelPct)
  // Skip re-center during drag - will recalculate when drag ends
  const prevPanelPctRef = useRef(panelPct);
  useIsomorphicLayoutEffect(() => {
    // Don't trigger during drag - causes flickering viewport animations
    if (isDragging) {
      // Still update ref so we catch the delta on drag end
      prevPanelPctRef.current = panelPct;
      return;
    }

    const prevPct = prevPanelPctRef.current;
    prevPanelPctRef.current = panelPct;

    // Only trigger on meaningful changes (threshold of 0.5% to avoid noise)
    if (prevPct !== undefined && Math.abs(prevPct - panelPct) > 0.5) {
      setReCenterTrigger((t) => t + 1);
    }
  }, [panelPct, isDragging]);

  // Selection changes
  const prevSelectionKey = usePrevious(selectionKey);
  useIsomorphicLayoutEffect(() => {
    const selectionChanged =
      prevSelectionKey !== undefined && prevSelectionKey !== selectionKey && selectionKey !== null;

    if (selectionChanged) {
      setReCenterTrigger((t) => t + 1);
    }
  }, [selectionKey, prevSelectionKey]);

  // Compute target dimensions for viewport
  const getTargetDimensions = useCallback(() => {
    const sidebarWidth = isSidebarCollapsed ? SIDEBAR.COLLAPSED_PX : SIDEBAR.EXPANDED_PX;
    const windowWidth = typeof window !== "undefined" ? window.innerWidth : VIEWPORT.ESTIMATED_WIDTH;
    const mainAreaWidth = windowWidth - sidebarWidth;
    const panelWidth = isPanelCollapsed ? PANEL.COLLAPSED_WIDTH_PX : (mainAreaWidth * panelPct) / 100;

    return {
      width: Math.max(100, mainAreaWidth - panelWidth),
      height: containerHeight, // Use ResizeObserver value, not offsetHeight (avoids layout thrashing)
    };
  }, [isSidebarCollapsed, isPanelCollapsed, panelPct, containerHeight]);

  // Viewport boundary management
  const { translateExtent } = useViewportBoundaries({
    nodeBounds,
    containerRef: dagContainerRef,
    selectedNodeId: selectedGroup?.name ?? null,
    nodes,
    layoutDirection,
    rootNodeIds,
    initialSelectedNodeId: selectedGroupName,
    getTargetDimensions,
    reCenterTrigger,
    isLayouting,
    isDragging, // Wired from panel interaction hook
  });

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleToggleMinimap = useEventCallback(() => {
    setShowMinimap((prev) => !prev);
  });

  const handleLayoutChange = useEventCallback((direction: "TB" | "LR") => {
    setLayoutDirection(direction);
  });

  const handleMoveStart = useEventCallback(() => {
    onPanningChange(true);
  });

  const handleMoveEnd = useEventCallback(() => {
    onPanningChange(false);
  });

  // ---------------------------------------------------------------------------
  // Memoized Config
  // ---------------------------------------------------------------------------

  const proOptions = useMemo(() => ({ hideAttribution: true }), []);

  const minimapStyle = useMemo(() => {
    const isDark = resolvedTheme !== "light";
    return {
      width: MINIMAP.WIDTH,
      height: MINIMAP.HEIGHT,
      backgroundColor: isDark ? "oklch(0.24 0.018 250)" : "oklch(0.97 0.008 80)",
      borderColor: isDark ? "oklch(0.32 0.02 250)" : "oklch(0.88 0.01 80)",
    };
  }, [resolvedTheme]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      ref={dagContainerRef}
      className="relative h-full w-full contain-strict"
    >
      <main
        id="dag-canvas"
        className="h-full w-full"
        role="application"
        aria-label="Workflow DAG visualization"
      >
        <DAGProvider
          selectedNodeId={selectedGroup?.name ?? null}
          onSelectGroup={handleSelectGroup}
          onSelectTask={handleSelectTask}
          onToggleExpand={handleToggleExpand}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={true}
            edgesFocusable={false}
            nodesFocusable={true}
            selectNodesOnDrag={false}
            translateExtent={translateExtent}
            minZoom={nodeBounds.fitAllZoom}
            maxZoom={VIEWPORT.MAX_ZOOM}
            panOnScroll={true}
            zoomOnScroll={false}
            panOnScrollMode={PanOnScrollMode.Free}
            zoomOnPinch={true}
            preventScrolling={true}
            onlyRenderVisibleElements={true}
            proOptions={proOptions}
            onMoveStart={handleMoveStart}
            onMoveEnd={handleMoveEnd}
            data-panning={isPanning ? "true" : "false"}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={BACKGROUND.GAP}
              size={BACKGROUND.DOT_SIZE}
              color={backgroundDotColor}
            />
            <DAGControls
              layoutDirection={layoutDirection}
              onLayoutChange={handleLayoutChange}
              showMinimap={showMinimap}
              onToggleMinimap={handleToggleMinimap}
            />
            {showMinimap && (
              <MiniMap
                pannable
                zoomable
                position="top-left"
                style={minimapStyle}
                maskColor={resolvedTheme !== "light" ? "oklch(0.08 0.015 250 / 0.55)" : "oklch(0.45 0.02 250 / 0.15)"}
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
    </div>
  );
}

// Wrap with ReactFlowProvider
const WorkflowDAGContentWithProvider = memo(function WorkflowDAGContentWithProvider(props: WorkflowDAGContentProps) {
  return (
    <ReactFlowProvider>
      <WorkflowDAGContentImpl {...props} />
    </ReactFlowProvider>
  );
});

export const WorkflowDAGContent = WorkflowDAGContentWithProvider;
