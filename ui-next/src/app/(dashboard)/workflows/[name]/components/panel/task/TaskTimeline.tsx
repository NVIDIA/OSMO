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
 * Displays a sequential timeline showing the task lifecycle phases.
 *
 * Backend status progression:
 *   WAITING → PROCESSING → SCHEDULING → INITIALIZING → RUNNING → COMPLETED/FAILED
 *
 * Timeline phases shown:
 *   Scheduling → Initializing → Executing → Done/Failed
 *
 * Note: Input Download and Output Upload happen DURING the Executing phase
 * (between start_time and end_time), so they are shown as sub-phases when
 * their timestamps are available.
 *
 * Uses the shared Timeline component with task-specific phase logic.
 */

"use client";

import { memo, useMemo } from "react";
import type { TaskQueryResponse } from "../../../lib/workflow-types";
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

interface TaskTimelineProps {
  task: TaskQueryResponse;
  /** Whether to show a header above the timeline */
  showHeader?: boolean;
  /** Custom header text (default: "Timeline") */
  headerText?: string;
}

// ============================================================================
// Component
// ============================================================================

export const TaskTimeline = memo(function TaskTimeline({ task, showHeader, headerText }: TaskTimelineProps) {
  const statusCategory = getStatusCategory(task.status);
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
  //      NOTE: This comes from the GROUP, not the task itself!
  //      (backend line 1067: processing_start_time=group_row['processing_start_time'])
  //      All tasks in a group share the same processing_start_time.
  //   2. scheduling_start_time (SCHEDULING - placing on node, task-level)
  //   3. initializing_start_time (INITIALIZING - container startup, task-level)
  //   4. start_time (RUNNING - execution begins, task-level)
  //   5. input_download_start_time/end_time (during RUNNING)
  //   6. output_upload_start_time (during RUNNING)
  //   7. end_time (COMPLETED/FAILED)
  const processingStart = parseTime(task.processing_start_time);
  const schedulingStart = parseTime(task.scheduling_start_time);
  const initializingStart = parseTime(task.initializing_start_time);
  const executionStart = parseTime(task.start_time); // When RUNNING status begins
  const inputDownloadStart = parseTime(task.input_download_start_time);
  const inputDownloadEnd = parseTime(task.input_download_end_time);
  const outputUploadStart = parseTime(task.output_upload_start_time);
  const endTime = parseTime(task.end_time);

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

    // 4. Executing phase (RUNNING status - encompasses input download, user code, output upload)
    // If we have sub-phase timestamps, show them; otherwise show just "Executing"
    if (executionStart) {
      // If input download timestamp exists, show it as first sub-phase of execution
      if (inputDownloadStart) {
        const dlEnd = inputDownloadEnd || outputUploadStart || endTime;
        const dlActive = isRunning && !dlEnd;
        result.push({
          id: "input-download",
          label: "Input Download",
          time: inputDownloadStart,
          duration: calculatePhaseDuration(inputDownloadStart, dlEnd),
          status: dlActive ? "active" : dlEnd ? "completed" : "pending",
        });
      }

      // Main executing phase - only show if no sub-phases, or as the "user code" phase
      // Calculate the execution period (after input download, before output upload)
      const execStart = inputDownloadEnd || executionStart;
      const execEnd = outputUploadStart || endTime;
      const execActive = isRunning && !execEnd;

      // Only show "Executing" label if we don't have input download (otherwise it's implicit)
      if (!inputDownloadStart) {
        result.push({
          id: "executing",
          label: "Executing",
          time: executionStart,
          duration: calculatePhaseDuration(executionStart, execEnd),
          status: execActive ? "active" : execEnd ? "completed" : "pending",
        });
      } else {
        // We have input download, so show "Running" as the user code phase
        result.push({
          id: "executing",
          label: "Executing",
          time: execStart,
          duration: calculatePhaseDuration(execStart, execEnd),
          status: execActive ? "active" : execEnd ? "completed" : "pending",
        });
      }

      // 5. Output Upload phase (during execution, before end)
      if (outputUploadStart) {
        const uploadEnd = endTime;
        const uploadActive = isRunning && !uploadEnd;
        result.push({
          id: "output-upload",
          label: "Output Upload",
          time: outputUploadStart,
          duration: calculatePhaseDuration(outputUploadStart, uploadEnd),
          status: uploadActive ? "active" : uploadEnd ? "completed" : "pending",
        });
      }
    }

    // 6. Terminal phases: only for completed/failed tasks
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
    inputDownloadStart,
    inputDownloadEnd,
    outputUploadStart,
    endTime,
    isRunning,
    isCompleted,
    isFailed,
    calculatePhaseDuration,
  ]);

  return (
    <Timeline
      phases={phases}
      emptyMessage={isPending ? "Waiting to be scheduled" : undefined}
      showHeader={showHeader}
      headerText={headerText}
    />
  );
});
