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
 * TaskTimeline Component
 *
 * Displays a sequential timeline showing the task lifecycle phases:
 * Scheduled → Initializing → Input Download → Processing → Output Upload → Done/Failed
 *
 * Uses the shared Timeline component with task-specific phase logic.
 */

"use client";

import { memo, useMemo } from "react";
import type { TaskQueryResponse } from "../../lib/workflow-types";
import { getStatusCategory } from "../../lib/status";
import { Timeline, type TimelinePhase } from "./Timeline";

// ============================================================================
// Types
// ============================================================================

interface TaskTimelineProps {
  task: TaskQueryResponse;
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
  const duration = Math.floor((endTime.getTime() - start.getTime()) / 1000);
  // Never return negative durations (can happen with clock skew or out-of-order timestamps)
  return Math.max(0, duration);
}

// ============================================================================
// Component
// ============================================================================

export const TaskTimeline = memo(function TaskTimeline({ task }: TaskTimelineProps) {
  const statusCategory = getStatusCategory(task.status);
  const isCompleted = statusCategory === "completed";
  const isFailed = statusCategory === "failed";
  const isRunning = statusCategory === "running";
  const isPending = statusCategory === "waiting";

  // Parse timestamps (normalized in adapter layer)
  const schedulingStart = parseTime(task.scheduling_start_time);
  const initializingStart = parseTime(task.initializing_start_time);
  const inputDownloadStart = parseTime(task.input_download_start_time);
  const inputDownloadEnd = parseTime(task.input_download_end_time);
  const processingStart = parseTime(task.processing_start_time);
  const startTime = parseTime(task.start_time);
  const outputUploadStart = parseTime(task.output_upload_start_time);
  const endTime = parseTime(task.end_time);

  // Compute phases for the Timeline component
  const phases = useMemo<TimelinePhase[]>(() => {
    const result: TimelinePhase[] = [];

    // Scheduling phase
    if (schedulingStart) {
      const schedEnd = initializingStart || inputDownloadStart || processingStart || startTime;
      result.push({
        id: "scheduling",
        label: "Scheduling",
        time: schedulingStart,
        duration: calculatePhaseDuration(schedulingStart, schedEnd),
        status: schedEnd ? "completed" : "active",
      });
    }

    // Initializing phase
    if (initializingStart) {
      const initEnd = inputDownloadStart || processingStart || startTime;
      const initActive = !initEnd && isRunning;
      result.push({
        id: "initializing",
        label: "Initializing",
        time: initializingStart,
        duration: calculatePhaseDuration(initializingStart, initEnd),
        status: initActive ? "active" : initEnd ? "completed" : "pending",
      });
    }

    // Input Download phase
    if (inputDownloadStart) {
      const dlEnd = inputDownloadEnd || processingStart || startTime;
      const dlActive = !dlEnd && isRunning;
      result.push({
        id: "input-download",
        label: "Input Download",
        time: inputDownloadStart,
        duration: calculatePhaseDuration(inputDownloadStart, dlEnd),
        status: dlActive ? "active" : dlEnd ? "completed" : "pending",
      });
    }

    // Processing phase
    const procStart = processingStart || startTime;
    if (procStart) {
      const procEnd = outputUploadStart || endTime;
      const isActive = isRunning && !procEnd;
      result.push({
        id: "processing",
        label: "Processing",
        time: procStart,
        duration: calculatePhaseDuration(procStart, procEnd),
        status: isActive ? "active" : procEnd ? "completed" : "pending",
      });
    }

    // Output Upload phase
    if (outputUploadStart) {
      const uploadEnd = endTime;
      const uploadActive = !uploadEnd && isRunning;
      result.push({
        id: "output-upload",
        label: "Output Upload",
        time: outputUploadStart,
        duration: calculatePhaseDuration(outputUploadStart, uploadEnd),
        status: uploadActive ? "active" : uploadEnd ? "completed" : "pending",
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

    // Sort phases by start time to ensure chronological order
    result.sort((a, b) => {
      if (!a.time) return 1; // Phases without start time go to the end
      if (!b.time) return -1;
      return a.time.getTime() - b.time.getTime();
    });

    // Recalculate duration and status to ensure contiguous segments
    // Each phase's end time should be the next phase's start time
    for (let i = 0; i < result.length; i++) {
      const phase = result[i];
      const nextPhase = result[i + 1];
      const prevPhase = result[i - 1];
      const isLastPhase = i === result.length - 1;
      // Check if next phase is a terminal indicator (no time, just state)
      const nextIsTerminal = nextPhase && !nextPhase.time;

      if (nextPhase?.time) {
        // This phase ends when the next phase starts - recalculate duration
        const rawDuration = calculatePhaseDuration(phase.time, nextPhase.time);
        phase.duration = rawDuration !== null ? Math.max(1, rawDuration) : null;
        // Any phase followed by another phase is completed
        phase.status = "completed";
      } else if (nextIsTerminal) {
        // Work phase followed by terminal indicator (Running/Done/Failed)
        // Don't show duration here - the terminal phase shows it to avoid redundancy
        phase.duration = null;
        phase.status = "completed";
      } else if (isLastPhase) {
        // Terminal phases (done/failed/running) are state indicators
        const isTerminalPhase = phase.id === "done" || phase.id === "failed" || phase.id === "running";
        if (isTerminalPhase) {
          // For "running" state: calculate duration from previous phase start to now
          // This gives it proportional visual weight representing "running for X time"
          if (phase.id === "running" && prevPhase?.time) {
            phase.duration = calculatePhaseDuration(prevPhase.time, null);
          } else {
            // Done/Failed are instantaneous milestones
            phase.duration = null;
          }
        } else {
          // Last work phase (no terminal after): ends at task end time or now
          const rawDuration = calculatePhaseDuration(phase.time, endTime);
          phase.duration = rawDuration !== null ? Math.max(1, rawDuration) : null;
        }
        // Last phase status depends on task state
        if (isRunning && !endTime) {
          phase.status = "active";
        } else if (endTime) {
          phase.status = isCompleted ? "completed" : isFailed ? "failed" : "completed";
        }
      }
    }

    return result;
  }, [
    schedulingStart,
    initializingStart,
    inputDownloadStart,
    inputDownloadEnd,
    processingStart,
    startTime,
    outputUploadStart,
    endTime,
    isRunning,
    isCompleted,
    isFailed,
  ]);

  return (
    <Timeline
      phases={phases}
      emptyMessage={isPending ? "Waiting to be scheduled" : undefined}
    />
  );
});
