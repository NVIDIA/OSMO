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
import { computeDerivedState } from "@/lib/api/adapter/events/events-derived-state";
import type { K8sEvent, LifecycleStage, EventSeverity } from "@/lib/api/adapter/events/events-types";

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

// ---------------------------------------------------------------------------
// Tests: furthestProgressIndex
// ---------------------------------------------------------------------------

describe("computeDerivedState", () => {
  describe("furthestProgressIndex", () => {
    it("returns -1 for empty events", () => {
      const state = computeDerivedState([]);
      expect(state.furthestProgressIndex).toBe(-1);
    });

    it("returns 0 for scheduling-only events (no Scheduled)", () => {
      const state = computeDerivedState([makeEvent("FailedScheduling", "scheduling", "error", 0)]);
      expect(state.furthestProgressIndex).toBe(0);
    });

    it("returns 1 when Scheduled event bumps from 0 to 1", () => {
      const state = computeDerivedState([makeEvent("Scheduled", "scheduling", "info", 0)]);
      expect(state.furthestProgressIndex).toBe(1);
    });

    it("returns 1 for image-stage events", () => {
      const state = computeDerivedState([
        makeEvent("Scheduled", "scheduling", "info", 0),
        makeEvent("Pulling", "image", "info", 1),
      ]);
      expect(state.furthestProgressIndex).toBe(1);
    });

    it("returns 1 for Created event (container stage but still init)", () => {
      const state = computeDerivedState([
        makeEvent("Scheduled", "scheduling", "info", 0),
        makeEvent("Created", "container", "info", 1),
      ]);
      expect(state.furthestProgressIndex).toBe(1);
    });

    it("returns 2 for Started event (container stage → running)", () => {
      const state = computeDerivedState([
        makeEvent("Scheduled", "scheduling", "info", 0),
        makeEvent("Started", "container", "info", 1),
      ]);
      expect(state.furthestProgressIndex).toBe(2);
    });

    it("returns 2 for runtime-stage events", () => {
      const state = computeDerivedState([
        makeEvent("Scheduled", "scheduling", "info", 0),
        makeEvent("Started", "container", "info", 1),
        makeEvent("Unhealthy", "runtime", "warn", 2),
      ]);
      expect(state.furthestProgressIndex).toBe(2);
    });

    it("returns 3 for completion events", () => {
      const state = computeDerivedState([
        makeEvent("Scheduled", "scheduling", "info", 0),
        makeEvent("Started", "container", "info", 1),
        makeEvent("Completed", "completion", "info", 2),
      ]);
      expect(state.furthestProgressIndex).toBe(3);
    });

    it("ignores failure events for progression", () => {
      const state = computeDerivedState([
        makeEvent("Scheduled", "scheduling", "info", 0),
        makeEvent("Started", "container", "info", 1),
        makeEvent("OOMKilled", "failure", "error", 2),
      ]);
      // Failure is -1, so furthest is 2 (from Started)
      expect(state.furthestProgressIndex).toBe(2);
    });

    it("returns 0 when only failure events exist (no non-failure events)", () => {
      const state = computeDerivedState([makeEvent("Failed", "failure", "error", 0)]);
      expect(state.furthestProgressIndex).toBe(-1);
    });
  });

  // ---------------------------------------------------------------------------
  // Tests: observedStageIndices
  // ---------------------------------------------------------------------------

  describe("observedStageIndices", () => {
    it("is empty for no events", () => {
      const state = computeDerivedState([]);
      expect(state.observedStageIndices.size).toBe(0);
    });

    it("tracks scheduling (0) from Scheduled event", () => {
      const state = computeDerivedState([makeEvent("Scheduled", "scheduling", "info", 0)]);
      expect(state.observedStageIndices.has(0)).toBe(true);
    });

    it("tracks init (1) from Pulling event", () => {
      const state = computeDerivedState([
        makeEvent("Scheduled", "scheduling", "info", 0),
        makeEvent("Pulling", "image", "info", 1),
      ]);
      expect(state.observedStageIndices.has(0)).toBe(true);
      expect(state.observedStageIndices.has(1)).toBe(true);
    });

    it("tracks running (2) from Started event", () => {
      const state = computeDerivedState([makeEvent("Started", "container", "info", 0)]);
      expect(state.observedStageIndices.has(2)).toBe(true);
    });

    it("tracks done (3) from Completed event", () => {
      const state = computeDerivedState([makeEvent("Completed", "completion", "info", 0)]);
      expect(state.observedStageIndices.has(3)).toBe(true);
    });

    it("does not track failure events", () => {
      const state = computeDerivedState([makeEvent("Failed", "failure", "error", 0)]);
      expect(state.observedStageIndices.size).toBe(0);
    });

    it("tracks all stages in a complete lifecycle", () => {
      const state = computeDerivedState([
        makeEvent("Scheduled", "scheduling", "info", 0),
        makeEvent("Pulling", "image", "info", 1),
        makeEvent("Started", "container", "info", 2),
        makeEvent("Completed", "completion", "info", 3),
      ]);
      expect(state.observedStageIndices.has(0)).toBe(true);
      expect(state.observedStageIndices.has(1)).toBe(true);
      expect(state.observedStageIndices.has(2)).toBe(true);
      expect(state.observedStageIndices.has(3)).toBe(true);
    });

    it("has gaps when events are missing", () => {
      // Only Running event — no Pending or Init events
      const state = computeDerivedState([makeEvent("Started", "container", "info", 0)]);
      expect(state.observedStageIndices.has(0)).toBe(false); // no Pending
      expect(state.observedStageIndices.has(1)).toBe(false); // no Init
      expect(state.observedStageIndices.has(2)).toBe(true); // Running observed
    });

    it("maps Created to init (1), not running (2)", () => {
      const state = computeDerivedState([makeEvent("Created", "container", "info", 0)]);
      expect(state.observedStageIndices.has(1)).toBe(true); // init
      expect(state.observedStageIndices.has(2)).toBe(false); // not running
    });
  });

  // ---------------------------------------------------------------------------
  // Tests: Missing events (gaps)
  // ---------------------------------------------------------------------------

  describe("missing events", () => {
    it("derives Running lifecycle from a single Started event", () => {
      const state = computeDerivedState([makeEvent("Started", "container", "info", 0)]);
      expect(state.lifecycle).toBe("Running");
      expect(state.furthestProgressIndex).toBe(2);
    });

    it("derives Done lifecycle from a single Completed event", () => {
      const state = computeDerivedState([makeEvent("Completed", "completion", "info", 0)]);
      expect(state.lifecycle).toBe("Done");
      expect(state.furthestProgressIndex).toBe(3);
    });

    it("derives Running lifecycle when only Scheduled + Started (missing image events)", () => {
      const state = computeDerivedState([
        makeEvent("Scheduled", "scheduling", "info", 0),
        makeEvent("Started", "container", "info", 5),
      ]);
      expect(state.lifecycle).toBe("Running");
      expect(state.furthestProgressIndex).toBe(2);
      // Init stage is NOT observed (no image events)
      expect(state.observedStageIndices.has(1)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Tests: Out-of-order events
  // ---------------------------------------------------------------------------

  describe("out-of-order events", () => {
    it("does not regress lifecycle when Pending event arrives after Running", () => {
      // Sorted by timestamp: Started(0), Scheduled(1), Pulling(2)
      // Last event stage is "image" (Pulling), but furthest progress is 2 (Running)
      const state = computeDerivedState([
        makeEvent("Started", "container", "info", 0),
        makeEvent("Scheduled", "scheduling", "info", 1),
        makeEvent("Pulling", "image", "info", 2),
      ]);
      expect(state.lifecycle).toBe("Running");
      expect(state.furthestProgressIndex).toBe(2);
    });

    it("does not regress lifecycle when Init event arrives after Completion", () => {
      const state = computeDerivedState([
        makeEvent("Scheduled", "scheduling", "info", 0),
        makeEvent("Completed", "completion", "info", 1),
        makeEvent("Pulling", "image", "info", 2),
      ]);
      // Last event is "image" stage, but furthest is 3 (completion)
      expect(state.lifecycle).toBe("Done");
      expect(state.furthestProgressIndex).toBe(3);
    });

    it("backfills observed stages from late-arriving events", () => {
      const state = computeDerivedState([
        makeEvent("Started", "container", "info", 0),
        makeEvent("Scheduled", "scheduling", "info", 1),
      ]);
      // Both scheduling (0) and running (2) are observed
      expect(state.observedStageIndices.has(0)).toBe(true);
      expect(state.observedStageIndices.has(2)).toBe(true);
      // Init (1) is still NOT observed
      expect(state.observedStageIndices.has(1)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Tests: lifecycle derivation
  // ---------------------------------------------------------------------------

  describe("lifecycle", () => {
    it("returns Pending for empty events", () => {
      expect(computeDerivedState([]).lifecycle).toBe("Pending");
    });

    it("returns Pending for scheduling events without Scheduled", () => {
      const state = computeDerivedState([makeEvent("FailedScheduling", "scheduling", "error", 0)]);
      expect(state.lifecycle).toBe("Pending");
    });

    it("returns Init when Scheduled (scheduling complete)", () => {
      const state = computeDerivedState([makeEvent("Scheduled", "scheduling", "info", 0)]);
      expect(state.lifecycle).toBe("Init");
    });

    it("returns Init for image-stage events", () => {
      const state = computeDerivedState([
        makeEvent("Scheduled", "scheduling", "info", 0),
        makeEvent("Pulling", "image", "info", 1),
      ]);
      expect(state.lifecycle).toBe("Init");
    });

    it("returns Running for container Started event", () => {
      const state = computeDerivedState([
        makeEvent("Scheduled", "scheduling", "info", 0),
        makeEvent("Started", "container", "info", 1),
      ]);
      expect(state.lifecycle).toBe("Running");
    });

    it("returns Done for completion events", () => {
      const state = computeDerivedState([
        makeEvent("Scheduled", "scheduling", "info", 0),
        makeEvent("Started", "container", "info", 1),
        makeEvent("Completed", "completion", "info", 2),
      ]);
      expect(state.lifecycle).toBe("Done");
    });

    it("returns Failed when last event is failure stage", () => {
      const state = computeDerivedState([
        makeEvent("Scheduled", "scheduling", "info", 0),
        makeEvent("Started", "container", "info", 1),
        makeEvent("OOMKilled", "failure", "error", 2),
      ]);
      expect(state.lifecycle).toBe("Failed");
    });

    it("returns Failed when only failure events exist", () => {
      const state = computeDerivedState([makeEvent("Failed", "failure", "error", 0)]);
      expect(state.lifecycle).toBe("Failed");
    });
  });
});
