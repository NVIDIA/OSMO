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
 * Status Utilities Tests
 *
 * Tests the task/group status categorization logic:
 * - Status category mapping
 * - Bitwise status flags for fast O(1) lookups
 * - Task stats computation
 * - Group status derivation
 * - Duration calculations
 *
 * These are pure function tests with no DOM or React dependencies.
 */

import { describe, it, expect } from "vitest";
import {
  getStatusCategory,
  isFailedStatus,
  isFailedFast,
  isRunningFast,
  isCompletedFast,
  isWaitingFast,
  getStatusLabel,
  getStatusStyle,
  computeTaskStats,
  computeGroupStatus,
  computeGroupDuration,
  STATUS_CATEGORY_MAP,
  STATUS_SORT_ORDER,
  STATE_CATEGORIES,
  type StatusCategory,
} from "./status";

// =============================================================================
// Test Helpers
// =============================================================================

interface MockTask {
  status: string;
  start_time?: string | null;
  end_time?: string | null;
}

function createTask(status: string, startTime?: string, endTime?: string): MockTask {
  return {
    status,
    start_time: startTime ?? null,
    end_time: endTime ?? null,
  };
}

// =============================================================================
// Status Category Tests
// =============================================================================

describe("getStatusCategory", () => {
  describe("waiting statuses", () => {
    it("categorizes SUBMITTING as waiting", () => {
      expect(getStatusCategory("SUBMITTING")).toBe("waiting");
    });

    it("categorizes WAITING as waiting", () => {
      expect(getStatusCategory("WAITING")).toBe("waiting");
    });

    it("categorizes PROCESSING as waiting", () => {
      expect(getStatusCategory("PROCESSING")).toBe("waiting");
    });

    it("categorizes SCHEDULING as waiting", () => {
      expect(getStatusCategory("SCHEDULING")).toBe("waiting");
    });
  });

  describe("running statuses", () => {
    it("categorizes RUNNING as running", () => {
      expect(getStatusCategory("RUNNING")).toBe("running");
    });

    it("categorizes INITIALIZING as running", () => {
      expect(getStatusCategory("INITIALIZING")).toBe("running");
    });
  });

  describe("completed statuses", () => {
    it("categorizes COMPLETED as completed", () => {
      expect(getStatusCategory("COMPLETED")).toBe("completed");
    });

    it("categorizes RESCHEDULED as completed", () => {
      expect(getStatusCategory("RESCHEDULED")).toBe("completed");
    });
  });

  describe("failed statuses", () => {
    const failedStatuses = [
      "FAILED",
      "FAILED_CANCELED",
      "FAILED_SERVER_ERROR",
      "FAILED_BACKEND_ERROR",
      "FAILED_EXEC_TIMEOUT",
      "FAILED_QUEUE_TIMEOUT",
      "FAILED_IMAGE_PULL",
      "FAILED_UPSTREAM",
      "FAILED_EVICTED",
      "FAILED_START_ERROR",
      "FAILED_START_TIMEOUT",
      "FAILED_PREEMPTED",
    ];

    it.each(failedStatuses)("categorizes %s as failed", (status) => {
      expect(getStatusCategory(status)).toBe("failed");
    });
  });

  describe("unknown statuses", () => {
    it("falls back to failed for unknown status", () => {
      expect(getStatusCategory("UNKNOWN_STATUS")).toBe("failed");
    });

    it("falls back to failed for empty string", () => {
      expect(getStatusCategory("")).toBe("failed");
    });
  });
});

// =============================================================================
// Bitwise Flag Tests
// =============================================================================

describe("bitwise status checks", () => {
  describe("isFailedFast", () => {
    it("returns true for all failed statuses", () => {
      expect(isFailedFast("FAILED")).toBe(true);
      expect(isFailedFast("FAILED_CANCELED")).toBe(true);
      expect(isFailedFast("FAILED_IMAGE_PULL")).toBe(true);
      expect(isFailedFast("FAILED_PREEMPTED")).toBe(true);
    });

    it("returns false for non-failed statuses", () => {
      expect(isFailedFast("RUNNING")).toBe(false);
      expect(isFailedFast("COMPLETED")).toBe(false);
      expect(isFailedFast("WAITING")).toBe(false);
    });

    it("returns false for unknown statuses", () => {
      expect(isFailedFast("UNKNOWN")).toBe(false);
    });
  });

  describe("isRunningFast", () => {
    it("returns true for running statuses", () => {
      expect(isRunningFast("RUNNING")).toBe(true);
      expect(isRunningFast("INITIALIZING")).toBe(true);
    });

    it("returns false for non-running statuses", () => {
      expect(isRunningFast("WAITING")).toBe(false);
      expect(isRunningFast("COMPLETED")).toBe(false);
      expect(isRunningFast("FAILED")).toBe(false);
    });
  });

  describe("isCompletedFast", () => {
    it("returns true for completed statuses", () => {
      expect(isCompletedFast("COMPLETED")).toBe(true);
      expect(isCompletedFast("RESCHEDULED")).toBe(true);
    });

    it("returns false for non-completed statuses", () => {
      expect(isCompletedFast("RUNNING")).toBe(false);
      expect(isCompletedFast("FAILED")).toBe(false);
    });
  });

  describe("isWaitingFast", () => {
    it("returns true for waiting statuses", () => {
      expect(isWaitingFast("WAITING")).toBe(true);
      expect(isWaitingFast("SCHEDULING")).toBe(true);
      expect(isWaitingFast("SUBMITTING")).toBe(true);
      expect(isWaitingFast("PROCESSING")).toBe(true);
    });

    it("returns false for non-waiting statuses", () => {
      expect(isWaitingFast("RUNNING")).toBe(false);
      expect(isWaitingFast("COMPLETED")).toBe(false);
    });
  });

  describe("isFailedStatus (wrapper)", () => {
    it("delegates to isFailedFast", () => {
      expect(isFailedStatus("FAILED")).toBe(true);
      expect(isFailedStatus("COMPLETED")).toBe(false);
    });
  });
});

// =============================================================================
// Status Label Tests
// =============================================================================

describe("getStatusLabel", () => {
  it("returns human-readable label for known status", () => {
    expect(getStatusLabel("COMPLETED")).toBe("Completed");
    expect(getStatusLabel("RUNNING")).toBe("Running");
    expect(getStatusLabel("FAILED_IMAGE_PULL")).toBe("Image Pull");
    expect(getStatusLabel("FAILED_CANCELED")).toBe("Canceled");
  });

  it("returns raw status for unknown status", () => {
    expect(getStatusLabel("CUSTOM_STATUS")).toBe("CUSTOM_STATUS");
  });
});

// =============================================================================
// Status Style Tests
// =============================================================================

describe("getStatusStyle", () => {
  it("returns waiting style for waiting statuses", () => {
    const style = getStatusStyle("WAITING");
    expect(style.bg).toContain("gray");
    expect(style.color).toBeDefined();
  });

  it("returns running style for running statuses", () => {
    const style = getStatusStyle("RUNNING");
    expect(style.bg).toContain("blue");
  });

  it("returns completed style for completed statuses", () => {
    const style = getStatusStyle("COMPLETED");
    expect(style.bg).toContain("emerald");
  });

  it("returns failed style for failed statuses", () => {
    const style = getStatusStyle("FAILED");
    expect(style.bg).toContain("red");
  });
});

// =============================================================================
// Task Stats Computation Tests
// =============================================================================

describe("computeTaskStats", () => {
  describe("counting", () => {
    it("returns zero counts for empty array", () => {
      const stats = computeTaskStats([]);

      expect(stats.total).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.running).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.pending).toBe(0);
    });

    it("counts single task correctly", () => {
      const stats = computeTaskStats([createTask("COMPLETED")]);

      expect(stats.total).toBe(1);
      expect(stats.completed).toBe(1);
      expect(stats.running).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.pending).toBe(0);
    });

    it("counts mixed statuses correctly", () => {
      const tasks = [
        createTask("COMPLETED"),
        createTask("COMPLETED"),
        createTask("RUNNING"),
        createTask("FAILED"),
        createTask("WAITING"),
        createTask("SCHEDULING"),
      ];
      const stats = computeTaskStats(tasks);

      expect(stats.total).toBe(6);
      expect(stats.completed).toBe(2);
      expect(stats.running).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.pending).toBe(2); // WAITING + SCHEDULING
    });

    it("counts all failed variants correctly", () => {
      const tasks = [createTask("FAILED"), createTask("FAILED_CANCELED"), createTask("FAILED_IMAGE_PULL")];
      const stats = computeTaskStats(tasks);

      expect(stats.failed).toBe(3);
    });
  });

  describe("subStats", () => {
    it("tracks individual status counts", () => {
      const tasks = [
        createTask("COMPLETED"),
        createTask("COMPLETED"),
        createTask("FAILED"),
        createTask("FAILED_IMAGE_PULL"),
      ];
      const stats = computeTaskStats(tasks);

      expect(stats.subStats.get("COMPLETED")).toBe(2);
      expect(stats.subStats.get("FAILED")).toBe(1);
      expect(stats.subStats.get("FAILED_IMAGE_PULL")).toBe(1);
    });
  });

  describe("timing", () => {
    it("computes earliest start time", () => {
      const tasks = [
        createTask("COMPLETED", "2024-01-01T12:00:00Z"),
        createTask("COMPLETED", "2024-01-01T10:00:00Z"), // Earlier
        createTask("COMPLETED", "2024-01-01T14:00:00Z"),
      ];
      const stats = computeTaskStats(tasks);

      expect(stats.earliestStart).toBe(Date.parse("2024-01-01T10:00:00Z"));
    });

    it("computes latest end time", () => {
      const tasks = [
        createTask("COMPLETED", "2024-01-01T10:00:00Z", "2024-01-01T11:00:00Z"),
        createTask("COMPLETED", "2024-01-01T12:00:00Z", "2024-01-01T15:00:00Z"), // Latest
        createTask("COMPLETED", "2024-01-01T14:00:00Z", "2024-01-01T14:30:00Z"),
      ];
      const stats = computeTaskStats(tasks);

      expect(stats.latestEnd).toBe(Date.parse("2024-01-01T15:00:00Z"));
    });

    it("returns null for missing times", () => {
      const tasks = [createTask("WAITING")];
      const stats = computeTaskStats(tasks);

      expect(stats.earliestStart).toBeNull();
      expect(stats.latestEnd).toBeNull();
    });

    it("sets hasRunning flag when any task is running", () => {
      const tasksWithRunning = [createTask("COMPLETED"), createTask("RUNNING")];
      const tasksWithoutRunning = [createTask("COMPLETED"), createTask("FAILED")];

      expect(computeTaskStats(tasksWithRunning).hasRunning).toBe(true);
      expect(computeTaskStats(tasksWithoutRunning).hasRunning).toBe(false);
    });
  });
});

// =============================================================================
// Group Status Computation Tests
// =============================================================================

describe("computeGroupStatus", () => {
  it("returns completed when all tasks completed", () => {
    const stats = computeTaskStats([createTask("COMPLETED"), createTask("COMPLETED")]);
    const groupStatus = computeGroupStatus(stats);

    expect(groupStatus.status).toBe("completed");
    expect(groupStatus.label).toBe("Completed");
  });

  it("returns failed when any task failed", () => {
    const stats = computeTaskStats([createTask("COMPLETED"), createTask("FAILED")]);
    const groupStatus = computeGroupStatus(stats);

    expect(groupStatus.status).toBe("failed");
    expect(groupStatus.label).toBe("Failed");
  });

  it("returns running with failures when both running and failed", () => {
    const stats = computeTaskStats([createTask("RUNNING"), createTask("FAILED")]);
    const groupStatus = computeGroupStatus(stats);

    expect(groupStatus.status).toBe("failed");
    expect(groupStatus.label).toBe("Running with failures");
  });

  it("returns running when any task running (no failures)", () => {
    const stats = computeTaskStats([createTask("COMPLETED"), createTask("RUNNING"), createTask("WAITING")]);
    const groupStatus = computeGroupStatus(stats);

    expect(groupStatus.status).toBe("running");
    expect(groupStatus.label).toBe("Running");
  });

  it("returns pending when no running/failed/completed", () => {
    const stats = computeTaskStats([createTask("WAITING"), createTask("SCHEDULING")]);
    const groupStatus = computeGroupStatus(stats);

    expect(groupStatus.status).toBe("pending");
    expect(groupStatus.label).toBe("Pending");
  });
});

// =============================================================================
// Group Duration Computation Tests
// =============================================================================

describe("computeGroupDuration", () => {
  it("returns null when no start time", () => {
    const stats = computeTaskStats([createTask("WAITING")]);
    expect(computeGroupDuration(stats)).toBeNull();
  });

  it("computes duration from earliest start to latest end", () => {
    const tasks = [
      createTask("COMPLETED", "2024-01-01T10:00:00Z", "2024-01-01T10:30:00Z"),
      createTask("COMPLETED", "2024-01-01T10:05:00Z", "2024-01-01T11:00:00Z"),
    ];
    const stats = computeTaskStats(tasks);
    const duration = computeGroupDuration(stats);

    // 10:00 to 11:00 = 60 minutes = 3600 seconds
    expect(duration).toBe(3600);
  });

  it("returns null when no end time and not running", () => {
    const tasks = [createTask("COMPLETED", "2024-01-01T10:00:00Z")];
    const stats = computeTaskStats(tasks);
    expect(computeGroupDuration(stats)).toBeNull();
  });
});

// =============================================================================
// Static Data Structure Tests
// =============================================================================

describe("STATUS_CATEGORY_MAP", () => {
  it("contains all expected statuses", () => {
    const expectedCategories: StatusCategory[] = ["waiting", "running", "completed", "failed"];
    const categories = new Set(Object.values(STATUS_CATEGORY_MAP));

    expectedCategories.forEach((cat) => {
      expect(categories.has(cat)).toBe(true);
    });
  });
});

describe("STATUS_SORT_ORDER", () => {
  it("places failed statuses first (lowest values)", () => {
    const failedOrder = STATUS_SORT_ORDER["FAILED"];
    const runningOrder = STATUS_SORT_ORDER["RUNNING"];
    const completedOrder = STATUS_SORT_ORDER["COMPLETED"];

    expect(failedOrder).toBeLessThan(runningOrder);
    expect(runningOrder).toBeLessThan(completedOrder);
  });
});

describe("STATE_CATEGORIES", () => {
  it("includes COMPLETED in completed category", () => {
    expect(STATE_CATEGORIES.completed.has("COMPLETED")).toBe(true);
  });

  it("includes RUNNING in running category", () => {
    expect(STATE_CATEGORIES.running.has("RUNNING")).toBe(true);
  });

  it("includes multiple failed statuses", () => {
    expect(STATE_CATEGORIES.failed.has("FAILED")).toBe(true);
    expect(STATE_CATEGORIES.failed.has("FAILED_CANCELED")).toBe(true);
    expect(STATE_CATEGORIES.failed.has("FAILED_IMAGE_PULL")).toBe(true);
  });

  it("includes waiting statuses in pending", () => {
    expect(STATE_CATEGORIES.pending.has("WAITING")).toBe(true);
    expect(STATE_CATEGORIES.pending.has("SCHEDULING")).toBe(true);
  });
});
