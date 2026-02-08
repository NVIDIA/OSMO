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
 * Domain Layer Unit Tests
 *
 * Tests for pure workflow domain functions.
 * These tests verify business logic without any React dependencies.
 */

import { describe, it, expect } from "vitest";
import { TaskGroupStatus, WorkflowStatus } from "@/lib/api/generated";
import type { GroupWithLayout } from "@/app/(dashboard)/workflows/[name]/lib/workflow-types";
import {
  selectCurrentContext,
  selectGroupByName,
  selectTaskByName,
  calculateWorkflowProgress,
  isWorkflowActive,
  shouldAutoNavigateToTask,
  getAutoNavigateTask,
  generateSelectionKey,
  createTaskKey,
  isSameSelection,
  hasActiveSelection,
  getAllTasks,
  countTotalTasks,
} from "@/app/(dashboard)/workflows/[name]/lib/workflow-selectors";

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Creates a mock group with configurable properties.
 */
function createMockGroup(overrides: Partial<GroupWithLayout> = {}): GroupWithLayout {
  return {
    name: "test-group",
    id: "test-group",
    level: 0,
    lane: 0,
    status: TaskGroupStatus.WAITING,
    tasks: [],
    downstream_groups: [],
    remaining_upstream_groups: [],
    ...overrides,
  } as GroupWithLayout;
}

/**
 * Creates a mock task with all required fields.
 */
function createMockTask(
  name: string,
  retryId: number = 0,
  status: (typeof TaskGroupStatus)[keyof typeof TaskGroupStatus] = TaskGroupStatus.WAITING,
) {
  return {
    name,
    retry_id: retryId,
    status,
    task_uuid: `uuid-${name}-${retryId}`,
    logs: "",
    events: "",
    pod_name: `pod-${name}-${retryId}`,
  };
}

/**
 * Standard test groups fixture.
 * Note: TaskGroupStatus does not have PENDING - use WAITING or PROCESSING for pending states.
 */
const mockGroups: GroupWithLayout[] = [
  createMockGroup({
    name: "step-1",
    id: "step-1",
    level: 0,
    status: TaskGroupStatus.COMPLETED,
    tasks: [
      createMockTask("task-a", 0, TaskGroupStatus.COMPLETED),
      createMockTask("task-b", 0, TaskGroupStatus.COMPLETED),
    ],
  }),
  createMockGroup({
    name: "step-2",
    id: "step-2",
    level: 1,
    status: TaskGroupStatus.RUNNING,
    tasks: [createMockTask("task-c", 0, TaskGroupStatus.RUNNING)],
  }),
  createMockGroup({
    name: "step-3",
    id: "step-3",
    level: 2,
    status: TaskGroupStatus.WAITING, // WAITING is a pending-like state (in queue, not started)
    tasks: [
      createMockTask("task-d", 0, TaskGroupStatus.WAITING),
      createMockTask("task-d", 1, TaskGroupStatus.WAITING), // Retry
    ],
  }),
];

// =============================================================================
// selectCurrentContext Tests
// =============================================================================

describe("selectCurrentContext", () => {
  it("returns workflow view when no group selected", () => {
    const context = selectCurrentContext(mockGroups, null, null, null);

    expect(context.view).toBe("workflow");
    expect(context.group).toBeNull();
    expect(context.task).toBeNull();
    expect(context.selectionKey).toBeNull();
  });

  it("returns group view when group selected without task", () => {
    const context = selectCurrentContext(mockGroups, "step-1", null, null);

    expect(context.view).toBe("group");
    expect(context.group?.name).toBe("step-1");
    expect(context.task).toBeNull();
    expect(context.selectionKey).toBe("group:step-1");
  });

  it("returns task view when group and task selected", () => {
    const context = selectCurrentContext(mockGroups, "step-1", "task-a", 0);

    expect(context.view).toBe("task");
    expect(context.group?.name).toBe("step-1");
    expect(context.task?.name).toBe("task-a");
    expect(context.selectionKey).toBe("task:step-1:task-a:0");
  });

  it("matches task by retry ID when specified", () => {
    const context = selectCurrentContext(mockGroups, "step-3", "task-d", 1);

    expect(context.view).toBe("task");
    expect(context.task?.retry_id).toBe(1);
    expect(context.selectionKey).toBe("task:step-3:task-d:1");
  });

  it("falls back to workflow view when group not found", () => {
    const context = selectCurrentContext(mockGroups, "nonexistent", null, null);

    expect(context.view).toBe("workflow");
    expect(context.group).toBeNull();
    expect(context.task).toBeNull();
    expect(context.selectionKey).toBeNull();
  });

  it("falls back to group view when task not found", () => {
    const context = selectCurrentContext(mockGroups, "step-1", "nonexistent", null);

    expect(context.view).toBe("group");
    expect(context.group?.name).toBe("step-1");
    expect(context.task).toBeNull();
    expect(context.selectionKey).toBe("group:step-1");
  });

  it("handles empty groups array", () => {
    const context = selectCurrentContext([], "step-1", null, null);

    expect(context.view).toBe("workflow");
    expect(context.group).toBeNull();
  });

  it("finds task without retry ID (first match)", () => {
    const context = selectCurrentContext(mockGroups, "step-3", "task-d", null);

    expect(context.view).toBe("task");
    expect(context.task?.name).toBe("task-d");
    expect(context.task?.retry_id).toBe(0); // First match
  });
});

// =============================================================================
// selectGroupByName Tests
// =============================================================================

describe("selectGroupByName", () => {
  it("finds group by name", () => {
    const group = selectGroupByName(mockGroups, "step-2");

    expect(group).not.toBeNull();
    expect(group?.name).toBe("step-2");
    expect(group?.level).toBe(1);
  });

  it("returns null when group not found", () => {
    const group = selectGroupByName(mockGroups, "nonexistent");

    expect(group).toBeNull();
  });

  it("returns null for empty array", () => {
    const group = selectGroupByName([], "any");

    expect(group).toBeNull();
  });
});

// =============================================================================
// selectTaskByName Tests
// =============================================================================

describe("selectTaskByName", () => {
  const group = mockGroups[0]; // step-1 with task-a, task-b

  it("finds task by name", () => {
    const task = selectTaskByName(group, "task-a");

    expect(task).not.toBeNull();
    expect(task?.name).toBe("task-a");
  });

  it("finds task by name and retry ID", () => {
    const groupWithRetries = mockGroups[2]; // step-3 with task-d retries
    const task = selectTaskByName(groupWithRetries, "task-d", 1);

    expect(task).not.toBeNull();
    expect(task?.name).toBe("task-d");
    expect(task?.retry_id).toBe(1);
  });

  it("returns null when task not found", () => {
    const task = selectTaskByName(group, "nonexistent");

    expect(task).toBeNull();
  });

  it("returns null when retry ID does not match", () => {
    const task = selectTaskByName(group, "task-a", 99);

    expect(task).toBeNull();
  });

  it("handles group with no tasks", () => {
    const emptyGroup = createMockGroup({ tasks: undefined });
    const task = selectTaskByName(emptyGroup, "any");

    expect(task).toBeNull();
  });
});

// =============================================================================
// calculateWorkflowProgress Tests
// =============================================================================

describe("calculateWorkflowProgress", () => {
  it("calculates progress for mixed statuses", () => {
    const progress = calculateWorkflowProgress(mockGroups);

    expect(progress.totalGroups).toBe(3);
    expect(progress.completedGroups).toBe(1);
    expect(progress.runningGroups).toBe(1);
    expect(progress.pendingGroups).toBe(1);
    expect(progress.failedGroups).toBe(0);
    expect(progress.progressPercent).toBe(33); // 1/3 = 33%
    expect(progress.isTerminal).toBe(false);
  });

  it("handles empty groups array", () => {
    const progress = calculateWorkflowProgress([]);

    expect(progress.totalGroups).toBe(0);
    expect(progress.completedGroups).toBe(0);
    expect(progress.progressPercent).toBe(0);
    expect(progress.isTerminal).toBe(true);
  });

  it("calculates 100% when all completed", () => {
    const completedGroups = [
      createMockGroup({ status: TaskGroupStatus.COMPLETED }),
      createMockGroup({ status: TaskGroupStatus.COMPLETED }),
    ];

    const progress = calculateWorkflowProgress(completedGroups);

    expect(progress.completedGroups).toBe(2);
    expect(progress.progressPercent).toBe(100);
    expect(progress.isTerminal).toBe(true);
  });

  it("counts failed groups correctly", () => {
    const groupsWithFailure = [
      createMockGroup({ status: TaskGroupStatus.COMPLETED }),
      createMockGroup({ status: TaskGroupStatus.FAILED }),
      createMockGroup({ status: TaskGroupStatus.RUNNING }),
    ];

    const progress = calculateWorkflowProgress(groupsWithFailure);

    expect(progress.completedGroups).toBe(2); // COMPLETED + FAILED are both terminal
    expect(progress.failedGroups).toBe(1);
    expect(progress.isTerminal).toBe(false); // Still has running
  });

  it("is terminal when only completed/failed", () => {
    const terminalGroups = [
      createMockGroup({ status: TaskGroupStatus.COMPLETED }),
      createMockGroup({ status: TaskGroupStatus.FAILED }),
    ];

    const progress = calculateWorkflowProgress(terminalGroups);

    expect(progress.isTerminal).toBe(true);
  });
});

// =============================================================================
// isWorkflowActive Tests
// =============================================================================

describe("isWorkflowActive", () => {
  it("returns true for PENDING", () => {
    expect(isWorkflowActive(WorkflowStatus.PENDING)).toBe(true);
  });

  it("returns true for RUNNING", () => {
    expect(isWorkflowActive(WorkflowStatus.RUNNING)).toBe(true);
  });

  it("returns true for WAITING", () => {
    expect(isWorkflowActive(WorkflowStatus.WAITING)).toBe(true);
  });

  it("returns false for COMPLETED", () => {
    expect(isWorkflowActive(WorkflowStatus.COMPLETED)).toBe(false);
  });

  it("returns false for FAILED", () => {
    expect(isWorkflowActive(WorkflowStatus.FAILED)).toBe(false);
  });

  it("returns false for FAILED_CANCELED", () => {
    expect(isWorkflowActive(WorkflowStatus.FAILED_CANCELED)).toBe(false);
  });
});

// =============================================================================
// shouldAutoNavigateToTask Tests
// =============================================================================

describe("shouldAutoNavigateToTask", () => {
  it("returns true for single-task group", () => {
    const singleTaskGroup = createMockGroup({
      tasks: [createMockTask("only-task")],
    });

    expect(shouldAutoNavigateToTask(singleTaskGroup)).toBe(true);
  });

  it("returns false for multi-task group", () => {
    const multiTaskGroup = createMockGroup({
      tasks: [createMockTask("task-1"), createMockTask("task-2")],
    });

    expect(shouldAutoNavigateToTask(multiTaskGroup)).toBe(false);
  });

  it("returns false for empty task list", () => {
    const emptyGroup = createMockGroup({ tasks: [] });

    expect(shouldAutoNavigateToTask(emptyGroup)).toBe(false);
  });

  it("returns false for undefined tasks", () => {
    const noTasksGroup = createMockGroup({ tasks: undefined });

    expect(shouldAutoNavigateToTask(noTasksGroup)).toBe(false);
  });
});

// =============================================================================
// getAutoNavigateTask Tests
// =============================================================================

describe("getAutoNavigateTask", () => {
  it("returns the single task for single-task group", () => {
    const singleTask = createMockTask("only-task");
    const group = createMockGroup({ tasks: [singleTask] });

    const task = getAutoNavigateTask(group);

    expect(task).not.toBeNull();
    expect(task?.name).toBe("only-task");
  });

  it("returns null for multi-task group", () => {
    const group = createMockGroup({
      tasks: [createMockTask("task-1"), createMockTask("task-2")],
    });

    expect(getAutoNavigateTask(group)).toBeNull();
  });

  it("returns null for empty group", () => {
    const group = createMockGroup({ tasks: [] });

    expect(getAutoNavigateTask(group)).toBeNull();
  });
});

// =============================================================================
// generateSelectionKey Tests
// =============================================================================

describe("generateSelectionKey", () => {
  it("returns null when no group selected", () => {
    expect(generateSelectionKey(null, null, null)).toBeNull();
  });

  it("returns group key when only group selected", () => {
    expect(generateSelectionKey("step-1", null, null)).toBe("group:step-1");
  });

  it("returns task key when task selected", () => {
    expect(generateSelectionKey("step-1", "task-a", 0)).toBe("task:step-1:task-a:0");
  });

  it("defaults retry ID to 0 when null", () => {
    expect(generateSelectionKey("step-1", "task-a", null)).toBe("task:step-1:task-a:0");
  });

  it("uses provided retry ID", () => {
    expect(generateSelectionKey("step-1", "task-a", 2)).toBe("task:step-1:task-a:2");
  });
});

// =============================================================================
// createTaskKey Tests
// =============================================================================

describe("createTaskKey", () => {
  it("creates task key with all params", () => {
    const key = createTaskKey("group-1", "task-1", 0);

    expect(key).toEqual({
      groupName: "group-1",
      taskName: "task-1",
      retryId: 0,
    });
  });

  it("defaults retry ID to 0", () => {
    const key = createTaskKey("group-1", "task-1", null);

    expect(key?.retryId).toBe(0);
  });

  it("returns null when group name missing", () => {
    expect(createTaskKey(null, "task-1", 0)).toBeNull();
  });

  it("returns null when task name missing", () => {
    expect(createTaskKey("group-1", null, 0)).toBeNull();
  });
});

// =============================================================================
// isSameSelection Tests
// =============================================================================

describe("isSameSelection", () => {
  it("returns true for identical keys", () => {
    const key1 = { groupName: "g1", taskName: "t1", retryId: 0 };
    const key2 = { groupName: "g1", taskName: "t1", retryId: 0 };

    expect(isSameSelection(key1, key2)).toBe(true);
  });

  it("returns true when both null", () => {
    expect(isSameSelection(null, null)).toBe(true);
  });

  it("returns false when one is null", () => {
    const key = { groupName: "g1", taskName: "t1", retryId: 0 };

    expect(isSameSelection(key, null)).toBe(false);
    expect(isSameSelection(null, key)).toBe(false);
  });

  it("returns false when group differs", () => {
    const key1 = { groupName: "g1", taskName: "t1", retryId: 0 };
    const key2 = { groupName: "g2", taskName: "t1", retryId: 0 };

    expect(isSameSelection(key1, key2)).toBe(false);
  });

  it("returns false when task differs", () => {
    const key1 = { groupName: "g1", taskName: "t1", retryId: 0 };
    const key2 = { groupName: "g1", taskName: "t2", retryId: 0 };

    expect(isSameSelection(key1, key2)).toBe(false);
  });

  it("returns false when retry ID differs", () => {
    const key1 = { groupName: "g1", taskName: "t1", retryId: 0 };
    const key2 = { groupName: "g1", taskName: "t1", retryId: 1 };

    expect(isSameSelection(key1, key2)).toBe(false);
  });
});

// =============================================================================
// hasActiveSelection Tests
// =============================================================================

describe("hasActiveSelection", () => {
  it("returns false for workflow view", () => {
    const context = selectCurrentContext(mockGroups, null, null, null);

    expect(hasActiveSelection(context)).toBe(false);
  });

  it("returns true for group view", () => {
    const context = selectCurrentContext(mockGroups, "step-1", null, null);

    expect(hasActiveSelection(context)).toBe(true);
  });

  it("returns true for task view", () => {
    const context = selectCurrentContext(mockGroups, "step-1", "task-a", 0);

    expect(hasActiveSelection(context)).toBe(true);
  });
});

// =============================================================================
// getAllTasks Tests
// =============================================================================

describe("getAllTasks", () => {
  it("flattens all tasks from all groups", () => {
    const tasks = getAllTasks(mockGroups);

    // step-1: task-a, task-b
    // step-2: task-c
    // step-3: task-d (x2 retries)
    expect(tasks).toHaveLength(5);
  });

  it("attaches group name to each task", () => {
    const tasks = getAllTasks(mockGroups);

    const taskA = tasks.find((t) => t.name === "task-a");
    expect(taskA?._groupName).toBe("step-1");

    const taskC = tasks.find((t) => t.name === "task-c");
    expect(taskC?._groupName).toBe("step-2");
  });

  it("handles empty groups", () => {
    expect(getAllTasks([])).toEqual([]);
  });

  it("handles groups with no tasks", () => {
    const emptyGroups = [createMockGroup({ tasks: undefined })];

    expect(getAllTasks(emptyGroups)).toEqual([]);
  });
});

// =============================================================================
// countTotalTasks Tests
// =============================================================================

describe("countTotalTasks", () => {
  it("counts all tasks across groups", () => {
    expect(countTotalTasks(mockGroups)).toBe(5);
  });

  it("returns 0 for empty groups", () => {
    expect(countTotalTasks([])).toBe(0);
  });

  it("handles groups with undefined tasks", () => {
    const groups = [createMockGroup({ tasks: undefined }), createMockGroup({ tasks: [createMockTask("task")] })];

    expect(countTotalTasks(groups)).toBe(1);
  });
});
