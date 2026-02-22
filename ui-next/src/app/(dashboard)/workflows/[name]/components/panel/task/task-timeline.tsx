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

"use client";

import { memo, useMemo } from "react";
import type { TaskQueryResponse } from "@/app/(dashboard)/workflows/[name]/lib/workflow-types";
import { Timeline, type TimelinePhase } from "@/app/(dashboard)/workflows/[name]/components/panel/views/Timeline";
import {
  useTimelineSetup,
  parseCommonTimestamps,
  buildPreExecutionPhases,
  buildTerminalPhase,
  parseTime,
} from "@/app/(dashboard)/workflows/[name]/lib/timeline-utils";

interface TaskTimelineProps {
  task: TaskQueryResponse;
  showHeader?: boolean;
  headerText?: string;
}

export const TaskTimeline = memo(function TaskTimeline({ task, showHeader, headerText }: TaskTimelineProps) {
  // Set up common timeline context
  const ctx = useTimelineSetup(task.status);
  const { isRunning, isCompleted, isFailed, isPending, calculatePhaseDuration, finalizePhases } = ctx;

  // Parse common timestamps
  const timestamps = parseCommonTimestamps(task);
  const { executionStart, endTime } = timestamps;

  // Parse task-specific timestamps
  const inputDownloadStart = parseTime(task.input_download_start_time);
  const inputDownloadEnd = parseTime(task.input_download_end_time);
  const outputUploadStart = parseTime(task.output_upload_start_time);

  const phases = useMemo<TimelinePhase[]>(() => {
    // Build pre-execution phases (processing, scheduling, initializing)
    const result = buildPreExecutionPhases(timestamps, ctx);

    // Build task-specific execution phases (input download, executing, output upload)
    if (executionStart) {
      // Input download phase (optional)
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

      // Executing phase
      const execStart = inputDownloadEnd || executionStart;
      const execEnd = outputUploadStart || endTime;
      const execActive = isRunning && !execEnd;

      result.push({
        id: "executing",
        label: "Executing",
        time: inputDownloadStart ? execStart : executionStart,
        duration: calculatePhaseDuration(inputDownloadStart ? execStart : executionStart, execEnd),
        status: execActive ? "active" : execEnd ? "completed" : "pending",
      });

      // Output upload phase (optional)
      if (outputUploadStart) {
        const uploadActive = isRunning && !endTime;
        result.push({
          id: "output-upload",
          label: "Output Upload",
          time: outputUploadStart,
          duration: calculatePhaseDuration(outputUploadStart, endTime),
          status: uploadActive ? "active" : endTime ? "completed" : "pending",
        });
      }
    }

    // Build terminal phase (done or failed)
    const terminalPhase = buildTerminalPhase(endTime, { isCompleted, isFailed });
    if (terminalPhase) {
      result.push(terminalPhase);
    }

    return finalizePhases(result, endTime);
  }, [
    timestamps,
    ctx,
    executionStart,
    endTime,
    inputDownloadStart,
    inputDownloadEnd,
    outputUploadStart,
    isRunning,
    isCompleted,
    isFailed,
    calculatePhaseDuration,
    finalizePhases,
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
