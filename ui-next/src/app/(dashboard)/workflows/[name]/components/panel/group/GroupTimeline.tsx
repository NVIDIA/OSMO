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
 * GroupTimeline Component
 *
 * Displays a sequential timeline showing the group lifecycle phases.
 *
 * Backend status progression:
 *   WAITING → PROCESSING → SCHEDULING → INITIALIZING → RUNNING → COMPLETED/FAILED
 *
 * Timeline phases shown:
 *   Processing → Scheduling → Initializing → Executing → Done/Failed
 *
 * Uses the shared Timeline component with group-specific phase logic.
 */

"use client";

import { memo, useMemo } from "react";
import type { GroupWithLayout } from "../../../lib/workflow-types";
import { getStatusCategory } from "../../../lib/status";
import {
  Timeline,
  type TimelinePhase,
  parseTime,
  createPhaseDurationCalculator,
  finalizeTimelinePhases,
} from "../shared/Timeline";
import { useTick } from "@/hooks";

// ============================================================================
// Types
// ============================================================================

interface GroupTimelineProps {
  group: GroupWithLayout;
}

// ============================================================================
// Component
// ============================================================================

export const GroupTimeline = memo(function GroupTimeline({ group }: GroupTimelineProps) {
  const statusCategory = getStatusCategory(group.status);
  const isCompleted = statusCategory === "completed";
  const isFailed = statusCategory === "failed";
  const isRunning = statusCategory === "running";
  const isPending = statusCategory === "waiting";

  // Synchronized tick for live durations
  const now = useTick();
  const calculatePhaseDuration = createPhaseDurationCalculator(now);

  // Parse timestamps (normalized in adapter layer)
  // Canonical order from backend (see external/src/service/core/workflow/objects.py):
  //   1. processing_start_time (PROCESSING - queue processing)
  //   2. scheduling_start_time (SCHEDULING - placing on node, earliest among tasks)
  //   3. initializing_start_time (INITIALIZING - container startup, earliest among tasks)
  //   4. start_time (RUNNING - execution begins, earliest among tasks)
  //   5. end_time (COMPLETED/FAILED, latest among tasks)
  //
  // Backend stores these in the `groups` table, set when group status changes.
  // For groups, these represent when the group entered each phase (when first task did).
  const processingStart = parseTime(group.processing_start_time);
  const schedulingStart = parseTime(group.scheduling_start_time);
  const initializingStart = parseTime(group.initializing_start_time);
  const executionStart = parseTime(group.start_time); // When RUNNING status begins
  const endTime = parseTime(group.end_time);

  // Compute phases for the Timeline component
  const phases = useMemo<TimelinePhase[]>(() => {
    const result: TimelinePhase[] = [];

    // 1. Processing phase (queue processing - first step)
    if (processingStart) {
      const procEnd = schedulingStart || initializingStart || executionStart;
      result.push({
        id: "processing",
        label: "Processing",
        time: processingStart,
        duration: calculatePhaseDuration(processingStart, procEnd),
        status: procEnd ? "completed" : "active",
      });
    }

    // 2. Scheduling phase (placing on node)
    if (schedulingStart) {
      const schedEnd = initializingStart || executionStart;
      result.push({
        id: "scheduling",
        label: "Scheduling",
        time: schedulingStart,
        duration: calculatePhaseDuration(schedulingStart, schedEnd),
        status: schedEnd ? "completed" : "active",
      });
    }

    // 3. Initializing phase (container startup)
    if (initializingStart) {
      const initEnd = executionStart;
      const initActive = !initEnd && isRunning;
      result.push({
        id: "initializing",
        label: "Initializing",
        time: initializingStart,
        duration: calculatePhaseDuration(initializingStart, initEnd),
        status: initActive ? "active" : initEnd ? "completed" : "pending",
      });
    }

    // 4. Executing phase (from start_time to end_time)
    if (executionStart) {
      const isActive = isRunning && !endTime;
      result.push({
        id: "executing",
        label: "Executing",
        time: executionStart,
        duration: calculatePhaseDuration(executionStart, endTime),
        status: isActive ? "active" : endTime ? "completed" : "pending",
      });
    }

    // 5. Terminal phases: only for completed/failed groups
    if ((isCompleted || isFailed) && endTime) {
      result.push({
        id: isFailed ? "failed" : "done",
        label: isFailed ? "Failed" : "Done",
        time: endTime,
        duration: null, // Terminal phases are instantaneous milestones
        status: isFailed ? "failed" : "completed",
      });
    }

    // Finalize: sort and recalculate durations/statuses
    return finalizeTimelinePhases(result, {
      calculatePhaseDuration,
      endTime,
      isRunning,
      isCompleted,
      isFailed,
    });
  }, [
    processingStart,
    schedulingStart,
    initializingStart,
    executionStart,
    endTime,
    isRunning,
    isCompleted,
    isFailed,
    calculatePhaseDuration,
  ]);

  return (
    <Timeline
      phases={phases}
      emptyMessage={isPending ? "Waiting for upstream dependencies" : undefined}
    />
  );
});
