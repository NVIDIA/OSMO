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
 * Scheduled → Initializing → Processing → Done/Failed
 *
 * Similar to GroupTimeline but uses TaskQueryResponse fields.
 */

"use client";

import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/shadcn/tooltip";
import type { TaskQueryResponse } from "../../../workflow-types";
import { getStatusCategory } from "../../utils/status";
import { formatDuration } from "../../../workflow-types";

// ============================================================================
// Types
// ============================================================================

interface TaskTimelineProps {
  task: TaskQueryResponse;
}

interface TimelinePhase {
  id: string;
  label: string;
  shortLabel: string;
  startTime: Date | null;
  endTime: Date | null;
  duration: number | null;
  status: "completed" | "active" | "pending";
}

// ============================================================================
// Helper Functions
// ============================================================================

function parseTime(timeStr?: string | null): Date | null {
  if (!timeStr) return null;
  return new Date(timeStr);
}

function formatTimeFull(date: Date | null): string {
  if (!date) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function calculatePhaseDuration(start: Date | null, end: Date | null): number | null {
  if (!start) return null;
  const endTime = end || new Date();
  return Math.floor((endTime.getTime() - start.getTime()) / 1000);
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

  // Parse timestamps
  const schedulingStart = parseTime(task.scheduling_start_time);
  const initializingStart = parseTime(task.initializing_start_time);
  const inputDownloadStart = parseTime(task.input_download_start_time);
  const inputDownloadEnd = parseTime(task.input_download_end_time);
  const processingStart = parseTime(task.processing_start_time);
  const startTime = parseTime(task.start_time);
  const outputUploadStart = parseTime(task.output_upload_start_time);
  const endTime = parseTime(task.end_time);

  // Compute phases
  const phases = useMemo<TimelinePhase[]>(() => {
    const result: TimelinePhase[] = [];

    // Scheduling phase
    if (schedulingStart) {
      const schedEnd = initializingStart || inputDownloadStart || processingStart || startTime;
      result.push({
        id: "scheduling",
        label: "Scheduling",
        shortLabel: "Sched",
        startTime: schedulingStart,
        endTime: schedEnd,
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
        shortLabel: "Init",
        startTime: initializingStart,
        endTime: initEnd,
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
        shortLabel: "Input",
        startTime: inputDownloadStart,
        endTime: dlEnd,
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
        shortLabel: "Proc",
        startTime: procStart,
        endTime: procEnd,
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
        shortLabel: "Output",
        startTime: outputUploadStart,
        endTime: uploadEnd,
        duration: calculatePhaseDuration(outputUploadStart, uploadEnd),
        status: uploadActive ? "active" : uploadEnd ? "completed" : "pending",
      });
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
  ]);

  // No timeline data
  if (phases.length === 0) {
    if (isPending) {
      return (
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-zinc-500">
          <span className="inline-block size-2 rounded-full border border-dashed border-gray-400 dark:border-zinc-600" />
          <span>Waiting to be scheduled</span>
        </div>
      );
    }
    return null;
  }

  // Build accessible description
  const accessibleDescription = phases
    .map((phase) => {
      const time = phase.startTime ? formatTimeFull(phase.startTime) : "";
      const dur = phase.duration !== null ? formatDuration(phase.duration) : "";
      return `${phase.label}: ${phase.status}${dur ? `, ${dur}` : ""}${time ? ` (${time})` : ""}`;
    })
    .join(". ");

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-1">
        {/* Screen reader description */}
        <div
          className="sr-only"
          role="img"
          aria-label={`Timeline: ${accessibleDescription}`}
        >
          {accessibleDescription}
        </div>

        {/* Timeline visualization */}
        <div
          className="relative"
          aria-hidden="true"
        >
          {/* Timeline bar */}
          <div className="flex h-6 items-center gap-0">
            {phases.map((phase, index) => {
              const isLast = index === phases.length - 1;
              const showEndMarker = isLast && (isCompleted || isFailed);
              const markerLabel = `${phase.label}${phase.startTime ? `: ${formatTimeFull(phase.startTime)}` : ""}`;
              const phaseDuration = phase.duration ?? 1;

              return (
                <div
                  key={phase.id}
                  className="flex items-center"
                  style={{
                    flex: phaseDuration,
                    minWidth: "3.5rem",
                  }}
                >
                  {/* Start marker with tooltip */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={markerLabel}
                        className={cn(
                          "relative z-10 size-2.5 shrink-0 cursor-help rounded-full border-2 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:ring-offset-white focus:outline-none dark:focus:ring-offset-zinc-900",
                          phase.status === "completed" && "timeline-marker-completed",
                          phase.status === "active" && "timeline-marker-running animate-pulse",
                          phase.status === "pending" && "timeline-marker-pending border-dashed",
                        )}
                      />
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      className="text-xs"
                    >
                      <div className="font-medium">{phase.label}</div>
                      {phase.startTime && (
                        <div className="text-gray-500 dark:text-zinc-400">{formatTimeFull(phase.startTime)}</div>
                      )}
                    </TooltipContent>
                  </Tooltip>

                  {/* Segment */}
                  <div
                    className={cn(
                      "h-1 flex-1",
                      phase.status === "completed" && "timeline-segment-completed",
                      phase.status === "active" && "timeline-active-segment",
                      phase.status === "pending" && "border-t border-dashed border-gray-400 dark:border-zinc-600",
                    )}
                  />

                  {/* End marker (only for last phase) */}
                  {showEndMarker && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={`${isCompleted ? "Completed" : "Failed"}${endTime ? `: ${formatTimeFull(endTime)}` : ""}`}
                          className={cn(
                            "relative z-10 size-2.5 shrink-0 cursor-help rounded-full border-2 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:ring-offset-white focus:outline-none dark:focus:ring-offset-zinc-900",
                            isCompleted && "timeline-marker-completed",
                            isFailed && "timeline-marker-failed",
                          )}
                        />
                      </TooltipTrigger>
                      <TooltipContent
                        side="top"
                        className="text-xs"
                      >
                        <div className="font-medium">{isCompleted ? "Completed" : "Failed"}</div>
                        {endTime && <div className="text-gray-500 dark:text-zinc-400">{formatTimeFull(endTime)}</div>}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              );
            })}

            {/* Running indicator */}
            {isRunning && (
              <div
                className="timeline-marker-running relative z-10 size-2.5 shrink-0 animate-pulse rounded-full border-2"
                aria-hidden="true"
              />
            )}
          </div>

          {/* Phase labels */}
          <div className="mt-1 flex gap-0">
            {phases.map((phase, index) => {
              const isLast = index === phases.length - 1;
              const phaseDuration = phase.duration ?? 1;
              return (
                <div
                  key={`${phase.id}-label`}
                  className="flex flex-col"
                  style={{
                    flex: phaseDuration,
                    minWidth: "3.5rem",
                  }}
                >
                  <span
                    className={cn(
                      "text-[10px] font-medium",
                      phase.status === "completed" && "timeline-text-completed",
                      phase.status === "active" && "timeline-text-running",
                      phase.status === "pending" && "timeline-text-pending",
                    )}
                  >
                    {phase.shortLabel}
                  </span>
                  {phase.duration !== null && (
                    <span
                      className={cn(
                        "text-[10px] opacity-70",
                        phase.status === "active" ? "timeline-text-running" : "timeline-text-pending",
                      )}
                    >
                      {formatDuration(phase.duration)}
                      {phase.status === "active" && "..."}
                    </span>
                  )}
                  {isLast && (isCompleted || isFailed) && (
                    <span
                      className={cn(
                        "absolute right-0 text-[10px] font-medium",
                        isCompleted && "timeline-text-completed",
                        isFailed && "timeline-text-failed",
                      )}
                    >
                      {isCompleted ? "Done" : "Failed"}
                    </span>
                  )}
                </div>
              );
            })}
            {isRunning && (
              <div className="flex flex-col">
                <span className="timeline-text-running text-[10px] font-medium">now</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
});
