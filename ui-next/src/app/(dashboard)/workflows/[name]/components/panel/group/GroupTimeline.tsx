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
import type { GroupWithLayout } from "@/app/(dashboard)/workflows/[name]/lib/workflow-types";
import { Timeline, type TimelinePhase } from "@/app/(dashboard)/workflows/[name]/components/panel/views/Timeline";
import {
  useTimelineSetup,
  parseCommonTimestamps,
  buildPreExecutionPhases,
  buildTerminalPhase,
} from "@/app/(dashboard)/workflows/[name]/lib/timeline-utils";

interface GroupTimelineProps {
  group: GroupWithLayout;
}

export const GroupTimeline = memo(function GroupTimeline({ group }: GroupTimelineProps) {
  // Set up common timeline context
  const ctx = useTimelineSetup(group.status);
  const { isRunning, isCompleted, isFailed, isPending, calculatePhaseDuration, finalizePhases } = ctx;

  // Parse timestamps (common to groups and tasks)
  const timestamps = parseCommonTimestamps(group);
  const { executionStart, endTime } = timestamps;

  const phases = useMemo<TimelinePhase[]>(() => {
    // Build pre-execution phases (processing, scheduling, initializing)
    const result = buildPreExecutionPhases(timestamps, ctx);

    // Build group-specific executing phase
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
    isRunning,
    isCompleted,
    isFailed,
    calculatePhaseDuration,
    finalizePhases,
  ]);

  return (
    <Timeline
      phases={phases}
      emptyMessage={isPending ? "Waiting for upstream dependencies" : undefined}
    />
  );
});
