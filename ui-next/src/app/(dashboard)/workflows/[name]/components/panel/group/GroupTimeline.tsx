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
 * Displays a sequential timeline showing the group lifecycle phases:
 * Scheduled → Initializing → Processing → Done/Failed
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
  const schedulingStart = parseTime(group.scheduling_start_time);
  const initializingStart = parseTime(group.initializing_start_time);
  const processingStart = parseTime(group.processing_start_time);
  const startTime = parseTime(group.start_time);
  const endTime = parseTime(group.end_time);

  // Compute phases for the Timeline component
  const phases = useMemo<TimelinePhase[]>(() => {
    const result: TimelinePhase[] = [];

    // Scheduling phase (from scheduling_start to initializing_start or processing_start)
    if (schedulingStart) {
      const schedEnd = initializingStart || processingStart || startTime;
      result.push({
        id: "scheduling",
        label: "Scheduling",
        time: schedulingStart,
        duration: calculatePhaseDuration(schedulingStart, schedEnd),
        status: schedEnd ? "completed" : "active",
      });
    }

    // Initializing phase (from initializing_start to processing_start or start_time)
    if (initializingStart) {
      const initEnd = processingStart || startTime;
      const initActive = !initEnd && !processingStart && isRunning;
      result.push({
        id: "initializing",
        label: "Initializing",
        time: initializingStart,
        duration: calculatePhaseDuration(initializingStart, initEnd),
        status: initActive ? "active" : initEnd ? "completed" : "pending",
      });
    }

    // Processing phase (from processing_start or start_time to end_time)
    const procStart = processingStart || startTime;
    if (procStart) {
      const isActive = isRunning && !endTime;
      result.push({
        id: "processing",
        label: "Processing",
        time: procStart,
        duration: calculatePhaseDuration(procStart, endTime),
        status: isActive ? "active" : endTime ? "completed" : "pending",
      });
    }

    // Add current state phase (running, completed, or failed)
    if ((isCompleted || isFailed) && endTime) {
      result.push({
        id: isFailed ? "failed" : "done",
        label: isFailed ? "Failed" : "Done",
        time: endTime,
        duration: null, // Terminal phases are instantaneous milestones
        status: isFailed ? "failed" : "completed",
      });
    } else if (isRunning) {
      result.push({
        id: "running",
        label: "Running",
        time: null,
        status: "active",
        duration: null,
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
    schedulingStart,
    initializingStart,
    processingStart,
    startTime,
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
