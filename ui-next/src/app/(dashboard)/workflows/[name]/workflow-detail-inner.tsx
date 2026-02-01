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
 * Lightweight orchestrator that composes layout, content, panel, and shell.
 * Handles shared logic (data fetching, navigation, panel state) while delegating
 * rendering to WorkflowDetailLayout (shell) and WorkflowDAGContent/WorkflowTableContent
 * (visualization-specific logic).
 *
 * ⚠️ IMPORTANT: Do NOT import this file directly in workflow-detail-content.tsx!
 * It must be imported via dynamic() to maintain code splitting.
 */

"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import { Link } from "@/components/link";
import { useEventCallback } from "usehooks-ts";
import { useTickController, useViewTransition, useAnnouncer } from "@/hooks";
import { useSharedPreferences, useDagVisible } from "@/stores";

// Route-level components
import {
  DAGErrorBoundary,
  ShellPortalProvider,
  ShellProvider,
  WorkflowDetailLayout,
  WorkflowDAGContent,
  DetailsPanel,
  type DetailsPanelView,
} from "./components";

// Route-level hooks
import { useWorkflowDetail } from "./hooks/use-workflow-detail";
import { useSidebarCollapsed } from "./hooks/use-sidebar-collapsed";
import { useNavigationState } from "./hooks/use-navigation-state";
import { usePanelProps } from "./hooks/use-panel-props";
import { usePanelInteraction } from "./hooks/use-panel-interaction";

// Types
import type { GroupWithLayout, TaskQueryResponse } from "./lib/workflow-types";
import type { InitialView } from "./workflow-detail-content";
import { WorkflowStatus } from "@/lib/api/generated";

// Shell container is heavy (xterm.js), load dynamically
const ShellContainer = dynamic(
  () => import("./components/shell/ShellContainer").then((m) => ({ default: m.ShellContainer })),
  {
    ssr: false,
  },
);

// =============================================================================
// Types
// =============================================================================

export interface WorkflowDetailInnerProps {
  /** Workflow name from URL params */
  name: string;
  /** Server-parsed URL state for instant panel rendering */
  initialView: InitialView;
}

// =============================================================================
// Component
// =============================================================================

export function WorkflowDetailInner({ name, initialView }: WorkflowDetailInnerProps) {
  // Persisted panel preferences from Zustand store
  const persistedPanelPct = useSharedPreferences((s) => s.panelWidthPct);
  const setPanelPct = useSharedPreferences((s) => s.setPanelWidthPct);
  const isDetailsExpanded = useSharedPreferences((s) => s.detailsExpanded);
  const toggleDetailsExpanded = useSharedPreferences((s) => s.toggleDetailsExpanded);
  const [activeShellTaskName, setActiveShellTaskName] = useState<string | null>(null);

  // DAG visibility state
  const dagVisible: boolean = useDagVisible();

  // Fetch workflow data
  const { workflow, groupsWithLayout, isLoading, error, refetch, isNotFound } = useWorkflowDetail({ name });

  // Panning state for tick controller (DAG-specific, but managed here for tick control)
  const [isPanning, setIsPanning] = useState(false);

  // Container ref for layout and resize calculations
  const containerRef = useRef<HTMLDivElement>(null);

  // URL-synced navigation state (nuqs)
  const {
    view: navView,
    selectedGroup,
    selectedTask,
    selectedGroupName,
    selectedTaskName,
    selectedTaskRetryId,
    selectedTab,
    selectedWorkflowTab,
    selectedGroupTab,
    navigateToGroup,
    navigateToTask,
    navigateToWorkflow,
    navigateBackToGroup,
    setSelectedTab,
    setSelectedWorkflowTab,
    setSelectedGroupTab,
  } = useNavigationState({ groups: groupsWithLayout, initialView });

  // Compute selection key for panel collapse behavior
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
    dagVisible,
  });

  // Panel interaction (snap zones, drag coordination)
  const panelInteraction = usePanelInteraction({
    persistedPct: persistedPanelPct,
    onPersist: setPanelPct,
    dagVisible,
    onHideDAG: () => useSharedPreferences.getState().setDagVisible(false),
    isPanelCollapsed,
    onExpandPanel: expandPanel,
  });

  // Synchronized tick for live durations - only tick when workflow is active
  // PERFORMANCE: Pause ticking during pan/zoom AND panel drag to prevent React re-renders mid-frame
  const workflowStatus = workflow?.status;
  const isWorkflowActive =
    workflowStatus === WorkflowStatus.PENDING ||
    workflowStatus === WorkflowStatus.RUNNING ||
    workflowStatus === WorkflowStatus.WAITING;
  const shouldTick = isWorkflowActive && !isPanning && !panelInteraction.isDragging;
  useTickController(shouldTick);

  const { startTransition } = useViewTransition();

  // Navigation handlers with transitions
  const handleNavigateToGroup = useEventCallback((group: GroupWithLayout) => {
    startTransition(() => navigateToGroup(group));
  });

  const handleNavigateToTask = useEventCallback((task: TaskQueryResponse, group: GroupWithLayout) => {
    startTransition(() => navigateToTask(task, group));
  });

  const handleBackToWorkflow = useEventCallback(() => {
    startTransition(() => navigateToWorkflow());
  });

  const handleNavigateBackToGroup = useEventCallback(() => {
    startTransition(() => navigateBackToGroup());
  });

  const handleShellTabChange = useEventCallback((taskName: string | null) => {
    setActiveShellTaskName(taskName);
  });

  // Screen reader announcements for snap zone transitions
  const announce = useAnnouncer();
  useEffect(() => {
    if (panelInteraction.phase.type === "snapping") {
      if (panelInteraction.phase.snapZone === "full") {
        announce("Hiding DAG view, panel expanding to full width", "polite");
      } else {
        announce("Panel snapping to 80%", "polite");
      }
    }
  }, [panelInteraction.phase, announce]);

  // Determine current panel view from URL navigation state
  const currentPanelView: DetailsPanelView =
    navView === "task" && selectedTask ? "task" : navView === "group" && selectedGroup ? "group" : "workflow";

  // Content state: loading, error, not found, or ready
  const isReady = !isLoading && !error && !isNotFound && workflow;

  // Panel override content for loading/error states
  // Memoized to prevent unnecessary child re-renders when loading/error state hasn't changed
  const panelOverrideContent = useMemo(() => {
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
    return null;
  }, [isLoading, isNotFound, error, name, refetch]);

  // Generate common props for DetailsPanel and ShellContainer
  // Use groupsWithLayout as allGroups to ensure panel has layout info
  const { panelProps, shellContainerProps } = usePanelProps({
    workflow: workflow!,
    groups: groupsWithLayout,
    selectedGroup,
    selectedTask,
    currentPanelView,
    selectedGroupName,
    selectedTaskName,
    onSelectGroup: handleNavigateToGroup,
    onSelectTask: handleNavigateToTask,
    onBackToGroup: handleNavigateBackToGroup,
    onBackToWorkflow: handleBackToWorkflow,
    panelPct: panelInteraction.displayPct, // Use optimistic width during drag
    onPanelResize: panelInteraction.dragHandlers.onDrag, // Route through snap detection
    isDetailsExpanded,
    onToggleDetailsExpanded: toggleDetailsExpanded,
    isPanelCollapsed,
    togglePanelCollapsed,
    expandPanel,
    panelOverrideContent,
    onCancelWorkflow: undefined,
    selectedTab,
    setSelectedTab,
    selectedWorkflowTab,
    setSelectedWorkflowTab,
    selectedGroupTab,
    setSelectedGroupTab,
    onShellTabChange: handleShellTabChange,
    activeShellTaskName,
    containerRef,
    onDragStart: panelInteraction.dragHandlers.onDragStart, // Snap zone integration
    onDragEnd: panelInteraction.dragHandlers.onDragEnd, // Snap zone integration
  });

  // Wrapped navigation handlers for re-click behavior
  const handleNavigateToGroupWithExpand = useEventCallback((group: GroupWithLayout) => {
    const isAlreadySelected = selectedGroupName === group.name && !selectedTaskName;
    if (isAlreadySelected && isPanelCollapsed) {
      expandPanel();
    } else {
      handleNavigateToGroup(group);
    }
  });

  const handleNavigateToTaskWithExpand = useEventCallback((task: TaskQueryResponse, group: GroupWithLayout) => {
    const isAlreadySelected = selectedGroupName === group.name && selectedTaskName === task.name;
    if (isAlreadySelected && isPanelCollapsed) {
      expandPanel();
    } else {
      handleNavigateToTask(task, group);
    }
  });

  // ---------------------------------------------------------------------------
  // Memoized Content Elements (Performance Optimization)
  // ---------------------------------------------------------------------------
  // Prevent unnecessary re-renders during panel drag/resize
  // ---------------------------------------------------------------------------

  // Memoize DAG content to prevent re-renders during panel drag
  const dagContentElement = useMemo(() => {
    if (!dagVisible || !workflow) return undefined;
    return (
      <WorkflowDAGContent
        workflow={workflow}
        groups={groupsWithLayout}
        selectedGroupName={selectedGroupName}
        selectedTaskName={selectedTaskName}
        selectedTaskRetryId={selectedTaskRetryId}
        onSelectGroup={handleNavigateToGroupWithExpand}
        onSelectTask={handleNavigateToTaskWithExpand}
        isPanning={isPanning}
        onPanningChange={setIsPanning}
        selectionKey={selectionKey}
        containerRef={containerRef}
        panelPct={panelInteraction.displayPct} // Use optimistic width
        isPanelCollapsed={isPanelCollapsed}
      />
    );
  }, [
    dagVisible,
    workflow,
    groupsWithLayout,
    selectedGroupName,
    selectedTaskName,
    selectedTaskRetryId,
    handleNavigateToGroupWithExpand,
    handleNavigateToTaskWithExpand,
    isPanning,
    selectionKey,
    containerRef,
    panelInteraction.displayPct, // Track optimistic width
    isPanelCollapsed,
  ]);

  // Memoize panel content
  const panelElement = useMemo(
    () => (
      <>
        <DetailsPanel
          {...panelProps}
          fullWidth={!dagVisible}
        />
        {shellContainerProps && <ShellContainer {...shellContainerProps} />}
      </>
    ),
    [panelProps, dagVisible, shellContainerProps],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  // New architecture: WorkflowDetailLayout composes the shell (flex container)
  // with visualization content (DAG or Table) and panel/shell slots.
  //
  // Stability: All callbacks are stable via useEventCallback, props are memoized.
  // ---------------------------------------------------------------------------

  return (
    <DAGErrorBoundary>
      <ShellProvider workflowName={name}>
        <ShellPortalProvider>
          {isReady ? (
            <WorkflowDetailLayout
              dagVisible={dagVisible}
              containerRef={containerRef}
              isDragging={panelInteraction.isDragging}
              isTransitioning={panelInteraction.isTransitioning}
              snapZone={panelInteraction.snapZone}
              displayPct={panelInteraction.displayPct}
              dagContent={dagContentElement}
              panel={panelElement}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gray-50 dark:bg-zinc-950">
              <div className="text-center text-gray-500 dark:text-zinc-500">
                <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600 dark:border-zinc-600 dark:border-t-zinc-300" />
                <p>Loading workflow...</p>
              </div>
            </div>
          )}
        </ShellPortalProvider>
      </ShellProvider>
    </DAGErrorBoundary>
  );
}

// No need for ReactFlowProvider wrapper here - WorkflowDAGContent handles it internally
export { WorkflowDetailInner as WorkflowDetailInnerWithProvider };
