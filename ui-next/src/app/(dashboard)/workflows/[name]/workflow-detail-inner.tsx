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
 * Lightweight orchestrator that conditionally renders DAG or Table view.
 * Handles shared logic (data fetching, navigation, panel state) while delegating
 * view-specific concerns to WorkflowDAGView or WorkflowTableView.
 *
 * ⚠️ IMPORTANT: Do NOT import this file directly in workflow-detail-content.tsx!
 * It must be imported via dynamic() to maintain code splitting.
 */

"use client";

import { useState, useMemo } from "react";
import { Link } from "@/components/link";
import { useEventCallback } from "usehooks-ts";
import { useTickController, useViewTransition } from "@/hooks";
import { useSharedPreferences, useWorkflowDetailsView } from "@/stores";

// Route-level components
import {
  DAGErrorBoundary,
  ShellPortalProvider,
  ShellProvider,
  WorkflowDAGView,
  WorkflowTableView,
  type DetailsPanelView,
} from "./components";

// Route-level hooks
import { useWorkflowDetail } from "./hooks/use-workflow-detail";
import { useSidebarCollapsed } from "./hooks/use-sidebar-collapsed";
import { useNavigationState } from "./hooks/use-navigation-state";

// Types
import type { GroupWithLayout, TaskQueryResponse } from "./lib/workflow-types";
import type { InitialView } from "./workflow-detail-content";
import { WorkflowStatus } from "@/lib/api/generated";

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
  const panelPct = useSharedPreferences((s) => s.panelWidthPct);
  const setPanelPct = useSharedPreferences((s) => s.setPanelWidthPct);
  const isDetailsExpanded = useSharedPreferences((s) => s.detailsExpanded);
  const toggleDetailsExpanded = useSharedPreferences((s) => s.toggleDetailsExpanded);
  const [activeShellTaskName, setActiveShellTaskName] = useState<string | null>(null);

  // View preference (DAG vs Table)
  const workflowView = useWorkflowDetailsView();
  const isTableView = workflowView === "table";

  // Fetch workflow data
  const { workflow, groupsWithLayout, isLoading, error, refetch, isNotFound } = useWorkflowDetail({ name });

  // Panning state for tick controller (DAG-specific, but managed here for tick control)
  const [isPanning, setIsPanning] = useState(false);

  // Synchronized tick for live durations - only tick when workflow is active
  // PERFORMANCE: Pause ticking during pan/zoom to prevent React re-renders mid-frame
  const workflowStatus = workflow?.status;
  const isWorkflowActive =
    workflowStatus === WorkflowStatus.PENDING ||
    workflowStatus === WorkflowStatus.RUNNING ||
    workflowStatus === WorkflowStatus.WAITING;
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
  });

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

  const handleToggleDetailsExpanded = useEventCallback(() => {
    toggleDetailsExpanded();
  });

  const handleCancel = useEventCallback(() => {
    // TODO: Implement workflow cancellation
    console.log("Cancel workflow:", name);
  });

  const handleShellTabChange = useEventCallback((taskName: string | null) => {
    setActiveShellTaskName(taskName);
  });

  // Determine current panel view from URL navigation state
  const currentPanelView: DetailsPanelView =
    navView === "task" && selectedTask ? "task" : navView === "group" && selectedGroup ? "group" : "workflow";

  // Content state: loading, error, not found, or ready
  const isReady = !isLoading && !error && !isNotFound && workflow;

  // Panel override content for loading/error states
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
  };

  const panelOverrideContent = renderPanelContent();

  // Shared props for both views (with type casts for tab setters)
  const sharedProps = {
    workflow: workflow!,
    groups: groupsWithLayout,
    selectedGroupName,
    selectedTaskName,
    selectedTaskRetryId,
    selectedGroup,
    selectedTask,
    currentPanelView,
    selectionKey,
    onSelectGroup: handleNavigateToGroup,
    onSelectTask: handleNavigateToTask,
    onBackToGroup: handleNavigateBackToGroup,
    onBackToWorkflow: handleBackToWorkflow,
    panelPct,
    onPanelResize: setPanelPct,
    isDetailsExpanded,
    onToggleDetailsExpanded: handleToggleDetailsExpanded,
    isPanelCollapsed,
    togglePanelCollapsed,
    expandPanel,
    panelOverrideContent,
    onCancelWorkflow: handleCancel,
    selectedTab,
    setSelectedTab,
    selectedWorkflowTab,
    setSelectedWorkflowTab,
    selectedGroupTab,
    setSelectedGroupTab,
    onShellTabChange: handleShellTabChange,
    activeShellTaskName,
  };

  return (
    <DAGErrorBoundary>
      <ShellProvider workflowName={name}>
        <ShellPortalProvider>
          {isReady ? (
            isTableView ? (
              <WorkflowTableView {...sharedProps} />
            ) : (
              <WorkflowDAGView
                {...sharedProps}
                isPanning={isPanning}
                onPanningChange={setIsPanning}
              />
            )
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

// No need for ReactFlowProvider wrapper here - WorkflowDAGView handles it internally
export { WorkflowDetailInner as WorkflowDetailInnerWithProvider };
