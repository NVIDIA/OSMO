//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { getProgressIndex } from "@/components/event-viewer/LifecycleProgressBar";
import type { TaskGroup } from "@/lib/api/adapter/events/events-grouping";
import type { K8sEvent, PodPhase, LifecycleStage, EventSeverity } from "@/lib/api/adapter/events/events-types";
import { computeDerivedState, type TaskDerivedState } from "@/lib/api/adapter/events/events-derived-state";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let eventCounter = 0;

function makeEvent(
  reason: string,
  stage: LifecycleStage,
  severity: EventSeverity = "info",
  minutesOffset = 0,
): K8sEvent {
  eventCounter += 1;
  const timestamp = new Date(Date.UTC(2026, 1, 12, 8, minutesOffset, 0));
  return {
    id: `test-${eventCounter}`,
    timestamp,
    entity: "worker_0",
    taskName: "worker_0",
    retryId: 0,
    type: severity === "error" ? "Warning" : "Normal",
    reason,
    message: `${reason} event`,
    source: { component: "kubelet" },
    involvedObject: { kind: "Pod", name: "worker-0" },
    severity,
    stage,
  };
}

function makeTask(podPhase: PodPhase, events: K8sEvent[]): TaskGroup {
  const derived: TaskDerivedState = { ...computeDerivedState(events), podPhase };
  return {
    id: "worker_0",
    name: "worker_0",
    retryId: 0,
    duration: "1m",
    events,
    derived,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getProgressIndex", () => {
  describe("Pending phase", () => {
    it("returns 0 (Pending) when no events exist", () => {
      const task = makeTask("Pending", []);
      expect(getProgressIndex(task)).toBe(0);
    });

    it("returns 0 (Pending) when only FailedScheduling event exists", () => {
      const task = makeTask("Pending", [makeEvent("FailedScheduling", "scheduling", "error", 0)]);
      expect(getProgressIndex(task)).toBe(0);
    });

    it("returns 0 (Pending) when only Preempting event exists", () => {
      const task = makeTask("Pending", [makeEvent("Preempting", "scheduling", "warn", 0)]);
      expect(getProgressIndex(task)).toBe(0);
    });

    it("returns 1 (Init) when Scheduled event exists but no further events", () => {
      const task = makeTask("Pending", [makeEvent("Scheduled", "scheduling", "info", 0)]);
      expect(getProgressIndex(task)).toBe(1);
    });

    it("returns 1 (Init) when Scheduled followed by FailedScheduling then Scheduled again", () => {
      const task = makeTask("Pending", [
        makeEvent("FailedScheduling", "scheduling", "error", 0),
        makeEvent("Scheduled", "scheduling", "info", 1),
      ]);
      expect(getProgressIndex(task)).toBe(1);
    });

    it("returns 1 (Init) when Scheduled and Pulling events exist", () => {
      const task = makeTask("Pending", [
        makeEvent("Scheduled", "scheduling", "info", 0),
        makeEvent("Pulling", "image", "info", 1),
      ]);
      expect(getProgressIndex(task)).toBe(1);
    });

    it("returns 1 (Init) when Scheduled, Pulled, and Created events exist", () => {
      const task = makeTask("Pending", [
        makeEvent("Scheduled", "scheduling", "info", 0),
        makeEvent("Pulling", "image", "info", 1),
        makeEvent("Pulled", "image", "info", 2),
        makeEvent("Created", "container", "info", 3),
      ]);
      expect(getProgressIndex(task)).toBe(1);
    });
  });

  describe("Running phase", () => {
    it("returns 2 (Running) when pod phase is Running", () => {
      const task = makeTask("Running", [
        makeEvent("Scheduled", "scheduling", "info", 0),
        makeEvent("Pulling", "image", "info", 1),
        makeEvent("Pulled", "image", "info", 2),
        makeEvent("Created", "container", "info", 3),
        makeEvent("Started", "container", "info", 4),
      ]);
      expect(getProgressIndex(task)).toBe(2);
    });

    it("returns 2 (Running) even with minimal events", () => {
      const task = makeTask("Running", [makeEvent("Started", "container", "info", 0)]);
      expect(getProgressIndex(task)).toBe(2);
    });
  });

  describe("Succeeded phase", () => {
    it("returns 3 (Done) when pod phase is Succeeded", () => {
      const task = makeTask("Succeeded", [
        makeEvent("Scheduled", "scheduling", "info", 0),
        makeEvent("Started", "container", "info", 1),
        makeEvent("Completed", "completion", "info", 2),
      ]);
      expect(getProgressIndex(task)).toBe(3);
    });
  });

  describe("Failed phase", () => {
    it("returns 0 (Pending) when failed with no non-failure events", () => {
      const task = makeTask("Failed", [makeEvent("Failed", "failure", "error", 0)]);
      expect(getProgressIndex(task)).toBe(0);
    });

    it("returns 0 (Pending) when failed during scheduling (only FailedScheduling)", () => {
      const task = makeTask("Failed", [
        makeEvent("FailedScheduling", "scheduling", "error", 0),
        makeEvent("Failed", "failure", "error", 1),
      ]);
      // FailedScheduling is not a failure stage, so it survives the filter.
      // But there's no Scheduled event, so scheduling never completed -> index 0
      expect(getProgressIndex(task)).toBe(0);
    });

    it("returns 1 (Init) when failed after Scheduled but before Started", () => {
      const task = makeTask("Failed", [
        makeEvent("Scheduled", "scheduling", "info", 0),
        makeEvent("Failed", "failure", "error", 1),
      ]);
      expect(getProgressIndex(task)).toBe(1);
    });

    it("returns 1 (Init) when failed during image pull", () => {
      const task = makeTask("Failed", [
        makeEvent("Scheduled", "scheduling", "info", 0),
        makeEvent("Pulling", "image", "info", 1),
        makeEvent("ErrImagePull", "image", "error", 2),
        makeEvent("Failed", "failure", "error", 3),
      ]);
      expect(getProgressIndex(task)).toBe(1);
    });

    it("returns 2 (Running) when failed after container started", () => {
      const task = makeTask("Failed", [
        makeEvent("Scheduled", "scheduling", "info", 0),
        makeEvent("Started", "container", "info", 1),
        makeEvent("OOMKilled", "failure", "error", 2),
      ]);
      expect(getProgressIndex(task)).toBe(2);
    });

    it("returns 2 (Running) when failed during runtime", () => {
      const task = makeTask("Failed", [
        makeEvent("Scheduled", "scheduling", "info", 0),
        makeEvent("Started", "container", "info", 1),
        makeEvent("Unhealthy", "runtime", "warn", 2),
        makeEvent("Failed", "failure", "error", 3),
      ]);
      expect(getProgressIndex(task)).toBe(2);
    });

    it("returns 3 (Done) when failed after completion event", () => {
      const task = makeTask("Failed", [
        makeEvent("Scheduled", "scheduling", "info", 0),
        makeEvent("Started", "container", "info", 1),
        makeEvent("Completed", "completion", "info", 2),
        makeEvent("Failed", "failure", "error", 3),
      ]);
      expect(getProgressIndex(task)).toBe(3);
    });
  });

  describe("Unknown phase", () => {
    it("returns 0 (Pending) for Unknown phase with no events", () => {
      const task = makeTask("Unknown", []);
      expect(getProgressIndex(task)).toBe(0);
    });

    it("returns 1 (Init) for Unknown phase with Scheduled event (furthest stage wins)", () => {
      // Even though podPhase is Unknown, the Scheduled event proves the task
      // completed scheduling — getProgressIndex uses furthestProgressIndex
      const task = makeTask("Unknown", [makeEvent("Scheduled", "scheduling", "info", 0)]);
      expect(getProgressIndex(task)).toBe(1);
    });
  });

  describe("Missing events (gaps in lifecycle)", () => {
    it("returns 2 (Running) when only Started event exists (no Pending/Init events)", () => {
      // Missing Scheduled, Pulling, Created events — Started proves task reached Running
      const task = makeTask("Running", [makeEvent("Started", "container", "info", 0)]);
      expect(getProgressIndex(task)).toBe(2);
    });

    it("returns 3 (Done) when only Completed event exists (no earlier events)", () => {
      const task = makeTask("Succeeded", [makeEvent("Completed", "completion", "info", 0)]);
      expect(getProgressIndex(task)).toBe(3);
    });

    it("returns 2 (Running) when Running events exist but no Init events", () => {
      const task = makeTask("Running", [
        makeEvent("Scheduled", "scheduling", "info", 0),
        // Missing: Pulling, Pulled, Created
        makeEvent("Started", "container", "info", 5),
      ]);
      expect(getProgressIndex(task)).toBe(2);
    });
  });

  describe("Out-of-order events", () => {
    it("returns 2 (Running) when Scheduled arrives after Started", () => {
      // Events arrive out of order: Started first, then Scheduled with later timestamp
      const task = makeTask("Running", [
        makeEvent("Started", "container", "info", 0),
        makeEvent("Scheduled", "scheduling", "info", 1),
      ]);
      expect(getProgressIndex(task)).toBe(2);
    });

    it("returns 2 (Running) when Pulling arrives after Started", () => {
      const task = makeTask("Running", [
        makeEvent("Scheduled", "scheduling", "info", 0),
        makeEvent("Started", "container", "info", 1),
        makeEvent("Pulling", "image", "info", 2),
      ]);
      expect(getProgressIndex(task)).toBe(2);
    });

    it("does not regress from Running when later Pending event arrives", () => {
      const task = makeTask("Running", [
        makeEvent("Started", "container", "info", 0),
        makeEvent("FailedScheduling", "scheduling", "error", 1),
        makeEvent("Scheduled", "scheduling", "info", 2),
      ]);
      expect(getProgressIndex(task)).toBe(2);
    });
  });
});
