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
 * WorkflowDAGView Component
 *
 * DAG view for workflows with ReactFlow visualization and side-by-side panel.
 * Handles all DAG-specific state (layout, viewport, minimap, panning).
 */

"use client";

import { useState, useMemo, useRef, useCallback, memo } from "react";
import { usePrevious, useIsomorphicLayoutEffect } from "@react-hookz/web";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { ReactFlowProvider, ReactFlow, Background, MiniMap, PanOnScrollMode, BackgroundVariant } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useSidebar, SIDEBAR } from "@/components/chrome";
import { useEventCallback } from "usehooks-ts";
import { PANEL } from "@/components/panel";
import { nodeTypes, MiniMapNode, DAGControls, DAGProvider, DetailsPanel } from ".";
import { VIEWPORT, MINIMAP, BACKGROUND, useViewportBoundaries } from "@/components/dag";
import { useMiniMapColors } from "../lib/status";
import { useDAGState } from "../hooks/use-dag-state";
import type { GroupWithLayout, TaskQueryResponse, WorkflowQueryResponse } from "../lib/workflow-types";
import type { DetailsPanelView } from "../lib/panel-types";
import type { WorkflowTab, TaskTab } from "../hooks/use-navigation-state";

import "../styles/dag.css";

// Shell container is heavy (xterm.js), load dynamically
const ShellContainer = dynamic(() => import("./shell/ShellContainer").then((m) => ({ default: m.ShellContainer })), {
  ssr: false,
});

// =============================================================================
// Types
// =============================================================================

export interface WorkflowDAGViewProps {
  // Data
  workflow: WorkflowQueryResponse;
  groups: GroupWithLayout[];

  // Selection state
  selectedGroupName: string | null;
  selectedTaskName: string | null;
  selectedTaskRetryId: number | null;
  selectedGroup: GroupWithLayout | null;
  selectedTask: TaskQueryResponse | null;
  currentPanelView: DetailsPanelView;
  selectionKey: string | null;

  // Navigation handlers
  onSelectGroup: (group: GroupWithLayout) => void;
  onSelectTask: (task: TaskQueryResponse, group: GroupWithLayout) => void;
  onBackToGroup: () => void;
  onBackToWorkflow: () => void;

  // Panel state
  panelPct: number;
  onPanelResize: (pct: number) => void;
  isDetailsExpanded: boolean;
  onToggleDetailsExpanded: () => void;
  isPanelCollapsed: boolean;
  togglePanelCollapsed: () => void;
  expandPanel: () => void;
  panelOverrideContent?: React.ReactNode;
  onPanelDraggingChange?: (isDragging: boolean) => void;

  // Workflow actions
  onCancelWorkflow?: () => void;

  // Tab state
  selectedTab: TaskTab | null;
  setSelectedTab: (tab: TaskTab) => void;
  selectedWorkflowTab: WorkflowTab | null;
  setSelectedWorkflowTab: (tab: WorkflowTab) => void;
  onShellTabChange: (taskName: string | null) => void;
  activeShellTaskName: string | null;

  // Panning state for tick controller
  isPanning: boolean;
  onPanningChange: (isPanning: boolean) => void;
}

// =============================================================================
// Component Implementation
// =============================================================================

function WorkflowDAGViewImpl({
  workflow,
  groups,
  selectedGroupName,
  selectedTaskName,
  selectedTaskRetryId,
  selectedGroup,
  selectedTask,
  currentPanelView,
  selectionKey,
  onSelectGroup,
  onSelectTask,
  onBackToGroup,
  onBackToWorkflow,
  panelPct,
  onPanelResize,
  isDetailsExpanded,
  onToggleDetailsExpanded,
  isPanelCollapsed,
  togglePanelCollapsed,
  expandPanel,
  panelOverrideContent,
  onPanelDraggingChange,
  onCancelWorkflow,
  selectedTab,
  setSelectedTab,
  selectedWorkflowTab,
  setSelectedWorkflowTab,
  onShellTabChange,
  activeShellTaskName,
  isPanning,
  onPanningChange,
}: WorkflowDAGViewProps) {
  // DAG-specific state
  const [showMinimap, setShowMinimap] = useState(true);
  const [isPanelDragging, setIsPanelDragging] = useState(false);
  const [reCenterTrigger, setReCenterTrigger] = useState(0);
  const { resolvedTheme } = useTheme();

  // Theme-aware minimap color functions
  const { getMiniMapNodeColor, getMiniMapStrokeColor } = useMiniMapColors();

  // Sidebar state for viewport re-centering
  const { state: sidebarState } = useSidebar();
  const isSidebarCollapsed = sidebarState === "collapsed";

  // Container refs
  const containerRef = useRef<HTMLDivElement>(null);
  const dagContainerRef = useRef<HTMLDivElement>(null);

  // Background color based on theme
  const backgroundDotColor = resolvedTheme === "dark" ? BACKGROUND.COLOR_DARK : BACKGROUND.COLOR_LIGHT;

  // Wrapped navigation handlers for re-click behavior
  const handleNavigateToGroup = useEventCallback((group: GroupWithLayout) => {
    const isAlreadySelected = selectedGroupName === group.name && !selectedTaskName;
    if (isAlreadySelected) {
      if (isPanelCollapsed) {
        expandPanel();
      }
      setReCenterTrigger((t) => t + 1);
    } else {
      onSelectGroup(group);
    }
  });

  const handleNavigateToTask = useEventCallback((task: TaskQueryResponse, group: GroupWithLayout) => {
    const isAlreadySelected =
      selectedGroupName === group.name && selectedTaskName === task.name && selectedTaskRetryId === task.retry_id;
    if (isAlreadySelected) {
      if (isPanelCollapsed) {
        expandPanel();
      }
      setReCenterTrigger((t) => t + 1);
    } else {
      onSelectTask(task, group);
    }
  });

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
    onSelectGroup: handleNavigateToGroup,
    onSelectTask: handleNavigateToTask,
  });

  // ---------------------------------------------------------------------------
  // Viewport Re-centering Logic
  // ---------------------------------------------------------------------------

  const prevPanelCollapsedRef = useRef(isPanelCollapsed);
  const prevPanelDraggingRef = useRef(isPanelDragging);
  const prevSidebarCollapsedRef = useRef(isSidebarCollapsed);

  // Trigger re-center when panel state changes
  useIsomorphicLayoutEffect(() => {
    const prevCollapsed = prevPanelCollapsedRef.current;
    const prevDragging = prevPanelDraggingRef.current;

    prevPanelCollapsedRef.current = isPanelCollapsed;
    prevPanelDraggingRef.current = isPanelDragging;

    const panelCollapsedChanged = prevCollapsed !== isPanelCollapsed;
    const panelDragEnded = prevDragging === true && isPanelDragging === false;

    if (panelCollapsedChanged || panelDragEnded) {
      setReCenterTrigger((t) => t + 1);
    }
  }, [isPanelCollapsed, isPanelDragging]);

  // Sidebar changes
  useIsomorphicLayoutEffect(() => {
    const prevCollapsed = prevSidebarCollapsedRef.current;
    prevSidebarCollapsedRef.current = isSidebarCollapsed;

    if (prevCollapsed !== isSidebarCollapsed) {
      setReCenterTrigger((t) => t + 1);
    }
  }, [isSidebarCollapsed]);

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
      height: dagContainerRef.current?.offsetHeight ?? VIEWPORT.ESTIMATED_HEIGHT,
    };
  }, [isSidebarCollapsed, isPanelCollapsed, panelPct]);

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
    isDragging: isPanelDragging,
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

  const handlePanelDraggingChange = useEventCallback((dragging: boolean) => {
    setIsPanelDragging(dragging);
    onPanelDraggingChange?.(dragging);
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
      ref={containerRef}
      className="flex h-full overflow-hidden bg-gray-50 dark:bg-zinc-950"
    >
      {/* DAG Canvas */}
      <div
        ref={dagContainerRef}
        className="relative min-w-0 flex-1"
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

      {/* Side-by-side Panel */}
      <DetailsPanel
        view={currentPanelView}
        workflow={workflow}
        group={selectedGroup}
        allGroups={dagGroups}
        task={selectedTask}
        onBackToGroup={onBackToGroup}
        onBackToWorkflow={onBackToWorkflow}
        onSelectTask={onSelectTask}
        onSelectGroup={onSelectGroup}
        panelPct={panelPct}
        onPanelResize={onPanelResize}
        isDetailsExpanded={isDetailsExpanded}
        onToggleDetailsExpanded={onToggleDetailsExpanded}
        isCollapsed={isPanelCollapsed}
        onToggleCollapsed={togglePanelCollapsed}
        toggleHotkey="mod+i"
        onCancelWorkflow={onCancelWorkflow}
        fallbackContent={panelOverrideContent}
        containerRef={containerRef}
        onDraggingChange={handlePanelDraggingChange}
        onShellTabChange={onShellTabChange}
        selectedTab={selectedTab ?? undefined}
        setSelectedTab={(tab: TaskTab) => setSelectedTab(tab)}
        selectedWorkflowTab={selectedWorkflowTab ?? undefined}
        setSelectedWorkflowTab={(tab: WorkflowTab) => setSelectedWorkflowTab(tab)}
      />

      {/* Shell Container */}
      {workflow.name && (
        <ShellContainer
          workflowName={workflow.name}
          currentTaskId={selectedTask?.task_uuid}
          isShellTabActive={activeShellTaskName !== null}
        />
      )}
    </div>
  );
}

// Wrap with ReactFlowProvider
const WorkflowDAGViewWithProvider = memo(function WorkflowDAGViewWithProvider(props: WorkflowDAGViewProps) {
  return (
    <ReactFlowProvider>
      <WorkflowDAGViewImpl {...props} />
    </ReactFlowProvider>
  );
});

export const WorkflowDAGView = WorkflowDAGViewWithProvider;
