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
 * Workflow Detail Inner Component - Refactored with PanelResizeStateMachine
 *
 * Architecture:
 * - PanelResizeProvider wraps component tree with state machine
 * - State machine is single source of truth for resize state
 * - React controls ALL DOM updates (no direct DOM manipulation)
 * - Callbacks coordinate with column sizing (no events)
 *
 * ⚠️ IMPORTANT: Do NOT import this file directly in workflow-detail-content.tsx!
 * It must be imported via dynamic() to maintain code splitting.
 */

"use client";

import { useState, useMemo, useRef, useEffect, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Link } from "@/components/link";
import { useEventCallback } from "usehooks-ts";
import { useAnnouncer } from "@/hooks/use-announcer";
import { useTickController } from "@/hooks/use-tick";
import { useViewTransition } from "@/hooks/use-view-transition";
import { useSharedPreferences, usePanelWidthPct, useDetailsPanelCollapsed } from "@/stores/shared-preferences-store";

// New state machine provider and hooks
import {
  PanelResizeProvider,
  usePanelResize,
  useDisplayDagVisible,
  useIsDragging,
  useSnapZone,
  useIsPanelCollapsed,
  usePersistedPanelWidth,
  usePanelWidth,
} from "@/app/(dashboard)/workflows/[name]/lib/panel-resize-context";
import { ACTIVITY_STRIP_WIDTH_PX } from "@/app/(dashboard)/workflows/[name]/lib/panel-constants";

// Route-level components
import { DAGErrorBoundary } from "@/components/dag/components/DAGErrorBoundary";
import { ShellPortalProvider } from "@/app/(dashboard)/workflows/[name]/components/shell/ShellPortalContext";
import { ShellProvider } from "@/app/(dashboard)/workflows/[name]/components/shell/ShellContext";
import { WorkflowDetailLayout } from "@/app/(dashboard)/workflows/[name]/components/WorkflowDetailLayout";
import { WorkflowDAGContent } from "@/app/(dashboard)/workflows/[name]/components/WorkflowDAGContent";
import { DetailsPanel } from "@/app/(dashboard)/workflows/[name]/components/panel/views/DetailsPanel";
import type { DetailsPanelView } from "@/app/(dashboard)/workflows/[name]/lib/panel-types";
import { CancelWorkflowDialog } from "@/app/(dashboard)/workflows/[name]/components/panel/workflow/CancelWorkflowDialog";

// Lazy-load ResubmitPanel (only loads when user clicks resubmit button)
// Saves ~20 KB from initial bundle (panel + form logic)
const ResubmitPanel = dynamic(
  () => import("./components/resubmit/ResubmitPanel").then((m) => ({ default: m.ResubmitPanel })),
  { ssr: false },
);

// Route-level hooks
import { useWorkflowDetail } from "@/app/(dashboard)/workflows/[name]/hooks/use-workflow-detail";
import { useSidebarCollapsed } from "@/app/(dashboard)/workflows/[name]/hooks/use-sidebar-collapsed";
import { useNavigationState } from "@/app/(dashboard)/workflows/[name]/hooks/use-navigation-state";
import { usePanelProps } from "@/app/(dashboard)/workflows/[name]/hooks/use-panel-props";

// Types
import type { GroupWithLayout, TaskQueryResponse } from "@/app/(dashboard)/workflows/[name]/lib/workflow-types";
import type { InitialView } from "@/app/(dashboard)/workflows/[name]/workflow-detail-content";
import { WorkflowStatus } from "@/lib/api/generated";

// Shell container is heavy (xterm.js), load dynamically
const ShellContainer = dynamic(
  () =>
    import("./components/shell/ShellContainer").then((m) => ({
      default: m.ShellContainer,
    })),
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
// Shared UI
// =============================================================================

function LoadingSpinner(): ReactNode {
  return (
    <div className="flex h-full w-full items-center justify-center bg-gray-50 dark:bg-zinc-950">
      <div className="text-center text-gray-500 dark:text-zinc-500">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600 dark:border-zinc-600 dark:border-t-zinc-300" />
        <p>Loading workflow...</p>
      </div>
    </div>
  );
}

// =============================================================================
// Provider Component (Outer Layer)
// =============================================================================

export function WorkflowDetailInner({ name, initialView }: WorkflowDetailInnerProps) {
  // Use hydration-safe selectors for initial state (SSR/PPR safe)
  const persistedPanelPct = usePanelWidthPct() as number;
  const isPanelCollapsed = useDetailsPanelCollapsed() as boolean;

  // Actions (always safe - no hydration concern)
  const setPanelPct = useSharedPreferences((s) => s.setPanelWidthPct);
  const setIsPanelCollapsed = useSharedPreferences((s) => s.setDetailsPanelCollapsed);

  // CRITICAL: Stabilize initial values to prevent provider remount after hydration.
  // These values should be captured ONCE and never change - the provider's internal
  // state will be updated via callbacks (setPanelPct, setIsPanelCollapsed).
  // Without this, hydration causes values to change (default -> localStorage),
  // triggering a provider remount that destroys the state machine.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableInitialPct = useMemo(() => persistedPanelPct, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableInitialCollapsed = useMemo(() => isPanelCollapsed, []);

  return (
    <PanelResizeProvider
      initialPersistedPct={stableInitialPct}
      initialCollapsed={stableInitialCollapsed}
      onPersist={setPanelPct}
      onPersistCollapsed={setIsPanelCollapsed}
    >
      <WorkflowDetailContent
        name={name}
        initialView={initialView}
      />
    </PanelResizeProvider>
  );
}

// =============================================================================
// Content Component (Inner Layer - Has State Machine Access)
// =============================================================================

function WorkflowDetailContent({ name, initialView }: WorkflowDetailInnerProps) {
  // Get state machine actions and state via hooks
  const { phase, startDrag, updateDrag, endDrag, toggleCollapsed, expand, setCollapsed, updateStripSnapTarget } =
    usePanelResize();

  // Subscribe to specific state slices
  const displayPct = usePanelWidth();
  const isDragging = useIsDragging();
  const snapZone = useSnapZone();
  const displayDagVisible = useDisplayDagVisible();
  const isPanelCollapsed = useIsPanelCollapsed();
  const persistedPct = usePersistedPanelWidth();

  // Other state
  const isDetailsExpanded = useSharedPreferences((s) => s.detailsExpanded);
  const toggleDetailsExpanded = useSharedPreferences((s) => s.toggleDetailsExpanded);
  const [activeShellTaskName, setActiveShellTaskName] = useState<string | null>(null);

  // Fetch workflow data
  const { workflow, groupsWithLayout, isLoading, error, refetch, isNotFound } = useWorkflowDetail({ name });

  // Panning state for tick controller (DAG-specific, but managed here for tick control)
  const [isPanning, setIsPanning] = useState(false);

  // Container ref for layout
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
  const { collapsed: sidebarCollapsed } = useSidebarCollapsed({
    hasSelection,
    selectionKey,
    dagVisible: displayDagVisible,
  });

  // Sync sidebar collapsed state to state machine (for navigation-aware behavior)
  // IMPORTANT: Only sync when sidebarCollapsed CHANGES, not just when phase becomes IDLE.
  // This prevents the sync effect from overriding intentional expansions triggered by
  // clicking quick actions (which call expand() directly on the state machine).
  //
  // NOTE: isPanelCollapsed is now DERIVED from widthPct in the state machine,
  // so the comparison is consistent - both use the same source of truth.
  const prevSidebarCollapsedRef = useRef(sidebarCollapsed);
  useEffect(() => {
    const prevValue = prevSidebarCollapsedRef.current;
    const sidebarCollapsedChanged = sidebarCollapsed !== prevValue;
    prevSidebarCollapsedRef.current = sidebarCollapsed;

    // Only sync to state machine when sidebar collapsed state actually changes
    // (due to navigation or user preference change), not just when phase becomes IDLE
    if (sidebarCollapsedChanged && phase === "IDLE") {
      // isPanelCollapsed is derived from the state machine's widthPct
      if (sidebarCollapsed !== isPanelCollapsed) {
        setCollapsed(sidebarCollapsed);
      }
    }
  }, [sidebarCollapsed, phase, setCollapsed, isPanelCollapsed]);

  // Update strip snap target based on actual container width (deterministic calculation)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateTarget = () => {
      const containerWidth = container.clientWidth;
      if (containerWidth > 0) {
        updateStripSnapTarget(ACTIVITY_STRIP_WIDTH_PX, containerWidth);
      }
    };

    // Initial measurement
    updateTarget();

    // Update on window resize
    const resizeObserver = new ResizeObserver(updateTarget);
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [updateStripSnapTarget]);

  // Synchronized tick for live durations - only tick when workflow is active
  // PERFORMANCE: Pause ticking during pan/zoom AND panel drag
  const workflowStatus = workflow?.status;
  const isWorkflowActive =
    workflowStatus === WorkflowStatus.PENDING ||
    workflowStatus === WorkflowStatus.RUNNING ||
    workflowStatus === WorkflowStatus.WAITING;
  const shouldTick = isWorkflowActive && !isPanning && !isDragging;
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

  // Cancel workflow dialog state
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  // Resubmit workflow panel state
  const [resubmitPanelOpen, setResubmitPanelOpen] = useState(false);

  // Workflow action handlers
  const handleCancelWorkflow = useEventCallback(() => {
    setCancelDialogOpen(true);
  });

  const handleResubmitWorkflow = useEventCallback(() => {
    setResubmitPanelOpen(true);
  });

  const handleCloseResubmitPanel = useEventCallback(() => {
    setResubmitPanelOpen(false);
  });

  // Screen reader announcements for snap zone transitions
  const announce = useAnnouncer();
  useEffect(() => {
    // Only announce during SNAPPING phase
    if (phase !== "SNAPPING") return;

    if (snapZone === "full") {
      announce("Hiding DAG view, panel expanding to full width", "polite");
    } else if (snapZone === "strip") {
      announce("Panel collapsing to activity strip", "polite");
    }
  }, [phase, snapZone, announce]);

  // Determine current panel view from URL navigation state
  const currentPanelView: DetailsPanelView =
    navView === "task" && selectedTask ? "task" : navView === "group" && selectedGroup ? "group" : "workflow";

  // Content state: loading, error, not found, or ready
  const isReady = !isLoading && !error && !isNotFound && workflow;

  // Panel override content for loading/error states
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
              Back to workflows
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

  // State machine actions are already memoized, use directly
  // These wrappers using useEventCallback maintain stable references
  const handleTogglePanelCollapsed = useEventCallback(toggleCollapsed);
  const handleExpandPanel = useEventCallback(expand);

  // Generate common props for DetailsPanel and ShellContainer
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
    panelPct: displayPct,
    onPanelResize: updateDrag,
    isDetailsExpanded,
    onToggleDetailsExpanded: toggleDetailsExpanded,
    isPanelCollapsed,
    togglePanelCollapsed: handleTogglePanelCollapsed,
    expandPanel: handleExpandPanel,
    panelOverrideContent,
    onCancelWorkflow: handleCancelWorkflow,
    onResubmitWorkflow: handleResubmitWorkflow,
    selectedTab,
    setSelectedTab,
    selectedWorkflowTab,
    setSelectedWorkflowTab,
    selectedGroupTab,
    setSelectedGroupTab,
    onShellTabChange: handleShellTabChange,
    activeShellTaskName,
    containerRef,
    onDragStart: startDrag,
    onDragEnd: endDrag,
    fillContainer: true, // Panel is inside CSS Grid - let grid control sizing
  });

  // Wrapped navigation handlers for re-click behavior
  const handleNavigateToGroupWithExpand = useEventCallback((group: GroupWithLayout) => {
    const isAlreadySelected = selectedGroupName === group.name && !selectedTaskName;
    if (isAlreadySelected && isPanelCollapsed) {
      handleExpandPanel();
    } else {
      handleNavigateToGroup(group);
    }
  });

  const handleNavigateToTaskWithExpand = useEventCallback((task: TaskQueryResponse, group: GroupWithLayout) => {
    const isAlreadySelected = selectedGroupName === group.name && selectedTaskName === task.name;
    if (isAlreadySelected && isPanelCollapsed) {
      handleExpandPanel();
    } else {
      handleNavigateToTask(task, group);
    }
  });

  // ---------------------------------------------------------------------------
  // Memoized Content Elements (Performance Optimization)
  // ---------------------------------------------------------------------------

  // Use persisted percentage for DAG memoization (stable during drag)
  const stablePanelPct = isDragging ? persistedPct : displayPct;

  // Memoize DAG content to prevent re-renders during panel drag
  const dagContentElement = useMemo(() => {
    if (!displayDagVisible || !workflow) return undefined;
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
        panelPct={stablePanelPct}
        isPanelCollapsed={isPanelCollapsed}
        isDragging={isDragging}
      />
    );
  }, [
    displayDagVisible,
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
    stablePanelPct,
    isPanelCollapsed,
    isDragging,
  ]);

  // Memoize panel content
  const panelElement = useMemo(
    () => (
      <>
        <DetailsPanel {...panelProps} />
        {shellContainerProps && <ShellContainer {...shellContainerProps} />}
      </>
    ),
    [panelProps, shellContainerProps],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <DAGErrorBoundary>
      <ShellProvider workflowName={name}>
        <ShellPortalProvider>
          {/* Resubmit workflow panel wraps main content when workflow is loaded */}
          {workflow ? (
            <ResubmitPanel
              workflow={workflow}
              open={resubmitPanelOpen}
              onClose={handleCloseResubmitPanel}
            >
              {isReady ? (
                <WorkflowDetailLayout
                  containerRef={containerRef}
                  dagContent={dagContentElement}
                  panel={panelElement}
                />
              ) : (
                <LoadingSpinner />
              )}
            </ResubmitPanel>
          ) : (
            <LoadingSpinner />
          )}

          {/* Cancel workflow dialog */}
          {workflow && (
            <CancelWorkflowDialog
              workflowName={workflow.name}
              open={cancelDialogOpen}
              onOpenChange={setCancelDialogOpen}
              onRefetch={refetch}
            />
          )}
        </ShellPortalProvider>
      </ShellProvider>
    </DAGErrorBoundary>
  );
}

export { WorkflowDetailInner as WorkflowDetailInnerWithProvider };
