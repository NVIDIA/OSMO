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
 * Timeline Utilities
 *
 * Shared utilities for building timeline phases in GroupTimeline and TaskTimeline.
 * Consolidates common patterns to reduce duplication.
 */

import { useTick } from "@/hooks/use-tick";
import { getStatusCategory } from "./status";
import {
  type TimelinePhase,
  parseTime,
  createPhaseDurationCalculator,
  finalizeTimelinePhases,
  type TimelineFinalizeContext,
} from "../components/panel/views/Timeline";

/**
 * Status flags derived from a status string.
 */
export interface StatusFlags {
  isCompleted: boolean;
  isFailed: boolean;
  isRunning: boolean;
  isPending: boolean;
}

/**
 * Derive status flags from a status string.
 */
export function getStatusFlags(status: string): StatusFlags {
  const category = getStatusCategory(status);
  return {
    isCompleted: category === "completed",
    isFailed: category === "failed",
    isRunning: category === "running",
    isPending: category === "waiting",
  };
}

/**
 * Timeline context provided by useTimelineSetup hook.
 */
export interface TimelineSetupContext extends StatusFlags {
  /** Synchronized tick for live durations */
  now: number;
  /** Calculate duration between two dates using the synchronized tick */
  calculatePhaseDuration: (start: Date | null, end: Date | null) => number | null;
  /** Finalize phases array with proper status and duration calculations */
  finalizePhases: (phases: TimelinePhase[], endTime: Date | null) => TimelinePhase[];
}

/**
 * Hook to set up common timeline context.
 *
 * Provides:
 * - Status flags (isCompleted, isFailed, isRunning, isPending)
 * - Synchronized tick for live durations
 * - Phase duration calculator
 * - Phase finalizer function
 *
 * @param status - The status string (e.g., TaskGroupStatus value)
 * @returns Timeline setup context
 */
export function useTimelineSetup(status: string): TimelineSetupContext {
  const flags = getStatusFlags(status);
  const now = useTick();
  const calculatePhaseDuration = createPhaseDurationCalculator(now);

  const finalizePhases = (phases: TimelinePhase[], endTime: Date | null): TimelinePhase[] => {
    const ctx: TimelineFinalizeContext = {
      calculatePhaseDuration,
      endTime,
      isRunning: flags.isRunning,
      isCompleted: flags.isCompleted,
      isFailed: flags.isFailed,
    };
    return finalizeTimelinePhases(phases, ctx);
  };

  return {
    ...flags,
    now,
    calculatePhaseDuration,
    finalizePhases,
  };
}

/**
 * Common timestamps found in both groups and tasks.
 */
export interface CommonTimestamps {
  processingStart: Date | null;
  schedulingStart: Date | null;
  initializingStart: Date | null;
  executionStart: Date | null;
  endTime: Date | null;
}

/**
 * Parse common timestamps from a group or task object.
 *
 * @param obj - Object with timestamp properties
 * @returns Parsed common timestamps
 */
export function parseCommonTimestamps(obj: {
  processing_start_time?: string | null;
  scheduling_start_time?: string | null;
  initializing_start_time?: string | null;
  start_time?: string | null;
  end_time?: string | null;
}): CommonTimestamps {
  return {
    processingStart: parseTime(obj.processing_start_time),
    schedulingStart: parseTime(obj.scheduling_start_time),
    initializingStart: parseTime(obj.initializing_start_time),
    executionStart: parseTime(obj.start_time),
    endTime: parseTime(obj.end_time),
  };
}

/**
 * Build phases for the common pre-execution stages (processing, scheduling, initializing).
 *
 * These phases are identical between groups and tasks.
 *
 * @param timestamps - Parsed common timestamps
 * @param ctx - Timeline setup context
 * @returns Array of pre-execution phases
 */
export function buildPreExecutionPhases(
  timestamps: CommonTimestamps,
  ctx: Pick<TimelineSetupContext, "calculatePhaseDuration" | "isRunning">,
): TimelinePhase[] {
  const { processingStart, schedulingStart, initializingStart, executionStart } = timestamps;
  const { calculatePhaseDuration, isRunning } = ctx;
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

  return result;
}

/**
 * Build the terminal phase (done or failed) if applicable.
 *
 * @param endTime - The end time of the entity
 * @param flags - Status flags
 * @returns Terminal phase or null
 */
export function buildTerminalPhase(
  endTime: Date | null,
  flags: Pick<StatusFlags, "isCompleted" | "isFailed">,
): TimelinePhase | null {
  const { isCompleted, isFailed } = flags;

  if ((isCompleted || isFailed) && endTime) {
    return {
      id: isFailed ? "failed" : "done",
      label: isFailed ? "Failed" : "Done",
      time: endTime,
      duration: null,
      status: isFailed ? "failed" : "completed",
    };
  }

  return null;
}

// Re-export parseTime for convenience
export { parseTime };
