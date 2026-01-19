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
 * WorkflowTimeline Component
 *
 * Displays a sequential timeline showing the workflow lifecycle phases:
 * Submitted → Started → Running/Completed/Failed
 *
 * Uses the shared Timeline component with workflow-specific phase logic.
 */

"use client";

import { memo, useMemo } from "react";
import type { WorkflowQueryResponse } from "@/lib/api/adapter";
import { STATUS_CATEGORY_MAP } from "../../../lib/status";
import { Timeline, type TimelinePhase, parseTime } from "../shared/Timeline";
import { useTick } from "@/hooks";

// ============================================================================
// Types
// ============================================================================

interface WorkflowTimelineProps {
  workflow: WorkflowQueryResponse;
}

// ============================================================================
// Component
// ============================================================================

export const WorkflowTimeline = memo(function WorkflowTimeline({ workflow }: WorkflowTimelineProps) {
  // Fallback to "waiting" (a valid key in STATUS_STYLES) if status is unknown
  const statusCategory = STATUS_CATEGORY_MAP[workflow.status] ?? "waiting";
  const isCompleted = statusCategory === "completed";
  const isFailed = statusCategory === "failed";
  const isRunning = statusCategory === "running";

  // Synchronized tick for live durations
  const now = useTick();

  // Memoize time computations to prevent dependency changes on every render
  // Timestamps are normalized in the adapter layer (useWorkflow hook)
  const submitTime = useMemo(() => parseTime(workflow.submit_time), [workflow.submit_time]);
  const startTime = useMemo(() => parseTime(workflow.start_time), [workflow.start_time]);
  const endTime = useMemo(() => parseTime(workflow.end_time), [workflow.end_time]);

  const queuedDuration = workflow.queued_time;
  const runningDuration = useMemo(() => {
    if (!startTime) return null;
    // Use synchronized tick for running workflows
    const endMs = isRunning && !endTime ? now : endTime?.getTime();
    if (!endMs) return null;
    return Math.max(0, Math.floor((endMs - startTime.getTime()) / 1000));
  }, [startTime, endTime, isRunning, now]);

  // Build phases for the Timeline component
  const phases = useMemo<TimelinePhase[]>(() => {
    const result: TimelinePhase[] = [];

    if (submitTime) {
      // Submitted phase duration = time spent queued (until started)
      result.push({
        id: "submitted",
        label: "Submitted",
        time: submitTime,
        status: "completed",
        duration: queuedDuration ?? null,
      });
    }

    if (startTime) {
      result.push({
        id: "started",
        label: "Started",
        time: startTime,
        status: "completed",
        // Only show duration if this is the last phase (completed/failed workflows)
        // For running workflows, the Running phase shows the duration instead
        duration: isRunning ? null : (runningDuration ?? null),
      });
    } else if (submitTime) {
      result.push({
        id: "started",
        label: "Started",
        time: null,
        status: "pending",
        duration: null,
      });
    }

    if (isCompleted && endTime) {
      result.push({
        id: "completed",
        label: "Completed",
        time: endTime,
        status: "completed",
        duration: null, // Terminal milestone
      });
    } else if (isFailed && endTime) {
      result.push({
        id: "failed",
        label: "Failed",
        time: endTime,
        status: "failed",
        duration: null, // Terminal milestone
      });
    } else if (isRunning && startTime) {
      result.push({
        id: "running",
        label: "Running",
        time: null,
        status: "active",
        duration: runningDuration ?? null, // Shows the running duration
      });
    }

    return result;
  }, [submitTime, startTime, endTime, queuedDuration, runningDuration, isCompleted, isFailed, isRunning]);

  if (phases.length === 0) return null;

  return <Timeline phases={phases} />;
});
