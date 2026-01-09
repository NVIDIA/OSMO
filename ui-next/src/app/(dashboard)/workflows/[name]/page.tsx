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
 * - Header with name, status, duration, and actions (cancel, logs, refresh)
 * - DAG visualization of workflow groups and their dependencies
 * - Details panel for group/task inspection
 *
 * Architecture:
 * - Uses useWorkflowDetail hook for data fetching
 * - Reuses DAG components from reactflow-dag
 * - Supports DAG/Table view toggle (future)
 *
 * Navigation Flow:
 * - Click GROUP node → Opens DetailsPanel with GroupDetails
 * - Click task in GroupDetails → Transitions to TaskDetails
 * - Click SINGLE-TASK node → Opens DetailsPanel with TaskDetails directly
 */

"use client";

import { use, useState, useCallback } from "react";
import { ReactFlowProvider, ReactFlow, Background, MiniMap, BackgroundVariant, PanOnScrollMode } from "@xyflow/react";
import { useTheme } from "next-themes";

import "@xyflow/react/dist/style.css";

import { usePage } from "@/components/shell";
import { InlineErrorBoundary } from "@/components/error";
import { Skeleton } from "@/components/skeleton";

// DAG components from reactflow-dag
import {
  nodeTypes,
  MiniMapNode,
  FitViewOnLayoutChange,
  DAGErrorBoundary,
  DAGControls,
  DetailsPanel,
} from "@/app/(dashboard)/dev/workflow-explorer/reactflow-dag/components";
import { useDAGState, useResizablePanel, useViewportBoundaries } from "@/app/(dashboard)/dev/workflow-explorer/reactflow-dag/hooks";
import { DAGProvider } from "@/app/(dashboard)/dev/workflow-explorer/reactflow-dag/context";
import { DEFAULT_ZOOM, MAX_ZOOM, MINIMAP, BACKGROUND } from "@/app/(dashboard)/dev/workflow-explorer/reactflow-dag/constants";
import { getMiniMapNodeColor, getMiniMapStrokeColor } from "@/app/(dashboard)/dev/workflow-explorer/reactflow-dag/utils";

// Local components
import { WorkflowHeader } from "./components/workflow-header";
import { useWorkflowDetail } from "./hooks/use-workflow-detail";

// CSS for DAG
import "@/app/(dashboard)/dev/workflow-explorer/reactflow-dag/dag.css";

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
    <div className="flex h-full flex-col">
      {/* Header skeleton */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-zinc-800">
        <div className="flex items-center gap-4">
          <Skeleton className="h-8 w-24" />
          <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-700" />
          <div>
            <Skeleton className="mb-2 h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>
      {/* DAG skeleton */}
      <div className="flex-1 bg-gray-50 dark:bg-zinc-950">
        <div className="flex h-full items-center justify-center">
          <div className="text-center text-gray-500 dark:text-zinc-500">
            <Skeleton className="mx-auto mb-4 h-32 w-32 rounded-lg" />
            <p>Loading workflow...</p>
          </div>
        </div>
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
        <a
          href="/workflows"
          className="text-blue-600 hover:underline dark:text-blue-400"
        >
          ← Back to workflows
        </a>
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

  // DAG state management
  const {
    nodes,
    edges,
    layoutDirection,
    setLayoutDirection,
    groupsWithLayout: dagGroups,
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
    groups: groupsWithLayout,
    initialDirection: "TB",
  });

  // Resizable panel
  const { panelPct, setPanelPct, isDragging, bindResizeHandle, containerRef } = useResizablePanel();

  // Panel open state
  const isPanelOpen = panelView !== "none" && selectedGroup !== null;

  // Viewport boundary management
  const { handleMove, handleMoveEnd } = useViewportBoundaries({
    nodeBounds,
    panelPct,
    isPanelOpen,
    containerRef,
    selectedGroupName: selectedGroup?.name ?? null,
    panelView,
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

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleCancel = useCallback(() => {
    // TODO: Implement workflow cancellation
    // This will need a confirmation dialog and API call
    console.log("Cancel workflow:", name);
  }, [name]);

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
            onClick={handleRefresh}
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
      <div className="flex h-full flex-col bg-gray-50 dark:bg-zinc-950">
        {/* Workflow Header */}
        <WorkflowHeader
          workflow={workflow}
          isRefreshing={isLoading}
          onRefresh={handleRefresh}
          onCancel={handleCancel}
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

          {/* Details Panel */}
          {isPanelOpen && selectedGroup && (
            <DetailsPanel
              view={panelView as "group" | "task"}
              group={selectedGroup}
              allGroups={dagGroups}
              task={selectedTask}
              onClose={handleClosePanel}
              onBackToGroup={handleBackToGroup}
              onSelectTask={handleSelectTask}
              onSelectGroup={handleSelectGroup}
              panelPct={panelPct}
              onPanelResize={setPanelPct}
              isDragging={isDragging}
              bindResizeHandle={bindResizeHandle}
              isDetailsExpanded={isDetailsExpanded}
              onToggleDetailsExpanded={handleToggleDetailsExpanded}
            />
          )}
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
      <ReactFlowProvider>
        <WorkflowDetailPageInner name={decodedName} />
      </ReactFlowProvider>
    </InlineErrorBoundary>
  );
}
