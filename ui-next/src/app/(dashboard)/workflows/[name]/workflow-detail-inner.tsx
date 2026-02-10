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

// IMPORTANT: Must be imported via dynamic() in workflow-detail-content.tsx for code splitting.

"use client";

import { useState, useMemo, useRef, useEffect, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Link } from "@/components/link";
import { useEventCallback } from "usehooks-ts";
import { useAnnouncer } from "@/hooks/use-announcer";
import { useMounted } from "@/hooks/use-mounted";
import { useTickController } from "@/hooks/use-tick";
import { useViewTransition } from "@/hooks/use-view-transition";
import { useWorkflowDetailPanel, usePanelWidthPct, useDetailsExpanded } from "@/stores/workflow-detail-panel-store";

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

import { DAGErrorBoundary } from "@/components/dag/components/DAGErrorBoundary";
import { ShellPortalProvider } from "@/app/(dashboard)/workflows/[name]/components/shell/ShellPortalContext";
import { ShellProvider } from "@/app/(dashboard)/workflows/[name]/components/shell/ShellContext";
import { WorkflowDetailLayout } from "@/app/(dashboard)/workflows/[name]/components/WorkflowDetailLayout";
import { WorkflowDAGContent } from "@/app/(dashboard)/workflows/[name]/components/WorkflowDAGContent";
import { DetailsPanel } from "@/app/(dashboard)/workflows/[name]/components/panel/views/DetailsPanel";
import type { DetailsPanelView } from "@/app/(dashboard)/workflows/[name]/lib/panel-types";
import { CancelWorkflowDialog } from "@/app/(dashboard)/workflows/[name]/components/panel/workflow/CancelWorkflowDialog";

const ResubmitPanel = dynamic(
  () => import("./components/resubmit/ResubmitPanel").then((m) => ({ default: m.ResubmitPanel })),
  { ssr: false },
);

import { useWorkflowDetail } from "@/app/(dashboard)/workflows/[name]/hooks/use-workflow-detail";
import { useNavigationState } from "@/app/(dashboard)/workflows/[name]/hooks/use-navigation-state";
import { usePanelProps } from "@/app/(dashboard)/workflows/[name]/hooks/use-panel-props";
import { useWorkflowDetailAutoRefresh } from "@/app/(dashboard)/workflows/[name]/hooks/use-workflow-detail-auto-refresh";

import type { GroupWithLayout, TaskQueryResponse } from "@/app/(dashboard)/workflows/[name]/lib/workflow-types";
import type { InitialView } from "@/app/(dashboard)/workflows/[name]/workflow-detail-content";
import { WorkflowStatus } from "@/lib/api/generated";

const ShellContainer = dynamic(
  () =>
    import("./components/shell/ShellContainer").then((m) => ({
      default: m.ShellContainer,
    })),
  {
    ssr: false,
  },
);

export interface WorkflowDetailInnerProps {
  name: string;
  initialView: InitialView;
}

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

export function WorkflowDetailInner({ name, initialView }: WorkflowDetailInnerProps) {
  const setPanelPct = useWorkflowDetailPanel((s) => s.setPanelWidthPct);

  // SSR-safe defaults; real localStorage values restored post-hydration via restorePersistedState()
  return (
    <PanelResizeProvider
      initialPersistedPct={50}
      initialCollapsed={false}
      onPersist={setPanelPct}
    >
      <WorkflowDetailContent
        name={name}
        initialView={initialView}
      />
    </PanelResizeProvider>
  );
}

function WorkflowDetailContent({ name, initialView }: WorkflowDetailInnerProps) {
  const { phase, startDrag, updateDrag, endDrag, toggleCollapsed, expand, restorePersistedState } = usePanelResize();
  const displayPct = usePanelWidth();
  const isDragging = useIsDragging();
  const snapZone = useSnapZone();
  const displayDagVisible = useDisplayDagVisible();
  const isPanelCollapsed = useIsPanelCollapsed();
  const persistedPct = usePersistedPanelWidth();
  const mounted = useMounted();
  const persistedPanelPct = usePanelWidthPct() as number;

  // Restore persisted width from localStorage after hydration
  const hasRestoredRef = useRef(false);
  useEffect(() => {
    if (mounted && !hasRestoredRef.current) {
      hasRestoredRef.current = true;
      restorePersistedState(persistedPanelPct);
    }
  }, [mounted, persistedPanelPct, restorePersistedState]);

  const isDetailsExpanded = useDetailsExpanded();
  const toggleDetailsExpanded = useWorkflowDetailPanel((s) => s.toggleDetailsExpanded);
  const [activeShellTaskName, setActiveShellTaskName] = useState<string | null>(null);

  const autoRefresh = useWorkflowDetailAutoRefresh();

  const { workflow, groupsWithLayout, isLoading, error, refetch, isNotFound, isTerminal } = useWorkflowDetail({
    name,
    refetchInterval: autoRefresh.effectiveInterval,
  });

  // Terminal workflows force interval to 0 (display only - polling already stopped)
  const displayInterval = isTerminal ? 0 : autoRefresh.interval;

  const [isPanning, setIsPanning] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Auto-expand panel on selection change. Must run AFTER restore to avoid race condition.
  const prevSelectionKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hasRestoredRef.current) return;

    const selectionChanged = selectionKey !== prevSelectionKeyRef.current;

    if (selectionChanged && hasSelection && mounted) {
      expand(true);
      prevSelectionKeyRef.current = selectionKey;
    } else if (mounted && (hasSelection || selectionKey === null)) {
      // Track resolved/cleared selections (skip during data loading to ensure expand triggers)
      prevSelectionKeyRef.current = selectionKey;
    }
  }, [selectionKey, hasSelection, expand, mounted]);

  // Pause tick during pan/zoom and panel drag for performance
  const workflowStatus = workflow?.status;
  const isWorkflowActive =
    workflowStatus === WorkflowStatus.PENDING ||
    workflowStatus === WorkflowStatus.RUNNING ||
    workflowStatus === WorkflowStatus.WAITING;
  const shouldTick = isWorkflowActive && !isPanning && !isDragging;
  useTickController(shouldTick);

  const { startTransition } = useViewTransition();

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

  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [resubmitPanelOpen, setResubmitPanelOpen] = useState(false);

  const handleCancelWorkflow = useEventCallback(() => {
    setCancelDialogOpen(true);
  });

  const handleResubmitWorkflow = useEventCallback(() => {
    setResubmitPanelOpen(true);
  });

  const handleCloseResubmitPanel = useEventCallback(() => {
    setResubmitPanelOpen(false);
  });

  const announce = useAnnouncer();
  useEffect(() => {
    if (phase !== "SNAPPING") return;

    if (snapZone === "full") {
      announce("Hiding DAG view, panel expanding to full width", "polite");
    } else if (snapZone === "strip") {
      announce("Panel collapsing to activity strip", "polite");
    }
  }, [phase, snapZone, announce]);

  let currentPanelView: DetailsPanelView = "workflow";
  if (navView === "task" && selectedTask) {
    currentPanelView = "task";
  } else if (navView === "group" && selectedGroup) {
    currentPanelView = "group";
  }

  const isReady = !isLoading && !error && !isNotFound && workflow;

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

  const handleTogglePanelCollapsed = useEventCallback(toggleCollapsed);
  const handleExpandPanel = useEventCallback(expand);

  const autoRefreshProps = useMemo(
    () => ({
      interval: displayInterval,
      setInterval: autoRefresh.setInterval,
      onRefresh: refetch,
      isRefreshing: isLoading,
    }),
    [displayInterval, autoRefresh.setInterval, refetch, isLoading],
  );

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
    fillContainer: true,
    isTerminal,
    autoRefresh: autoRefreshProps,
  });

  // Re-clicking already-selected node expands a collapsed panel
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

  // Stable during drag to prevent DAG re-renders
  const stablePanelPct = isDragging ? persistedPct : displayPct;

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

  const panelElement = useMemo(
    () => (
      <>
        <DetailsPanel {...panelProps} />
        {shellContainerProps && <ShellContainer {...shellContainerProps} />}
      </>
    ),
    [panelProps, shellContainerProps],
  );

  return (
    <DAGErrorBoundary>
      <ShellProvider workflowName={name}>
        <ShellPortalProvider>
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
