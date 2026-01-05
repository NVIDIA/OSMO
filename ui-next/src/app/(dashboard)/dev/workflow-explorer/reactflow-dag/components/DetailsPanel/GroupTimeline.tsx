// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * GroupTimeline Component
 *
 * Displays a sequential timeline showing the group lifecycle phases:
 * Scheduled → Initializing → Processing → Done/Failed
 *
 * Visual states:
 * - Completed phases: solid segments with checkmarks
 * - Active phase: pulsing/animated segment
 * - Future phases: dotted segments
 * - Failed: red X marker at failure point
 */

"use client";

import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/shadcn/tooltip";
import type { GroupWithLayout } from "../../../workflow-types";
import { getStatusCategory } from "../../utils/status";
import { formatDuration } from "../../../workflow-types";

// ============================================================================
// Types
// ============================================================================

interface GroupTimelineProps {
  group: GroupWithLayout;
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

export const GroupTimeline = memo(function GroupTimeline({ group }: GroupTimelineProps) {
  const statusCategory = getStatusCategory(group.status);
  const isCompleted = statusCategory === "completed";
  const isFailed = statusCategory === "failed";
  const isRunning = statusCategory === "running";
  const isPending = statusCategory === "waiting";

  // Parse timestamps
  const schedulingStart = parseTime(group.scheduling_start_time);
  const initializingStart = parseTime(group.initializing_start_time);
  const processingStart = parseTime(group.processing_start_time);
  const startTime = parseTime(group.start_time);
  const endTime = parseTime(group.end_time);

  // Compute phases
  const phases = useMemo<TimelinePhase[]>(() => {
    const result: TimelinePhase[] = [];

    // Scheduling phase (from scheduling_start to initializing_start or processing_start)
    if (schedulingStart) {
      const schedEnd = initializingStart || processingStart || startTime;
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

    // Initializing phase (from initializing_start to processing_start or start_time)
    if (initializingStart) {
      const initEnd = processingStart || startTime;
      const initActive = !initEnd && !processingStart && isRunning;
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

    // Processing phase (from processing_start or start_time to end_time)
    const procStart = processingStart || startTime;
    if (procStart) {
      const isActive = isRunning && !endTime;
      result.push({
        id: "processing",
        label: "Processing",
        shortLabel: "Proc",
        startTime: procStart,
        endTime: endTime,
        duration: calculatePhaseDuration(procStart, endTime),
        status: isActive ? "active" : endTime ? "completed" : "pending",
      });
    }

    return result;
  }, [schedulingStart, initializingStart, processingStart, startTime, endTime, isRunning]);

  // No timeline data
  if (phases.length === 0) {
    if (isPending) {
      return (
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-zinc-500">
          <span className="inline-block size-2 rounded-full border border-dashed border-gray-400 dark:border-zinc-600" />
          <span>Waiting for upstream dependencies</span>
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
              // Calculate flex grow based on duration, minWidth ensures mouse targets are usable
              const phaseDuration = phase.duration ?? 1;

              return (
                <div
                  key={phase.id}
                  className="flex items-center"
                  style={{
                    flex: phaseDuration,
                    minWidth: "3.5rem", // ~56px - comfortable click/hover target
                  }}
                >
                  {/* Start marker with tooltip - focusable button */}
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

                  {/* End marker (only for last phase) with tooltip - focusable button */}
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

            {/* Running indicator (animated end) - no tooltip needed, "now" label below is clear */}
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
                  {/* End label for last completed phase */}
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
