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
 *
 * Architecture:
 * - Uses useWorkflowDetail hook for data fetching
 * - Reuses DAG components from reactflow-dag
 * - Multi-layer panel navigation with breadcrumbs
 *
 * Panel Navigation Flow:
 * - Default: WorkflowDetails (base layer)
 * - Click GROUP node → GroupDetails layer
 * - Click task in GroupDetails → TaskDetails layer
 * - Click back/breadcrumb → Navigate up layers
 * - Click X → Collapse to edge strip
 */

"use client";

import { use, useState, useCallback } from "react";
import Link from "next/link";
import { ReactFlowProvider, ReactFlow, Background, MiniMap, BackgroundVariant, PanOnScrollMode } from "@xyflow/react";
import { useTheme } from "next-themes";

import "@xyflow/react/dist/style.css";

import { usePage } from "@/components/shell";
import { InlineErrorBoundary } from "@/components/error";
import { Skeleton } from "@/components/skeleton";

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
import { VIEWPORT, MINIMAP, BACKGROUND, useResizablePanel, useViewportBoundaries } from "@/components/dag";
import { getMiniMapNodeColor, getMiniMapStrokeColor } from "./lib/status";

// Route-level hooks
import { useWorkflowDetail } from "./hooks/use-workflow-detail";
import { useSidebarCollapsed } from "./hooks/use-sidebar-collapsed";
import { useDAGState } from "./hooks/use-dag-state";

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

  // Panel collapsed state (persisted)
  const { collapsed: isPanelCollapsed, toggle: togglePanelCollapsed } = useSidebarCollapsed();

  // Background color based on theme
  const backgroundDotColor = resolvedTheme === "dark" ? BACKGROUND.COLOR_DARK : BACKGROUND.COLOR_LIGHT;

  // Fetch workflow data
  const { workflow, groupsWithLayout, isLoading, error, refetch, isNotFound } = useWorkflowDetail({ name });

  // DAG state management
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
    panelView: dagPanelView,
    selectedGroup,
    selectedTask,
    handleClosePanel,
    handleBackToGroup,
    nodeBounds,
  } = useDAGState({
    groups: groupsWithLayout,
    initialDirection: "TB",
  });

  // Resizable panel
  const { panelPct, setPanelPct, isDragging, bindResizeHandle, containerRef } = useResizablePanel();

  // Determine current panel view (workflow is default, then group/task based on selection)
  const currentPanelView: DetailsPanelView =
    dagPanelView === "task" && selectedTask ? "task" : dagPanelView === "group" && selectedGroup ? "group" : "workflow";

  // Panel is always "open" (shows workflow when nothing selected), but can be collapsed
  const isPanelOpen = !isPanelCollapsed;

  // Viewport boundary management
  const { handleMove, handleMoveEnd } = useViewportBoundaries({
    nodeBounds,
    panelPct: isPanelOpen ? panelPct : 3, // Use minimal width when collapsed
    isPanelOpen,
    containerRef,
    selectedGroupName: selectedGroup?.name ?? null,
    panelView: currentPanelView,
    nodes,
  });

  // Handlers
  const handleToggleMinimap = useCallback(() => {
    setShowMinimap((prev) => !prev);
  }, []);

  const handleToggleDetailsExpanded = useCallback(() => {
    setIsDetailsExpanded((prev) => !prev);
  }, []);

  const handleLayoutChange = useCallback(
    (direction: "TB" | "LR") => {
      setLayoutDirection(direction);
    },
    [setLayoutDirection],
  );

  const handleCancel = useCallback(() => {
    // TODO: Implement workflow cancellation
    // This will need a confirmation dialog and API call
    console.log("Cancel workflow:", name);
  }, [name]);

  // Navigate back from group to workflow (deselect group)
  const handleBackToWorkflow = useCallback(() => {
    handleClosePanel();
  }, [handleClosePanel]);

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

  return (
    <DAGErrorBoundary>
      {/* Main Content: DAG + Unified Panel */}
      <div className="flex h-full overflow-hidden bg-gray-50 dark:bg-zinc-950">
        {/* DAG Canvas Area */}
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
                defaultViewport={{ x: 100, y: 50, zoom: VIEWPORT.DEFAULT_ZOOM }}
                minZoom={nodeBounds.fitAllZoom}
                maxZoom={VIEWPORT.MAX_ZOOM}
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

          {/* Unified Multi-Layer Inspector Panel (right) */}
          <DetailsPanel
            view={currentPanelView}
            workflow={workflow}
            group={selectedGroup}
            allGroups={dagGroups}
            task={selectedTask}
            onClose={handleClosePanel}
            onBackToGroup={handleBackToGroup}
            onBackToWorkflow={handleBackToWorkflow}
            onSelectTask={handleSelectTask}
            onSelectGroup={handleSelectGroup}
            panelPct={panelPct}
            onPanelResize={setPanelPct}
            isDragging={isDragging}
            bindResizeHandle={bindResizeHandle}
            isDetailsExpanded={isDetailsExpanded}
            onToggleDetailsExpanded={handleToggleDetailsExpanded}
            isCollapsed={isPanelCollapsed}
            onToggleCollapsed={togglePanelCollapsed}
            onCancelWorkflow={handleCancel}
          />
        </div>
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
      {/* Negate shell padding for edge-to-edge DAG layout */}
      <div className="-m-6 h-[calc(100%+48px)]">
        <ReactFlowProvider>
          <WorkflowDetailPageInner name={decodedName} />
        </ReactFlowProvider>
      </div>
    </InlineErrorBoundary>
  );
}
