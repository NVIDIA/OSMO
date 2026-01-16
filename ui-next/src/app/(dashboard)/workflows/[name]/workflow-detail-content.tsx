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
 * Workflow Detail Page
 *
 * Displays a single workflow with:
 * - DAG visualization of workflow groups and their dependencies
 * - Unified multi-layer inspector panel (workflow → group → task)
 * - URL-synced navigation for shareable deep links
 *
 * Architecture (Side-by-Side Model):
 * - Uses flexbox layout with DAG and Panel as siblings
 * - DAG canvas fills available space (flex-1)
 * - Panel has fixed percentage width
 * - Components are completely decoupled
 *
 * URL Navigation:
 * - /workflows/[name] → Workflow view
 * - /workflows/[name]?group=step-1 → Group view
 * - /workflows/[name]?group=step-1&task=my-task&retry=0 → Task view
 *
 * Keyboard Navigation:
 * - Escape → Collapse panel (when expanded)
 * - Enter → Expand panel (when focused on collapsed strip)
 * - Browser back/forward → Navigate through URL history
 */

"use client";

import { useState, useMemo, useRef, useCallback } from "react";
import { usePrevious, useIsomorphicLayoutEffect } from "@react-hookz/web";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";

// =============================================================================
// Dynamic Import for ReactFlow
// ReactFlow + ELK.js are heavy (~200KB+ gzipped). We dynamically import them
// to keep the initial bundle small. This is especially important for:
// - Mobile users on slow networks
// - Users who navigate directly to non-workflow pages
// - Faster initial page load across the app
// =============================================================================

// Dynamic import with loading state - ssr: false because ReactFlow requires window
const ReactFlowDynamic = dynamic(() => import("@xyflow/react").then((mod) => mod.ReactFlow), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-gray-50 dark:bg-zinc-950">
      <div className="text-center text-gray-500 dark:text-zinc-500">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600 dark:border-zinc-600 dark:border-t-zinc-300" />
        <p>Loading visualization...</p>
      </div>
    </div>
  ),
});

// These are re-exported from the dynamic import for the non-SSR context
import { ReactFlowProvider, Background, MiniMap, BackgroundVariant, PanOnScrollMode } from "@xyflow/react";

import "@xyflow/react/dist/style.css";

import { usePage, useSidebar, SIDEBAR } from "@/components/shell";
import { InlineErrorBoundary } from "@/components/error";
import { Skeleton } from "@/components/shadcn/skeleton";
import { useEventCallback } from "usehooks-ts";
import { PANEL } from "@/components/panel";
import { useTickController } from "@/hooks";

// Route-level components
import {
  nodeTypes,
  MiniMapNode,
  DAGErrorBoundary,
  DAGControls,
  DAGProvider,
  DetailsPanel,
  type DetailsPanelView,
} from "./components";

// DAG utilities
import { VIEWPORT, MINIMAP, BACKGROUND, useViewportBoundaries, preloadElkWorker } from "@/components/dag";

// Preload ELK worker on module load (before first render)
// This hides worker initialization latency from the user
if (typeof window !== "undefined") {
  preloadElkWorker();
}
import { getMiniMapNodeColor, getMiniMapStrokeColor } from "./lib/status";

// Route-level hooks
import { useWorkflowDetail } from "./hooks/use-workflow-detail";
import { useSidebarCollapsed } from "./hooks/use-sidebar-collapsed";
import { useDAGState } from "./hooks/use-dag-state";
import { useNavigationState } from "./hooks/use-navigation-state";

// Types
import type { GroupWithLayout, TaskQueryResponse } from "./lib/workflow-types";

// CSS for DAG (from route-level styles)
import "./styles/dag.css";

// =============================================================================
// Types
// =============================================================================

interface WorkflowDetailContentProps {
  /** Workflow name from URL params */
  name: string;
}

// =============================================================================
// Loading Skeletons
// =============================================================================

/**
 * Skeleton for the DAG canvas area (shown while workflow data loads).
 * Rendered INSIDE the container so container dimensions are available.
 */
function DAGCanvasSkeleton() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-gray-50 dark:bg-zinc-950">
      <div className="text-center text-gray-500 dark:text-zinc-500">
        <Skeleton className="mx-auto mb-4 h-32 w-32 rounded-lg" />
        <p>Loading workflow...</p>
      </div>
    </div>
  );
}

/**
 * Skeleton for the panel content (shown while workflow data loads).
 */
function PanelContentSkeleton() {
  return (
    <div className="p-4">
      <Skeleton className="mb-4 h-6 w-3/4" />
      <Skeleton className="mb-2 h-4 w-1/2" />
      <div className="my-4 h-px bg-gray-200 dark:bg-zinc-800" />
      <Skeleton className="mb-2 h-4 w-20" />
      <Skeleton className="mb-2 h-16 w-full" />
      <div className="my-4 h-px bg-gray-200 dark:bg-zinc-800" />
      <Skeleton className="mb-2 h-4 w-20" />
      <Skeleton className="mb-2 h-4 w-24" />
      <Skeleton className="h-4 w-16" />
    </div>
  );
}

// =============================================================================
// Inner Page Component (with ReactFlowProvider context)
// =============================================================================

function WorkflowDetailPageInner({ name }: { name: string }) {
  const [showMinimap, setShowMinimap] = useState(true);
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(false);
  const [panelPct, setPanelPct] = useState<number>(PANEL.DEFAULT_WIDTH_PCT);
  const [isPanelDragging, setIsPanelDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const { resolvedTheme } = useTheme();

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
  const {
    view: navView,
    selectedGroup,
    selectedTask,
    selectedGroupName,
    selectedTaskName,
    selectedTaskRetryId,
    navigateToGroup,
    navigateToTask,
    navigateToWorkflow,
    navigateBackToGroup,
  } = useNavigationState({ groups: groupsWithLayout });

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
      navigateToGroup(group);
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
      navigateToTask(task, group);
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
  });

  // Memoized objects for ReactFlow to prevent re-renders (per ReactFlow performance best practices)
  // See: https://reactflow.dev/learn/advanced-use/performance
  const proOptions = useMemo(() => ({ hideAttribution: true }), []);
  const minimapStyle = useMemo(
    () => ({
      width: MINIMAP.WIDTH,
      height: MINIMAP.HEIGHT,
    }),
    [],
  );

  // Handlers - stable callbacks for memoized children
  const handleToggleMinimap = useEventCallback(() => {
    setShowMinimap((prev) => !prev);
  });

  const handleToggleDetailsExpanded = useEventCallback(() => {
    setIsDetailsExpanded((prev) => !prev);
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
    navigateToWorkflow();
  });

  // Close panel handler (for panel close button)
  // This navigates back to workflow view and optionally collapses
  const handleClosePanel = useEventCallback(() => {
    navigateToWorkflow();
  });

  // NOTE: Enter key to expand panel is handled by PanelCollapsedStrip's keyboard handler.
  // This ensures Enter only expands the panel when the collapsed strip is focused,
  // not globally (which would interfere with other interactive elements like nodes).

  // Determine content state: loading, error, not found, or ready
  const isReady = !isLoading && !error && !isNotFound && workflow;

  // Panel content: skeleton during loading, error/not found states, or actual content
  const renderPanelContent = () => {
    if (isLoading) {
      return <PanelContentSkeleton />;
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
              >
                <ReactFlowDynamic
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
                      nodeStrokeWidth={MINIMAP.NODE_STROKE_WIDTH}
                      nodeComponent={MiniMapNode}
                      nodeColor={getMiniMapNodeColor}
                      nodeStrokeColor={getMiniMapStrokeColor}
                      aria-label="Workflow minimap"
                    />
                  )}
                </ReactFlowDynamic>
              </DAGProvider>
            </main>
          ) : (
            <DAGCanvasSkeleton />
          )}
        </div>

        {/* Details Panel - fixed width, sibling to DAG */}
        <DetailsPanel
          view={currentPanelView}
          workflow={workflow ?? undefined}
          group={selectedGroup}
          allGroups={dagGroups}
          task={selectedTask}
          onClose={handleClosePanel}
          onBackToGroup={navigateBackToGroup}
          onBackToWorkflow={handleBackToWorkflow}
          onSelectTask={navigateToTask}
          onSelectGroup={navigateToGroup}
          panelPct={panelPct}
          onPanelResize={setPanelPct}
          isDetailsExpanded={isDetailsExpanded}
          onToggleDetailsExpanded={handleToggleDetailsExpanded}
          isCollapsed={isPanelCollapsed}
          onToggleCollapsed={togglePanelCollapsed}
          onCancelWorkflow={handleCancel}
          fallbackContent={panelOverrideContent}
          containerRef={containerRef}
          onDraggingChange={setIsPanelDragging}
        />
      </div>
    </DAGErrorBoundary>
  );
}

// =============================================================================
// Exported Content Component
// =============================================================================

/**
 * Workflow Detail Content (Client Component)
 *
 * The interactive content of the workflow detail page.
 * Receives the workflow name and renders the DAG visualization and panels.
 *
 * This is separated from the page.tsx to allow server-side prefetching
 * while keeping all interactive functionality client-side.
 */
export function WorkflowDetailContent({ name }: WorkflowDetailContentProps) {
  usePage({
    title: name,
    breadcrumbs: [{ label: "Workflows", href: "/workflows" }],
  });

  return (
    <InlineErrorBoundary
      title="Unable to display workflow"
      onReset={() => window.location.reload()}
    >
      <div className="h-full">
        <ReactFlowProvider>
          <WorkflowDetailPageInner name={name} />
        </ReactFlowProvider>
      </div>
    </InlineErrorBoundary>
  );
}
