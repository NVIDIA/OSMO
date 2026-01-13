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
import type { GroupWithLayout } from "../../lib/workflow-types";
import { getStatusCategory } from "../../lib/status";
import { Timeline, type TimelinePhase } from "./Timeline";

// ============================================================================
// Types
// ============================================================================

interface GroupTimelineProps {
  group: GroupWithLayout;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse timestamp string to Date.
 * Timestamps are normalized in the adapter layer (useWorkflow hook),
 * so we can safely use new Date() directly.
 */
function parseTime(timeStr?: string | null): Date | null {
  if (!timeStr) return null;
  return new Date(timeStr);
}

function calculatePhaseDuration(start: Date | null, end: Date | null): number | null {
  if (!start) return null;
  const endTime = end || new Date();
  return Math.floor((endTime.getTime() - start.getTime()) / 1000);
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

    // Sort phases by start time to ensure chronological order
    result.sort((a, b) => {
      if (!a.time) return 1; // Phases without start time go to the end
      if (!b.time) return -1;
      return a.time.getTime() - b.time.getTime();
    });

    // Recalculate duration and status to ensure contiguous segments
    for (let i = 0; i < result.length; i++) {
      const phase = result[i];
      const nextPhase = result[i + 1];
      const isLastPhase = i === result.length - 1;

      if (nextPhase?.time) {
        // This phase ends when the next phase starts
        const rawDuration = calculatePhaseDuration(phase.time, nextPhase.time);
        phase.duration = rawDuration !== null ? Math.max(1, rawDuration) : null;
        // Any phase followed by another phase is completed
        phase.status = "completed";
      } else if (isLastPhase) {
        // Last phase: ends at group end time (for completed/failed) or now (for running)
        const rawDuration = calculatePhaseDuration(phase.time, endTime);
        phase.duration = rawDuration !== null ? Math.max(1, rawDuration) : null;
        // Last phase status depends on group state
        if (isRunning && !endTime) {
          phase.status = "active";
        } else if (endTime) {
          phase.status = isCompleted ? "completed" : isFailed ? "failed" : "completed";
        }
      }
    }

    return result;
  }, [schedulingStart, initializingStart, processingStart, startTime, endTime, isRunning, isCompleted, isFailed]);

  return (
    <Timeline
      phases={phases}
      emptyMessage={isPending ? "Waiting for upstream dependencies" : undefined}
    />
  );
});
