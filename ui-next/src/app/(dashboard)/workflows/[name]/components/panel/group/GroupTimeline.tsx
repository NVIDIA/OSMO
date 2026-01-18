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

interface GroupTimelineProps {
  group: GroupWithLayout;
}

export const GroupTimeline = memo(function GroupTimeline({ group }: GroupTimelineProps) {
  const statusCategory = getStatusCategory(group.status);
  const isCompleted = statusCategory === "completed";
  const isFailed = statusCategory === "failed";
  const isRunning = statusCategory === "running";
  const isPending = statusCategory === "waiting";

  const now = useTick();
  const calculatePhaseDuration = createPhaseDurationCalculator(now);

  // Timestamps follow backend canonical order (see objects.py)
  const processingStart = parseTime(group.processing_start_time);
  const schedulingStart = parseTime(group.scheduling_start_time);
  const initializingStart = parseTime(group.initializing_start_time);
  const executionStart = parseTime(group.start_time);
  const endTime = parseTime(group.end_time);

  const phases = useMemo<TimelinePhase[]>(() => {
    const result: TimelinePhase[] = [];

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

    if ((isCompleted || isFailed) && endTime) {
      result.push({
        id: isFailed ? "failed" : "done",
        label: isFailed ? "Failed" : "Done",
        time: endTime,
        duration: null,
        status: isFailed ? "failed" : "completed",
      });
    }

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
