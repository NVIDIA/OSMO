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
 * useNavigationState Hook
 *
 * URL-synced navigation state for workflow detail page.
 * Enables shareable deep links and browser back/forward navigation.
 *
 * URL format:
 * - /workflows/[name] - Workflow view (default)
 * - /workflows/[name]?group=step-1 - Group view
 * - /workflows/[name]?group=step-1&task=my-task - Task view
 * - /workflows/[name]?group=step-1&task=my-task&tab=shell - Task view with shell tab
 *
 * Navigation flow:
 * - workflowlist → workflow (route navigation)
 * - workflow → group (URL param: ?group=...)
 * - group → task (URL param: ?group=...&task=...)
 * - task tabs (URL param: ?...&tab=shell) - replace history, no back button
 * - Back button navigates through URL history automatically
 */

"use client";

import { useEffect, useMemo, useCallback } from "react";
import { useQueryState, parseAsString, parseAsInteger } from "nuqs";
import type { GroupWithLayout, TaskQueryResponse } from "../lib/workflow-types";

// =============================================================================
// Types
// =============================================================================

/**
 * Current navigation view derived from URL state.
 */
export type NavigationView = "workflow" | "group" | "task";

/**
 * Task detail tabs.
 * - "overview": Default tab showing task timeline and details
 * - "shell": Interactive shell (only available for running tasks)
 * - "logs": Task logs output
 * - "events": Kubernetes events
 */
export type TaskTab = "overview" | "shell" | "logs" | "events";

/**
 * Workflow detail tabs.
 * - "overview": Default tab showing workflow timeline, details, and links
 * - "tasks": Task list table view
 * - "logs": Workflow logs output
 * - "events": Kubernetes events
 * - "spec": Workflow YAML spec and template Jinja spec
 */
export type WorkflowTab = "overview" | "tasks" | "logs" | "events" | "spec";

/**
 * Group detail tabs.
 * - "overview": Default tab showing group timeline, stats, and dependencies
 * - "tasks": Task list within the group (only visible in DAG view)
 */
export type GroupTab = "overview" | "tasks";

/**
 * Selected item identifiers from URL.
 */
export interface NavigationSelection {
  groupName: string | null;
  taskName: string | null;
  taskRetryId: number | null;
}

export interface InitialView {
  groupName: string | null;
  taskName: string | null;
  taskRetryId: number | null;
}

export interface UseNavigationStateOptions {
  /** All groups in the workflow (for resolving names to objects) */
  groups: GroupWithLayout[];
  /** Server-parsed URL state for instant rendering before nuqs hydration */
  initialView: InitialView;
}

export interface UseNavigationStateReturn {
  /** Current view based on URL state */
  view: NavigationView;

  /** Selected group name from URL */
  selectedGroupName: string | null;

  /** Selected task name from URL */
  selectedTaskName: string | null;

  /** Selected task retry ID from URL */
  selectedTaskRetryId: number | null;

  /** Selected task tab from URL (defaults to "overview") */
  selectedTab: TaskTab;

  /** Selected workflow tab from URL (defaults to "overview") */
  selectedWorkflowTab: WorkflowTab;

  /** Selected group tab from URL (defaults to "overview") */
  selectedGroupTab: GroupTab;

  /** Resolved selected group object (null if not found) */
  selectedGroup: GroupWithLayout | null;

  /** Resolved selected task object (null if not found) */
  selectedTask: TaskQueryResponse | null;

  /**
   * Navigate to a group.
   * Updates URL: ?group={name}
   */
  navigateToGroup: (group: GroupWithLayout) => void;

  /**
   * Navigate to a task within a group.
   * Updates URL: ?group={groupName}&task={taskName}&retry={retryId}
   */
  navigateToTask: (task: TaskQueryResponse, group: GroupWithLayout) => void;

  /**
   * Navigate back to workflow view (clear all selection).
   * Browser back also works naturally via URL history.
   */
  navigateToWorkflow: () => void;

  /**
   * Navigate back from task to its group.
   * Updates URL: ?group={name} (removes task params)
   */
  navigateBackToGroup: () => void;

  /**
   * Set the active task tab.
   * Updates URL: ?...&tab={tab} (uses replace history, no back button for tab changes)
   */
  setSelectedTab: (tab: TaskTab) => void;

  /**
   * Set the active workflow tab.
   * Updates URL: ?wtab={tab} (uses replace history, no back button for tab changes)
   */
  setSelectedWorkflowTab: (tab: WorkflowTab) => void;

  /**
   * Set the active group tab.
   * Updates URL: ?gtab={tab} (uses replace history, no back button for tab changes)
   */
  setSelectedGroupTab: (tab: GroupTab) => void;

  /**
   * Clear all URL navigation state.
   * Used when workflow changes or on unmount.
   */
  clearNavigation: () => void;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for URL-synced navigation state.
 *
 * Uses nuqs for URL state management with browser history integration.
 * Enables shareable deep links and natural back/forward navigation.
 *
 * Performance: Uses initialView (server-parsed) for first render to avoid
 * nuqs hydration delay (~100ms). After hydration, nuqs takes over for URL sync.
 *
 * @example
 * ```tsx
 * const {
 *   view,
 *   selectedGroup,
 *   selectedTask,
 *   navigateToGroup,
 *   navigateToTask,
 *   navigateBackToGroup,
 * } = useNavigationState({ groups, initialView });
 *
 * // Navigate to a group (updates URL, enables back button)
 * handleNodeClick(group) => navigateToGroup(group);
 *
 * // Navigate to a task
 * handleTaskClick(task, group) => navigateToTask(task, group);
 * ```
 */
export function useNavigationState({ groups, initialView }: UseNavigationStateOptions): UseNavigationStateReturn {
  // URL state for group selection
  // Uses "push" history so each navigation creates a new history entry
  const [groupNameFromNuqs, setGroupName] = useQueryState(
    "group",
    parseAsString.withOptions({
      shallow: true,
      history: "push",
      clearOnDefault: true,
    }),
  );

  // URL state for task selection
  const [taskNameFromNuqs, setTaskName] = useQueryState(
    "task",
    parseAsString.withOptions({
      shallow: true,
      history: "push",
      clearOnDefault: true,
    }),
  );

  // URL state for task retry ID (for distinguishing retries of the same task)
  const [taskRetryIdFromNuqs, setTaskRetryId] = useQueryState(
    "retry",
    parseAsInteger.withOptions({
      shallow: true,
      history: "push",
      clearOnDefault: true,
    }),
  );

  // Track if nuqs has hydrated (once hydrated, always use nuqs state even if null)
  // nuqs returns undefined before hydration, null after hydration (when param is cleared)
  // This distinction allows us to use initialView only during the initial render
  const isHydrated =
    groupNameFromNuqs !== undefined || taskNameFromNuqs !== undefined || taskRetryIdFromNuqs !== undefined;

  // Use initialView before hydration, nuqs after (even if nuqs values are null)
  const groupName = isHydrated ? groupNameFromNuqs : initialView.groupName;
  const taskName = isHydrated ? taskNameFromNuqs : initialView.taskName;
  const taskRetryId = isHydrated ? taskRetryIdFromNuqs : initialView.taskRetryId;

  // URL state for task tab (only relevant in task view)
  // Uses "replace" history so tab changes don't create new history entries
  const [tabParam, setTabParam] = useQueryState(
    "tab",
    parseAsString.withOptions({
      shallow: true,
      history: "replace",
      clearOnDefault: true,
    }),
  );

  // URL state for workflow tab (only relevant in workflow view)
  // Uses "replace" history so tab changes don't create new history entries
  const [workflowTabParam, setWorkflowTabParam] = useQueryState(
    "wtab",
    parseAsString.withOptions({
      shallow: true,
      history: "replace",
      clearOnDefault: true,
    }),
  );

  // URL state for group tab (only relevant in group view)
  // Uses "replace" history so tab changes don't create new history entries
  const [groupTabParam, setGroupTabParam] = useQueryState(
    "gtab",
    parseAsString.withOptions({
      shallow: true,
      history: "replace",
      clearOnDefault: true,
    }),
  );

  // Resolve tab param to TaskTab type (defaults to "overview" if null or invalid)
  const selectedTab: TaskTab = useMemo(() => {
    if (tabParam === "shell" || tabParam === "logs" || tabParam === "events") {
      return tabParam;
    }
    return "overview";
  }, [tabParam]);

  // Resolve workflow tab param to WorkflowTab type (defaults to "overview" if null or invalid)
  const selectedWorkflowTab: WorkflowTab = useMemo(() => {
    if (
      workflowTabParam === "tasks" ||
      workflowTabParam === "logs" ||
      workflowTabParam === "events" ||
      workflowTabParam === "spec"
    ) {
      return workflowTabParam;
    }
    return "overview";
  }, [workflowTabParam]);

  // Resolve group tab param to GroupTab type (defaults to "overview" if null or invalid)
  const selectedGroupTab: GroupTab = useMemo(() => {
    if (groupTabParam === "tasks") {
      return "tasks";
    }
    return "overview";
  }, [groupTabParam]);

  // Resolve group name to group object
  const selectedGroup = useMemo(() => {
    if (!groupName) return null;
    return groups.find((g) => g.name === groupName) ?? null;
  }, [groupName, groups]);

  // Resolve task name to task object within the selected group
  const selectedTask = useMemo(() => {
    if (!selectedGroup || !taskName) return null;
    const tasks = selectedGroup.tasks ?? [];

    // If retry ID is specified, match both name and retry ID
    if (taskRetryId !== null) {
      return tasks.find((t) => t.name === taskName && t.retry_id === taskRetryId) ?? null;
    }

    // Otherwise just match by name (first match)
    return tasks.find((t) => t.name === taskName) ?? null;
  }, [selectedGroup, taskName, taskRetryId]);

  // Determine current view from URL state
  const view: NavigationView = useMemo(() => {
    if (taskName && selectedTask) return "task";
    if (groupName && selectedGroup) return "group";
    return "workflow";
  }, [groupName, taskName, selectedGroup, selectedTask]);

  // Navigation functions - use stable callbacks for memoized children
  const navigateToGroup = useCallback(
    (group: GroupWithLayout) => {
      // For single-task groups, navigate directly to the task
      if (group.tasks && group.tasks.length === 1) {
        const task = group.tasks[0];
        setGroupName(group.name);
        setTaskName(task.name);
        setTaskRetryId(task.retry_id);
        setWorkflowTabParam(null); // Clear workflow tab when leaving workflow view
        // Keep tab if navigating to same task, otherwise reset
      } else {
        // Multi-task group: show group view
        setGroupName(group.name);
        setTaskName(null);
        setTaskRetryId(null);
        setTabParam(null); // Clear tab when leaving task view
        setWorkflowTabParam(null); // Clear workflow tab when leaving workflow view
      }
    },
    [setGroupName, setTaskName, setTaskRetryId, setWorkflowTabParam, setTabParam],
  );

  const navigateToTask = useCallback(
    (task: TaskQueryResponse, group: GroupWithLayout) => {
      setGroupName(group.name);
      setTaskName(task.name);
      setTaskRetryId(task.retry_id);
      setWorkflowTabParam(null); // Clear workflow tab when leaving workflow view
      setGroupTabParam(null); // Clear group tab when drilling into task
      // Note: Tab is preserved when navigating between tasks (user preference)
      // Reset to overview only if current tab is shell but shell won't be available
    },
    [setGroupName, setTaskName, setTaskRetryId, setWorkflowTabParam, setGroupTabParam],
  );

  const navigateToWorkflow = useCallback(() => {
    setGroupName(null);
    setTaskName(null);
    setTaskRetryId(null);
    setTabParam(null); // Clear tab when leaving task view
    setGroupTabParam(null); // Clear group tab when leaving group view
  }, [setGroupName, setTaskName, setTaskRetryId, setTabParam, setGroupTabParam]);

  const navigateBackToGroup = useCallback(() => {
    // Keep group, clear task and tab
    setTaskName(null);
    setTaskRetryId(null);
    setTabParam(null);
  }, [setTaskName, setTaskRetryId, setTabParam]);

  const setSelectedTab = useCallback(
    (tab: TaskTab) => {
      // Only set non-overview tabs in URL (overview is the default)
      setTabParam(tab === "overview" ? null : tab);
    },
    [setTabParam],
  );

  const setSelectedWorkflowTab = useCallback(
    (tab: WorkflowTab) => {
      // Only set non-overview tabs in URL (overview is the default)
      setWorkflowTabParam(tab === "overview" ? null : tab);
    },
    [setWorkflowTabParam],
  );

  const setSelectedGroupTab = useCallback(
    (tab: GroupTab) => {
      // Only set non-overview tabs in URL (overview is the default)
      setGroupTabParam(tab === "overview" ? null : tab);
    },
    [setGroupTabParam],
  );

  const clearNavigation = useCallback(() => {
    setGroupName(null);
    setTaskName(null);
    setTaskRetryId(null);
    setTabParam(null);
    setWorkflowTabParam(null);
    setGroupTabParam(null);
  }, [setGroupName, setTaskName, setTaskRetryId, setTabParam, setWorkflowTabParam, setGroupTabParam]);

  // Clear stale URL params if referenced group/task no longer exists
  // This handles cases like workflow refresh where structure changed
  useEffect(() => {
    if (groupName && groups.length > 0 && !selectedGroup) {
      // Group no longer exists, clear navigation
      clearNavigation();
    }
  }, [groupName, groups.length, selectedGroup, clearNavigation]);

  return {
    view,
    selectedGroupName: groupName,
    selectedTaskName: taskName,
    selectedTaskRetryId: taskRetryId,
    selectedTab,
    selectedWorkflowTab,
    selectedGroupTab,
    selectedGroup,
    selectedTask,
    navigateToGroup,
    navigateToTask,
    navigateToWorkflow,
    navigateBackToGroup,
    setSelectedTab,
    setSelectedWorkflowTab,
    setSelectedGroupTab,
    clearNavigation,
  };
}
