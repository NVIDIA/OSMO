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

import { useEffect, useMemo } from "react";
import { useQueryState, parseAsString, parseAsInteger } from "nuqs";
import { useEventCallback } from "usehooks-ts";
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
 * Selected item identifiers from URL.
 */
export interface NavigationSelection {
  groupName: string | null;
  taskName: string | null;
  taskRetryId: number | null;
}

export interface UseNavigationStateOptions {
  /** All groups in the workflow (for resolving names to objects) */
  groups: GroupWithLayout[];
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
 * @example
 * ```tsx
 * const {
 *   view,
 *   selectedGroup,
 *   selectedTask,
 *   navigateToGroup,
 *   navigateToTask,
 *   navigateBackToGroup,
 * } = useNavigationState({ groups });
 *
 * // Navigate to a group (updates URL, enables back button)
 * handleNodeClick(group) => navigateToGroup(group);
 *
 * // Navigate to a task
 * handleTaskClick(task, group) => navigateToTask(task, group);
 * ```
 */
export function useNavigationState({ groups }: UseNavigationStateOptions): UseNavigationStateReturn {
  // URL state for group selection
  // Uses "push" history so each navigation creates a new history entry
  const [groupName, setGroupName] = useQueryState(
    "group",
    parseAsString.withOptions({
      shallow: true,
      history: "push",
      clearOnDefault: true,
    }),
  );

  // URL state for task selection
  const [taskName, setTaskName] = useQueryState(
    "task",
    parseAsString.withOptions({
      shallow: true,
      history: "push",
      clearOnDefault: true,
    }),
  );

  // URL state for task retry ID (for distinguishing retries of the same task)
  const [taskRetryId, setTaskRetryId] = useQueryState(
    "retry",
    parseAsInteger.withOptions({
      shallow: true,
      history: "push",
      clearOnDefault: true,
    }),
  );

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

  // Resolve tab param to TaskTab type (defaults to "overview" if null or invalid)
  const selectedTab: TaskTab = useMemo(() => {
    if (tabParam === "shell" || tabParam === "logs" || tabParam === "events") {
      return tabParam;
    }
    return "overview";
  }, [tabParam]);

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
  const navigateToGroup = useEventCallback((group: GroupWithLayout) => {
    // For single-task groups, navigate directly to the task
    if (group.tasks && group.tasks.length === 1) {
      const task = group.tasks[0];
      setGroupName(group.name);
      setTaskName(task.name);
      setTaskRetryId(task.retry_id);
      // Keep tab if navigating to same task, otherwise reset
    } else {
      // Multi-task group: show group view
      setGroupName(group.name);
      setTaskName(null);
      setTaskRetryId(null);
      setTabParam(null); // Clear tab when leaving task view
    }
  });

  const navigateToTask = useEventCallback((task: TaskQueryResponse, group: GroupWithLayout) => {
    setGroupName(group.name);
    setTaskName(task.name);
    setTaskRetryId(task.retry_id);
    // Note: Tab is preserved when navigating between tasks (user preference)
    // Reset to overview only if current tab is shell but shell won't be available
  });

  const navigateToWorkflow = useEventCallback(() => {
    setGroupName(null);
    setTaskName(null);
    setTaskRetryId(null);
    setTabParam(null); // Clear tab when leaving task view
  });

  const navigateBackToGroup = useEventCallback(() => {
    // Keep group, clear task and tab
    setTaskName(null);
    setTaskRetryId(null);
    setTabParam(null);
  });

  const setSelectedTab = useEventCallback((tab: TaskTab) => {
    // Only set non-overview tabs in URL (overview is the default)
    setTabParam(tab === "overview" ? null : tab);
  });

  const clearNavigation = useEventCallback(() => {
    setGroupName(null);
    setTaskName(null);
    setTaskRetryId(null);
    setTabParam(null);
  });

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
    selectedGroup,
    selectedTask,
    navigateToGroup,
    navigateToTask,
    navigateToWorkflow,
    navigateBackToGroup,
    setSelectedTab,
    clearNavigation,
  };
}
