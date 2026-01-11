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
 * Architecture:
 * - Uses useWorkflowDetail hook for data fetching
 * - Uses useNavigationState for URL-synced navigation (nuqs)
 * - Reuses DAG components from reactflow-dag
 * - Multi-layer panel navigation with breadcrumbs
 *
 * URL Navigation:
 * - /workflows/[name] → Workflow view
 * - /workflows/[name]?group=step-1 → Group view
 * - /workflows/[name]?group=step-1&task=my-task&retry=0 → Task view
 *
 * Keyboard Navigation:
 * - Escape → Collapse panel (when expanded)
 * - Enter → Expand panel (when collapsed)
 * - Browser back/forward → Navigate through URL history
 */

"use client";

import { use, useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { ReactFlowProvider, ReactFlow, Background, MiniMap, BackgroundVariant, PanOnScrollMode } from "@xyflow/react";
import { useTheme } from "next-themes";

import "@xyflow/react/dist/style.css";

import { usePage } from "@/components/shell";
import { InlineErrorBoundary } from "@/components/error";
import { Skeleton } from "@/components/shadcn/skeleton";
import { useStableCallback } from "@/hooks";

// Route-level components
import {
  nodeTypes,
  MiniMapNode,
  FitViewOnLayoutChange,
  DAGErrorBoundary,
  DAGControls,
  DAGProvider,
  DetailsPanel,
  type DetailsPanelView,
} from "./components";

// DAG utilities
import { VIEWPORT, MINIMAP, BACKGROUND, useViewportBoundaries, preloadElkWorker } from "@/components/dag";
import { useResizablePanel, PANEL } from "@/components/panel";

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

// CSS for DAG (from route-level styles)
import "./styles/dag.css";

// =============================================================================
// Types
// =============================================================================

interface WorkflowDetailPageProps {
  params: Promise<{ name: string }>;
}

// =============================================================================
// Loading Skeleton
// =============================================================================

function WorkflowDetailSkeleton() {
  return (
    <div className="relative flex h-full bg-gray-50 dark:bg-zinc-950">
      {/* DAG skeleton */}
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center text-gray-500 dark:text-zinc-500">
          <Skeleton className="mx-auto mb-4 h-32 w-32 rounded-lg" />
          <p>Loading workflow...</p>
        </div>
      </div>
      {/* Right panel skeleton */}
      <div className="absolute inset-y-0 right-0 w-[33%] border-l border-gray-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
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
    </div>
  );
}

// =============================================================================
// Not Found State
// =============================================================================

function WorkflowNotFound({ name }: { name: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <div className="text-center">
        <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-zinc-100">Workflow Not Found</h2>
        <p className="mb-4 text-gray-500 dark:text-zinc-400">
          The workflow <code className="rounded bg-gray-100 px-2 py-1 font-mono dark:bg-zinc-800">{name}</code> does not
          exist.
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

// =============================================================================
// Inner Page Component (with ReactFlowProvider context)
// =============================================================================

function WorkflowDetailPageInner({ name }: { name: string }) {
  const [showMinimap, setShowMinimap] = useState(true);
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(false);
  const { resolvedTheme } = useTheme();

  // Background color based on theme
  const backgroundDotColor = resolvedTheme === "dark" ? BACKGROUND.COLOR_DARK : BACKGROUND.COLOR_LIGHT;

  // Fetch workflow data
  const { workflow, groupsWithLayout, isLoading, error, refetch, isNotFound } = useWorkflowDetail({ name });

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
  const { collapsed: isPanelCollapsed, toggle: togglePanelCollapsed } = useSidebarCollapsed({
    hasSelection,
    selectionKey,
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
  } = useDAGState({
    groups: groupsWithLayout,
    initialDirection: "TB",
    // Wire DAG selection to URL navigation
    onSelectGroup: navigateToGroup,
    onSelectTask: navigateToTask,
  });

  // Resizable panel state (ResizablePanel handles resize internally, we just need state + containerRef for viewport calc)
  const { panelPct, setPanelPct, containerRef } = useResizablePanel();

  // Determine current panel view from URL navigation state
  const currentPanelView: DetailsPanelView =
    navView === "task" && selectedTask ? "task" : navView === "group" && selectedGroup ? "group" : "workflow";

  // Panel is always "open" (shows workflow when nothing selected), but can be collapsed
  const isPanelOpen = !isPanelCollapsed;

  // Compute visible width for DAG (decoupled from panel internals)
  // This callback is called by useViewportBoundaries to determine the visible area
  const getVisibleWidth = useStableCallback((containerWidth: number) => {
    const panelWidthPx = isPanelOpen ? (panelPct / 100) * containerWidth : PANEL.COLLAPSED_WIDTH_PX;
    return containerWidth - panelWidthPx;
  });

  // Viewport boundary management - controlled mode prevents jitter at boundaries
  // DAG doesn't know about panel internals, just uses getVisibleWidth callback
  const { viewport, onViewportChange } = useViewportBoundaries({
    nodeBounds,
    containerRef,
    getVisibleWidth,
    boundsDeps: [isPanelOpen, panelPct], // Re-clamp when these change
    selectedGroupName: selectedGroup?.name ?? null,
    panelView: currentPanelView,
    nodes,
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
  const handleToggleMinimap = useStableCallback(() => {
    setShowMinimap((prev) => !prev);
  });

  const handleToggleDetailsExpanded = useStableCallback(() => {
    setIsDetailsExpanded((prev) => !prev);
  });

  const handleLayoutChange = useStableCallback((direction: "TB" | "LR") => {
    setLayoutDirection(direction);
  });

  const handleCancel = useStableCallback(() => {
    // TODO: Implement workflow cancellation
    // This will need a confirmation dialog and API call
    console.log("Cancel workflow:", name);
  });

  // Navigate back from group to workflow (URL navigation)
  const handleBackToWorkflow = useStableCallback(() => {
    navigateToWorkflow();
  });

  // Close panel handler (for panel close button)
  // This navigates back to workflow view and optionally collapses
  const handleClosePanel = useStableCallback(() => {
    navigateToWorkflow();
  });

  // Global keyboard shortcuts for panel collapse/expand
  // Escape → collapse panel, Enter → expand panel (when focused on DAG area)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if focus is in an input, textarea, or contenteditable
      const target = e.target as HTMLElement;
      const isInteractiveElement =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable ||
        target.closest("[data-radix-popper-content-wrapper]");

      if (isInteractiveElement) return;

      // Enter key expands the panel when collapsed
      if (e.key === "Enter" && isPanelCollapsed) {
        e.preventDefault();
        togglePanelCollapsed();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isPanelCollapsed, togglePanelCollapsed]);

  // Loading state
  if (isLoading) {
    return <WorkflowDetailSkeleton />;
  }

  // Not found state
  if (isNotFound || !workflow) {
    return <WorkflowNotFound name={name} />;
  }

  // Error state
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
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

  // DAG canvas as main content (passed to ResizablePanel via DetailsPanel)
  const dagCanvas = (
    <main
      id="dag-canvas"
      className="h-full w-full"
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
          // Controlled viewport - boundaries enforced BEFORE render (no jitter)
          viewport={viewport}
          onViewportChange={onViewportChange}
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
        </ReactFlow>
      </DAGProvider>
    </main>
  );

  return (
    <DAGErrorBoundary>
      {/* Main Content: DAG + Unified Panel (ResizablePanel handles layout) */}
      <div
        ref={containerRef}
        className="flex h-full overflow-hidden bg-gray-50 dark:bg-zinc-950"
      >
        <DetailsPanel
          view={currentPanelView}
          workflow={workflow}
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
          mainContent={dagCanvas}
        />
      </div>
    </DAGErrorBoundary>
  );
}

// =============================================================================
// Main Page Component
// =============================================================================

export default function WorkflowDetailPage({ params }: WorkflowDetailPageProps) {
  const { name } = use(params);
  const decodedName = decodeURIComponent(name);

  usePage({
    title: decodedName,
    breadcrumbs: [{ label: "Workflows", href: "/workflows" }],
  });

  return (
    <InlineErrorBoundary
      title="Unable to display workflow"
      onReset={() => window.location.reload()}
    >
      <div className="h-full">
        <ReactFlowProvider>
          <WorkflowDetailPageInner name={decodedName} />
        </ReactFlowProvider>
      </div>
    </InlineErrorBoundary>
  );
}
