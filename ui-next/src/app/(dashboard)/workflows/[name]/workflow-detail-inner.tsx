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
 * Workflow Detail Inner Component (Dynamically Loaded)
 *
 * This file contains all ReactFlow-dependent code and is dynamically imported
 * to keep @xyflow/react out of the initial bundle.
 *
 * ⚠️ IMPORTANT: Do NOT import this file directly in workflow-detail-content.tsx!
 * It must be imported via dynamic() to maintain code splitting.
 */

"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { usePrevious, useIsomorphicLayoutEffect } from "@react-hookz/web";
import dynamic from "next/dynamic";
import { Link } from "@/components/link";
import { useTheme } from "next-themes";

// ReactFlow imports (these will be in the dynamically loaded chunk)
// Safe to import enums here since this entire file is dynamically loaded
import { ReactFlowProvider, Background, MiniMap, PanOnScrollMode, BackgroundVariant } from "@xyflow/react";
import { ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useSidebar, SIDEBAR } from "@/components/chrome";
import { useEventCallback } from "usehooks-ts";
import { PANEL } from "@/components/panel";
import { useTickController, useViewTransition } from "@/hooks";
import { useSharedPreferences } from "@/stores";

// Route-level components (non-lazy)
import {
  nodeTypes,
  MiniMapNode,
  DAGErrorBoundary,
  DAGControls,
  DAGProvider,
  DetailsPanel,
  ShellPortalProvider,
  ShellProvider,
  type DetailsPanelView,
} from "./components";

// =============================================================================
// Dynamic Imports - Shell components use xterm.js (heavy dependency)
// =============================================================================

// ShellContainer contains xterm.js terminal instances with significant CSS.
// Only load when a shell tab is active or sessions exist.
// This saves ~80-120KB on initial load.
const ShellContainer = dynamic(
  () => import("./components/shell/ShellContainer").then((m) => ({ default: m.ShellContainer })),
  {
    ssr: false, // Terminal requires browser APIs
  },
);

// DAG utilities
import { VIEWPORT, MINIMAP, BACKGROUND, useViewportBoundaries } from "@/components/dag";

import { useMiniMapColors } from "./lib/status";

// Route-level hooks
import { useWorkflowDetail } from "./hooks/use-workflow-detail";
import { useSidebarCollapsed } from "./hooks/use-sidebar-collapsed";
import { useDAGState } from "./hooks/use-dag-state";
import { useNavigationState } from "./hooks/use-navigation-state";

// Types
import type { GroupWithLayout, TaskQueryResponse } from "./lib/workflow-types";
import type { InitialView } from "./workflow-detail-content";

// CSS for DAG (from route-level styles)
import "./styles/dag.css";

// =============================================================================
// Types
// =============================================================================

export interface WorkflowDetailInnerProps {
  /** Workflow name from URL params */
  name: string;
  /** Server-parsed URL state for instant panel rendering */
  initialView: InitialView;
}

import { useSearchParams } from "next/navigation";
import { dagDebug } from "@/components/dag/lib/dag-debug";

// =============================================================================
// Component
// =============================================================================

export function WorkflowDetailInner({ name, initialView }: WorkflowDetailInnerProps) {
  const searchParams = useSearchParams();
  const isDebugEnabled = searchParams.get("debug") === "true";

  useEffect(() => {
    if (isDebugEnabled) {
      dagDebug.enable();
    } else {
      dagDebug.disable();
    }
  }, [isDebugEnabled]);

  const [showMinimap, setShowMinimap] = useState(true);

  // Persisted panel preferences from Zustand store
  const panelPct = useSharedPreferences((s) => s.panelWidthPct);
  const setPanelPct = useSharedPreferences((s) => s.setPanelWidthPct);
  const isDetailsExpanded = useSharedPreferences((s) => s.detailsExpanded);
  const toggleDetailsExpanded = useSharedPreferences((s) => s.toggleDetailsExpanded);
  const [isPanelDragging, setIsPanelDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [activeShellTaskName, setActiveShellTaskName] = useState<string | null>(null);
  const { resolvedTheme } = useTheme();

  // Theme-aware minimap color functions
  const { getMiniMapNodeColor, getMiniMapStrokeColor } = useMiniMapColors();

  // Sidebar state for viewport re-centering
  const { state: sidebarState } = useSidebar();
  const isSidebarCollapsed = sidebarState === "collapsed";

  // Container ref for the main layout (used by panel for resize calculations)
  const containerRef = useRef<HTMLDivElement>(null);
  // Separate ref for the DAG canvas container (used by viewport boundaries)
  const dagContainerRef = useRef<HTMLDivElement>(null);

  // Background color based on theme
  const backgroundDotColor = resolvedTheme === "dark" ? BACKGROUND.COLOR_DARK : BACKGROUND.COLOR_LIGHT;

  // Fetch workflow data
  const { workflow, groupsWithLayout, isLoading, error, refetch, isNotFound } = useWorkflowDetail({ name });

  // Synchronized tick for live durations - only tick when workflow is active
  // Completed/failed workflows have static durations, no need to tick
  // PERFORMANCE: Pause ticking during pan/zoom to prevent React re-renders mid-frame
  // This eliminates the occasional frame drop when tick fires during drag
  const workflowStatus = workflow?.status;
  const isWorkflowActive = workflowStatus === "PENDING" || workflowStatus === "RUNNING" || workflowStatus === "WAITING";
  const shouldTick = isWorkflowActive && !isPanning;
  useTickController(shouldTick);

  // URL-synced navigation state (nuqs)
  // initialView provides instant state before nuqs hydration
  const {
    view: navView,
    selectedGroup,
    selectedTask,
    selectedGroupName,
    selectedTaskName,
    selectedTaskRetryId,
    selectedTab,
    selectedWorkflowTab,
    navigateToGroup,
    navigateToTask,
    navigateToWorkflow,
    navigateBackToGroup,
    setSelectedTab,
    setSelectedWorkflowTab,
  } = useNavigationState({ groups: groupsWithLayout, initialView });

  // Compute selection key for panel collapse behavior
  // This changes when user navigates to a different group/task, triggering auto-expand
  const hasSelection = navView !== "workflow";
  const selectionKey = useMemo(() => {
    if (selectedTaskName && selectedGroupName) {
      return `task:${selectedGroupName}:${selectedTaskName}:${selectedTaskRetryId ?? 0}`;
    }
    if (selectedGroupName) {
      return `group:${selectedGroupName}`;
    }
    return null;
  }, [selectedGroupName, selectedTaskName, selectedTaskRetryId]);

  // Panel collapsed state (reconciles user preference with navigation intent)
  const {
    collapsed: isPanelCollapsed,
    toggle: togglePanelCollapsed,
    expand: expandPanel,
  } = useSidebarCollapsed({
    hasSelection,
    selectionKey,
  });

  // Re-center trigger state (moved here so wrapped handlers can access it)
  const [reCenterTrigger, setReCenterTrigger] = useState(0);

  const { startTransition } = useViewTransition();

  // Wrapped navigation handlers that handle re-clicking on already selected nodes
  // When clicking on an already-selected node:
  // 1. Expand the panel if it's collapsed
  // 2. Trigger re-center to ensure the node is visible
  const handleNavigateToGroup = useEventCallback((group: GroupWithLayout) => {
    const isAlreadySelected = selectedGroupName === group.name && !selectedTaskName;
    if (isAlreadySelected) {
      // Re-clicking on already selected node: expand panel and re-center
      if (isPanelCollapsed) {
        expandPanel();
      }
      // Trigger re-center even if panel is already expanded (to center if node moved out of view)
      setReCenterTrigger((t) => t + 1);
    } else {
      // New selection: navigate normally (useSidebarCollapsed will auto-expand)
      startTransition(() => navigateToGroup(group));
    }
  });

  const handleNavigateToTask = useEventCallback((task: TaskQueryResponse, group: GroupWithLayout) => {
    const isAlreadySelected =
      selectedGroupName === group.name && selectedTaskName === task.name && selectedTaskRetryId === task.retry_id;
    if (isAlreadySelected) {
      // Re-clicking on already selected node: expand panel and re-center
      if (isPanelCollapsed) {
        expandPanel();
      }
      // Trigger re-center even if panel is already expanded
      setReCenterTrigger((t) => t + 1);
    } else {
      // New selection: navigate normally (useSidebarCollapsed will auto-expand)
      startTransition(() => navigateToTask(task, group));
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
    groups: groupsWithLayout,
    initialDirection: "TB",
    // Wire DAG selection to wrapped navigation handlers
    onSelectGroup: handleNavigateToGroup,
    onSelectTask: handleNavigateToTask,
  });

  // Determine current panel view from URL navigation state
  const currentPanelView: DetailsPanelView =
    navView === "task" && selectedTask ? "task" : navView === "group" && selectedGroup ? "group" : "workflow";

  // Panel is always "open" (shows workflow when nothing selected), but can be collapsed
  // Note: isPanelCollapsed is used for keyboard shortcuts and panel state

  // ---------------------------------------------------------------------------
  // Viewport Re-centering (decoupled from hook - consumer controls when/where)
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Re-center triggers for layout changes
  // ---------------------------------------------------------------------------
  // ARCHITECTURE: Single source of truth via targetDims
  // - translateExtent uses targetDims (calculated from state, updates immediately)
  // - Panel/sidebar CSS transitions animate the visual panel size
  // - Viewport animation runs IN SYNC with CSS transition (same 200ms duration)
  // - Both start together, both end together = seamless unified animation

  const prevPanelCollapsedRef = useRef(isPanelCollapsed);
  const prevPanelDraggingRef = useRef(isPanelDragging);
  const prevSidebarCollapsedRef = useRef(isSidebarCollapsed);

  // Trigger re-center when panel state changes
  // All triggers run IMMEDIATELY - the hook uses PANEL_TRANSITION duration (200ms)
  // to match CSS transitions, creating synchronized animations
  useIsomorphicLayoutEffect(() => {
    const prevCollapsed = prevPanelCollapsedRef.current;
    const prevDragging = prevPanelDraggingRef.current;

    // Update refs for next render
    prevPanelCollapsedRef.current = isPanelCollapsed;
    prevPanelDraggingRef.current = isPanelDragging;

    const panelCollapsedChanged = prevCollapsed !== isPanelCollapsed;
    const panelDragEnded = prevDragging === true && isPanelDragging === false;

    // Both collapse/expand and drag-end trigger immediately
    // The viewport animation (200ms) runs in sync with CSS transition (200ms)
    if (panelCollapsedChanged || panelDragEnded) {
      setReCenterTrigger((t) => t + 1);
    }
  }, [isPanelCollapsed, isPanelDragging]);

  // Sidebar changes: immediate trigger, animation syncs with CSS transition
  useIsomorphicLayoutEffect(() => {
    const prevCollapsed = prevSidebarCollapsedRef.current;
    prevSidebarCollapsedRef.current = isSidebarCollapsed;

    if (prevCollapsed !== isSidebarCollapsed) {
      setReCenterTrigger((t) => t + 1);
    }
  }, [isSidebarCollapsed]);

  // Selection changes trigger re-center (after panel state has settled)
  // This handles: clicking different node, navigating via URL, etc.
  const prevSelectionKey = usePrevious(selectionKey);
  useIsomorphicLayoutEffect(() => {
    const selectionChanged =
      prevSelectionKey !== undefined && prevSelectionKey !== selectionKey && selectionKey !== null;

    if (selectionChanged) {
      setReCenterTrigger((t) => t + 1);
    }
  }, [selectionKey, prevSelectionKey]);

  // Compute expected final dimensions for smooth centering during CSS transitions.
  // Calculates from STATE rather than DOM, because during transitions the DOM is mid-animation.
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

  // Viewport boundary management via translateExtent (instant clamp)
  // React Flow enforces bounds natively via d3-zoom - no snap-back animation
  // Bounds based on "any node can be centered" principle
  const { translateExtent } = useViewportBoundaries({
    nodeBounds,
    containerRef: dagContainerRef,
    selectedNodeId: selectedGroup?.name ?? null,
    nodes,
    layoutDirection,
    rootNodeIds,
    initialSelectedNodeId: selectedGroupName,
    // Dependency injection: expected final dimensions for visual polish during CSS transitions
    getTargetDimensions,
    reCenterTrigger,
    // Layout completion signal for callback-based centering (no timeouts)
    isLayouting,
    isDragging: isPanelDragging,
  });

  // Memoized objects for ReactFlow to prevent re-renders (per ReactFlow performance best practices)
  // See: https://reactflow.dev/learn/advanced-use/performance
  const proOptions = useMemo(() => ({ hideAttribution: true }), []);

  // Theme-aware minimap styles - updates when theme changes
  const minimapStyle = useMemo(() => {
    const isDark = resolvedTheme !== "light";
    return {
      width: MINIMAP.WIDTH,
      height: MINIMAP.HEIGHT,
      backgroundColor: isDark ? "oklch(0.24 0.018 250)" : "oklch(0.97 0.008 80)",
      borderColor: isDark ? "oklch(0.32 0.02 250)" : "oklch(0.88 0.01 80)",
    };
  }, [resolvedTheme]);

  // Handlers - stable callbacks for memoized children
  const handleToggleMinimap = useEventCallback(() => {
    setShowMinimap((prev) => !prev);
  });

  // Stable callback wrapper for toggle (store action is already stable, but this is cleaner for props)
  const handleToggleDetailsExpanded = useEventCallback(() => {
    toggleDetailsExpanded();
  });

  const handleLayoutChange = useEventCallback((direction: "TB" | "LR") => {
    setLayoutDirection(direction);
  });

  const handleCancel = useEventCallback(() => {
    // TODO: Implement workflow cancellation
    // This will need a confirmation dialog and API call
    console.log("Cancel workflow:", name);
  });

  // Pan detection for performance optimization
  // Sets data-panning attribute on ReactFlow container to disable transitions during drag
  const handleMoveStart = useEventCallback(() => {
    setIsPanning(true);
  });

  const handleMoveEnd = useEventCallback(() => {
    setIsPanning(false);
  });

  // Navigate back from group to workflow (URL navigation)
  const handleBackToWorkflow = useEventCallback(() => {
    startTransition(() => navigateToWorkflow());
  });

  const handleNavigateBackToGroup = useEventCallback(() => {
    startTransition(() => navigateBackToGroup());
  });

  // Handle shell tab activation/deactivation from TaskDetails
  const handleShellTabChange = useCallback((taskName: string | null) => {
    setActiveShellTaskName(taskName);
  }, []);

  // NOTE: Enter key to expand panel is handled by PanelCollapsedStrip's keyboard handler.
  // This ensures Enter only expands the panel when the collapsed strip is focused,
  // not globally (which would interfere with other interactive elements like nodes).

  // Determine content state: loading, error, not found, or ready
  const isReady = !isLoading && !error && !isNotFound && workflow;

  // Panel content: skeleton during loading, error/not found states, or actual content
  const renderPanelContent = () => {
    if (isLoading) {
      return (
        <div className="p-4">
          <div
            data-slot="skeleton"
            className="bg-accent mb-4 h-6 w-3/4 animate-pulse rounded-md"
          />
          <div
            data-slot="skeleton"
            className="bg-accent mb-2 h-4 w-1/2 animate-pulse rounded-md"
          />
          <div className="my-4 h-px bg-gray-200 dark:bg-zinc-800" />
          <div
            data-slot="skeleton"
            className="bg-accent mb-2 h-4 w-20 animate-pulse rounded-md"
          />
          <div
            data-slot="skeleton"
            className="bg-accent mb-2 h-16 w-full animate-pulse rounded-md"
          />
          <div className="my-4 h-px bg-gray-200 dark:bg-zinc-800" />
          <div
            data-slot="skeleton"
            className="bg-accent mb-2 h-4 w-20 animate-pulse rounded-md"
          />
          <div
            data-slot="skeleton"
            className="bg-accent mb-2 h-4 w-24 animate-pulse rounded-md"
          />
          <div
            data-slot="skeleton"
            className="bg-accent h-4 w-16 animate-pulse rounded-md"
          />
        </div>
      );
    }
    if (isNotFound) {
      return (
        <div className="flex h-full items-center justify-center p-4">
          <div className="text-center">
            <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-zinc-100">Workflow Not Found</h2>
            <p className="mb-4 text-gray-500 dark:text-zinc-400">
              The workflow <code className="rounded bg-gray-100 px-2 py-1 font-mono dark:bg-zinc-800">{name}</code> does
              not exist.
            </p>
            <Link
              href="/workflows"
              className="text-blue-600 hover:underline dark:text-blue-400"
            >
              ← Back to workflows
            </Link>
          </div>
        </div>
      );
    }
    if (error) {
      return (
        <div className="flex h-full items-center justify-center p-4">
          <div className="text-center">
            <h2 className="mb-2 text-xl font-semibold text-red-600 dark:text-red-400">Error Loading Workflow</h2>
            <p className="mb-4 text-gray-500 dark:text-zinc-400">{error.message}</p>
            <button
              onClick={() => refetch()}
              className="text-blue-600 hover:underline dark:text-blue-400"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    // Normal content - rendered by DetailsPanel based on view
    return null;
  };

  // Custom panel content for loading/error states
  const panelOverrideContent = renderPanelContent();

  return (
    <DAGErrorBoundary>
      <ShellProvider workflowName={name}>
        <ShellPortalProvider>
          {/* Main Content: Side-by-Side Layout (DAG + Panel) */}
          <div
            ref={containerRef}
            className="flex h-full overflow-hidden bg-gray-50 dark:bg-zinc-950"
          >
            {/* DAG Canvas - fills remaining space */}
            <div
              ref={dagContainerRef}
              className="min-w-0 flex-1"
            >
              {isReady ? (
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
                    debug={isDebugEnabled}
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
                      // Viewport boundaries via translateExtent (instant clamp)
                      // React Flow enforces natively via d3-zoom - no snap-back
                      // Uses static bounds calculated at MIN_ZOOM for performance
                      translateExtent={translateExtent}
                      minZoom={nodeBounds.fitAllZoom}
                      maxZoom={VIEWPORT.MAX_ZOOM}
                      // Scroll behavior
                      panOnScroll={true}
                      zoomOnScroll={false}
                      panOnScrollMode={PanOnScrollMode.Free}
                      zoomOnPinch={true}
                      preventScrolling={true}
                      // Performance: Only render nodes/edges visible in viewport
                      // See: https://reactflow.dev/learn/advanced-use/performance
                      onlyRenderVisibleElements={true}
                      proOptions={proOptions}
                      // Pan detection for performance optimization (disables animations during drag)
                      onMoveStart={handleMoveStart}
                      onMoveEnd={handleMoveEnd}
                      // Data attribute for CSS performance optimization
                      data-panning={isPanning ? "true" : "false"}
                    >
                      <Background
                        variant={BackgroundVariant.Dots}
                        gap={BACKGROUND.GAP}
                        size={BACKGROUND.DOT_SIZE}
                        color={backgroundDotColor}
                      />
                      {/* Controls panel */}
                      <DAGControls
                        layoutDirection={layoutDirection}
                        onLayoutChange={handleLayoutChange}
                        showMinimap={showMinimap}
                        onToggleMinimap={handleToggleMinimap}
                      />
                      {/* Conditional minimap */}
                      {showMinimap && (
                        <MiniMap
                          pannable
                          zoomable
                          position="top-left"
                          style={minimapStyle}
                          maskColor={
                            resolvedTheme !== "light" ? "oklch(0.08 0.015 250 / 0.55)" : "oklch(0.45 0.02 250 / 0.15)"
                          }
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
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gray-50 dark:bg-zinc-950">
                  <div className="text-center text-gray-500 dark:text-zinc-500">
                    <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600 dark:border-zinc-600 dark:border-t-zinc-300" />
                    <p>Loading workflow...</p>
                  </div>
                </div>
              )}
            </div>

            {/* Details Panel - fixed width, sibling to DAG */}
            <DetailsPanel
              view={currentPanelView}
              workflow={workflow ?? undefined}
              group={selectedGroup}
              allGroups={dagGroups}
              task={selectedTask}
              onBackToGroup={handleNavigateBackToGroup}
              onBackToWorkflow={handleBackToWorkflow}
              onSelectTask={handleNavigateToTask}
              onSelectGroup={handleNavigateToGroup}
              panelPct={panelPct}
              onPanelResize={setPanelPct}
              isDetailsExpanded={isDetailsExpanded}
              onToggleDetailsExpanded={handleToggleDetailsExpanded}
              isCollapsed={isPanelCollapsed}
              onToggleCollapsed={togglePanelCollapsed}
              toggleHotkey="mod+i"
              onCancelWorkflow={handleCancel}
              fallbackContent={panelOverrideContent}
              containerRef={containerRef}
              onDraggingChange={setIsPanelDragging}
              onShellTabChange={handleShellTabChange}
              selectedTab={selectedTab}
              setSelectedTab={setSelectedTab}
              selectedWorkflowTab={selectedWorkflowTab}
              setSelectedWorkflowTab={setSelectedWorkflowTab}
            />

            {/* Shell Container - renders shells at workflow level, portals into TaskDetails */}
            {workflow?.name && (
              <ShellContainer
                workflowName={workflow.name}
                currentTaskId={selectedTask?.task_uuid}
                isShellTabActive={activeShellTaskName !== null}
              />
            )}
          </div>
        </ShellPortalProvider>
      </ShellProvider>
    </DAGErrorBoundary>
  );
}

// Wrap in ReactFlowProvider
export function WorkflowDetailInnerWithProvider({ name, initialView }: WorkflowDetailInnerProps) {
  return (
    <ReactFlowProvider>
      <WorkflowDetailInner
        name={name}
        initialView={initialView}
      />
    </ReactFlowProvider>
  );
}
