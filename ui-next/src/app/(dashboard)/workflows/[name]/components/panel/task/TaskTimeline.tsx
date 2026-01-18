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
    inputDownloadStart,
    inputDownloadEnd,
    processingStart,
    startTime,
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
