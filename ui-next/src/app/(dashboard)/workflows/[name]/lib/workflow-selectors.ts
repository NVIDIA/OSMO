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
 * Workflow Selectors
 *
 * Pure selector functions for deriving workflow state with NO React dependencies.
 * This module is 100% unit testable and provides the single source of truth
 * for workflow state derivations.
 *
 * Architecture principles:
 * - Pure functions only (no side effects)
 * - No React imports allowed
 * - Immutable data transformations
 * - Explicit type signatures
 * - Comprehensive JSDoc documentation
 *
 * @example
 * ```typescript
 * import { selectCurrentContext, calculateWorkflowProgress } from "@/app/(dashboard)/workflows/[name]/lib/workflow-selectors";
 *
 * const context = selectCurrentContext(groups, "step-1", "task-a", 0);
 * const progress = calculateWorkflowProgress(groups);
 * ```
 */

import { WorkflowStatus } from "@/lib/api/generated";
import { isTaskTerminal, isTaskOngoing, isTaskFailed } from "@/lib/api/status-metadata.generated";
import type { TaskQueryResponse } from "@/lib/api/adapter/types";
import type { GroupWithLayout } from "@/app/(dashboard)/workflows/[name]/lib/workflow-types";

// =============================================================================
// Domain Types (Pure, no React)
// =============================================================================

/**
 * Navigation view levels in the workflow detail page.
 * Represents the current depth of navigation.
 */
export type NavigationView = "workflow" | "group" | "task";

/**
 * Navigation context derived from URL state and workflow data.
 * This is the "current selection" resolved from URL params.
 *
 * @example
 * ```typescript
 * // Workflow view (nothing selected)
 * { view: "workflow", group: null, task: null, selectionKey: null }
 *
 * // Group view (group selected)
 * { view: "group", group: {...}, task: null, selectionKey: "group:step-1" }
 *
 * // Task view (task selected)
 * { view: "task", group: {...}, task: {...}, selectionKey: "task:step-1:task-a:0" }
 * ```
 */
export interface NavigationContext {
  /** Current view level */
  readonly view: NavigationView;
  /** Selected group (null if workflow view) */
  readonly group: GroupWithLayout | null;
  /** Selected task (null if workflow or group view) */
  readonly task: TaskQueryResponse | null;
  /** Selection key for panel behavior */
  readonly selectionKey: string | null;
}

/**
 * Workflow progress statistics computed from groups.
 * Used for progress bars, status summaries, and activity detection.
 */
export interface WorkflowProgress {
  /** Total number of groups */
  readonly totalGroups: number;
  /** Groups that have completed (success or failure) */
  readonly completedGroups: number;
  /** Groups currently running */
  readonly runningGroups: number;
  /** Groups pending execution */
  readonly pendingGroups: number;
  /** Groups that failed */
  readonly failedGroups: number;
  /** Overall progress percentage (0-100) */
  readonly progressPercent: number;
  /** Whether workflow is in a terminal state */
  readonly isTerminal: boolean;
}

/**
 * Task lookup key for stable identification across retries.
 * Used for selection comparison and cache keys.
 */
export interface TaskKey {
  readonly groupName: string;
  readonly taskName: string;
  readonly retryId: number;
}

// =============================================================================
// Selection Functions
// =============================================================================

/**
 * Resolves current navigation context from URL params and workflow data.
 *
 * This function maps URL state (group name, task name, retry ID) to actual
 * domain objects (GroupWithLayout, TaskQueryResponse). It handles missing
 * or invalid references gracefully by falling back to parent views.
 *
 * Fallback behavior:
 * - Invalid group name -> falls back to workflow view
 * - Invalid task name -> falls back to group view
 * - Invalid retry ID -> finds task by name only
 *
 * @param groups - All groups with layout info
 * @param groupName - Selected group name from URL (nullable)
 * @param taskName - Selected task name from URL (nullable)
 * @param taskRetryId - Selected task retry ID from URL (nullable)
 * @returns Resolved navigation context
 *
 * @example
 * ```typescript
 * // Task selected
 * const context = selectCurrentContext(groups, "step-1", "my-task", 0);
 * // => { view: "task", group: {...}, task: {...}, selectionKey: "task:step-1:my-task:0" }
 *
 * // Group not found - falls back
 * const context = selectCurrentContext(groups, "nonexistent", null, null);
 * // => { view: "workflow", group: null, task: null, selectionKey: null }
 * ```
 */
export function selectCurrentContext(
  groups: readonly GroupWithLayout[],
  groupName: string | null,
  taskName: string | null,
  taskRetryId: number | null,
): NavigationContext {
  // No selection - workflow view
  if (!groupName) {
    return { view: "workflow", group: null, task: null, selectionKey: null };
  }

  // Find selected group
  const group = selectGroupByName(groups, groupName);
  if (!group) {
    // Group not found - fall back to workflow view
    return { view: "workflow", group: null, task: null, selectionKey: null };
  }

  // Group selected, no task - group view
  if (!taskName) {
    return {
      view: "group",
      group,
      task: null,
      selectionKey: `group:${groupName}`,
    };
  }

  // Find selected task within group
  const task = selectTaskByName(group, taskName, taskRetryId ?? undefined);

  if (!task) {
    // Task not found - fall back to group view
    return {
      view: "group",
      group,
      task: null,
      selectionKey: `group:${groupName}`,
    };
  }

  // Task selected - task view
  return {
    view: "task",
    group,
    task,
    selectionKey: `task:${groupName}:${taskName}:${task.retry_id}`,
  };
}

/**
 * Finds a group by name in the groups array.
 * Returns null if not found (no throwing for safety).
 *
 * @param groups - Array of groups to search
 * @param name - Group name to find
 * @returns The matching group or null
 */
export function selectGroupByName(groups: readonly GroupWithLayout[], name: string): GroupWithLayout | null {
  return groups.find((g) => g.name === name) ?? null;
}

/**
 * Finds a task by name within a group.
 * Returns null if not found (no throwing for safety).
 *
 * When retryId is provided, matches both name and retry ID.
 * When retryId is omitted, returns the first task with matching name.
 *
 * @param group - Group containing the task
 * @param taskName - Task name to find
 * @param retryId - Optional retry ID for exact matching
 * @returns The matching task or null
 */
export function selectTaskByName(group: GroupWithLayout, taskName: string, retryId?: number): TaskQueryResponse | null {
  const tasks = group.tasks ?? [];
  if (retryId !== undefined) {
    return tasks.find((t) => t.name === taskName && t.retry_id === retryId) ?? null;
  }
  return tasks.find((t) => t.name === taskName) ?? null;
}

// =============================================================================
// Progress Calculation
// =============================================================================

/**
 * Calculates workflow progress from group statuses.
 *
 * Uses generated status metadata for semantic interpretation of statuses.
 * This ensures consistency with backend status definitions.
 *
 * Progress calculation:
 * - progressPercent = (completedGroups / totalGroups) * 100
 * - isTerminal = no running or pending groups
 *
 * @param groups - Array of groups with status information
 * @returns Progress statistics
 *
 * @example
 * ```typescript
 * const progress = calculateWorkflowProgress(groups);
 * // => {
 * //   totalGroups: 4,
 * //   completedGroups: 2,
 * //   runningGroups: 1,
 * //   pendingGroups: 1,
 * //   failedGroups: 0,
 * //   progressPercent: 50,
 * //   isTerminal: false
 * // }
 * ```
 */
export function calculateWorkflowProgress(groups: readonly GroupWithLayout[]): WorkflowProgress {
  if (groups.length === 0) {
    return {
      totalGroups: 0,
      completedGroups: 0,
      runningGroups: 0,
      pendingGroups: 0,
      failedGroups: 0,
      progressPercent: 0,
      isTerminal: true,
    };
  }

  let completed = 0;
  let running = 0;
  let pending = 0;
  let failed = 0;

  for (const group of groups) {
    const status = group.status;

    // Use generated status metadata for categorization
    if (isTaskTerminal(status)) {
      completed++;
      if (isTaskFailed(status)) {
        failed++;
      }
    } else if (isTaskOngoing(status)) {
      running++;
    } else {
      pending++;
    }
  }

  const totalGroups = groups.length;
  const progressPercent = totalGroups > 0 ? Math.round((completed / totalGroups) * 100) : 0;

  return {
    totalGroups,
    completedGroups: completed,
    runningGroups: running,
    pendingGroups: pending,
    failedGroups: failed,
    progressPercent,
    isTerminal: running === 0 && pending === 0,
  };
}

// =============================================================================
// Activity Detection
// =============================================================================

/**
 * Determines if a workflow is active (needs live updates).
 *
 * Active workflows should enable the tick controller for duration updates.
 * This function checks the workflow-level status, not individual group statuses.
 *
 * Active statuses: PENDING, RUNNING, WAITING
 * Inactive statuses: COMPLETED, FAILED, CANCELLED
 *
 * @param status - Workflow status from the API
 * @returns True if workflow needs live updates
 */
export function isWorkflowActive(status: WorkflowStatus): boolean {
  return status === WorkflowStatus.PENDING || status === WorkflowStatus.RUNNING || status === WorkflowStatus.WAITING;
}

/**
 * Determines if a group should auto-navigate to its single task.
 *
 * Single-task groups skip the group view and navigate directly to task view.
 * This provides a more direct UX when groups contain only one task.
 *
 * @param group - Group to check
 * @returns True if group has exactly one task
 */
export function shouldAutoNavigateToTask(group: GroupWithLayout): boolean {
  const tasks = group.tasks ?? [];
  return tasks.length === 1;
}

/**
 * Gets the single task from a group if it should auto-navigate.
 * Returns null if group has zero or multiple tasks.
 *
 * @param group - Group to check
 * @returns The single task or null
 */
export function getAutoNavigateTask(group: GroupWithLayout): TaskQueryResponse | null {
  if (shouldAutoNavigateToTask(group)) {
    const tasks = group.tasks ?? [];
    return tasks[0] ?? null;
  }
  return null;
}

// =============================================================================
// Selection Key Generation
// =============================================================================

/**
 * Generates a stable selection key for panel behavior.
 *
 * Keys change when selection changes, triggering panel auto-expand.
 * The key format is designed to be:
 * - Unique per selection
 * - Parseable for debugging
 * - Stable for the same selection
 *
 * Key formats:
 * - null: No selection (workflow view)
 * - "group:{name}": Group selected
 * - "task:{group}:{task}:{retryId}": Task selected
 *
 * @param groupName - Selected group name
 * @param taskName - Selected task name
 * @param taskRetryId - Selected task retry ID
 * @returns Selection key or null
 */
export function generateSelectionKey(
  groupName: string | null,
  taskName: string | null,
  taskRetryId: number | null,
): string | null {
  if (!groupName) {
    return null;
  }
  if (taskName) {
    return `task:${groupName}:${taskName}:${taskRetryId ?? 0}`;
  }
  return `group:${groupName}`;
}

/**
 * Creates a TaskKey from selection parameters.
 * Useful for comparison and caching operations.
 *
 * @param groupName - Group name
 * @param taskName - Task name
 * @param retryId - Retry ID
 * @returns TaskKey object or null if required params missing
 */
export function createTaskKey(
  groupName: string | null,
  taskName: string | null,
  retryId: number | null,
): TaskKey | null {
  if (!groupName || !taskName) {
    return null;
  }
  return {
    groupName,
    taskName,
    retryId: retryId ?? 0,
  };
}

/**
 * Determines if two selection keys represent the same selection.
 * Used for re-click detection (clicking already-selected item).
 *
 * @param current - Current task key
 * @param previous - Previous task key
 * @returns True if selections match
 */
export function isSameSelection(current: TaskKey | null, previous: TaskKey | null): boolean {
  if (current === null && previous === null) return true;
  if (current === null || previous === null) return false;
  return (
    current.groupName === previous.groupName &&
    current.taskName === previous.taskName &&
    current.retryId === previous.retryId
  );
}

// =============================================================================
// Panel View Derivation
// =============================================================================

/**
 * Derives the panel view type from navigation context.
 *
 * This is a convenience function that extracts just the view type
 * from a full navigation context. Useful when you only need the view
 * and not the full resolved objects.
 *
 * @param context - Navigation context
 * @returns Panel view type
 */
export function derivePanelView(context: NavigationContext): NavigationView {
  return context.view;
}

/**
 * Determines if the navigation has an active selection (not workflow view).
 *
 * @param context - Navigation context
 * @returns True if a group or task is selected
 */
export function hasActiveSelection(context: NavigationContext): boolean {
  return context.view !== "workflow";
}

// =============================================================================
// Batch Operations
// =============================================================================

/**
 * Gets all tasks across all groups as a flat array.
 * Useful for filtering and search operations.
 *
 * @param groups - Array of groups
 * @returns Flat array of all tasks with group info attached
 */
export function getAllTasks(groups: readonly GroupWithLayout[]): Array<TaskQueryResponse & { _groupName: string }> {
  const result: Array<TaskQueryResponse & { _groupName: string }> = [];

  for (const group of groups) {
    const tasks = group.tasks ?? [];
    for (const task of tasks) {
      result.push({
        ...task,
        _groupName: group.name,
      });
    }
  }

  return result;
}

/**
 * Counts total tasks across all groups.
 *
 * @param groups - Array of groups
 * @returns Total task count
 */
export function countTotalTasks(groups: readonly GroupWithLayout[]): number {
  let count = 0;
  for (const group of groups) {
    count += group.tasks?.length ?? 0;
  }
  return count;
}
