//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

/**
 * Timeline End Marker
 *
 * Fixed visual marker showing the entity end time or current "now" for running workflows.
 * Part of Layer 2 (fixed overlays) - stays at the same timeline position while histogram pans.
 *
 * ## Behavior
 *
 * - If workflow is completed (entityEndTime set): shows static green marker
 * - If workflow is running (no entityEndTime): shows dynamic blue "running" marker that updates with `now`
 */

"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { formatDateTimeFullUTC } from "@/lib/format-date";

// =============================================================================
// Types
// =============================================================================

export interface TimelineEndMarkerProps {
  /** Entity end time (workflow/task end) - undefined if still running */
  entityEndTime?: Date;
  /** Synchronized "NOW" timestamp from useTick() - used when workflow is running */
  now: number;
  /** Current display range */
  displayStart: Date;
  /** Current display range */
  displayEnd: Date;
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

export function TimelineEndMarker({
  entityEndTime,
  now,
  displayStart,
  displayEnd,
  className,
}: TimelineEndMarkerProps): React.ReactNode {
  // Determine if workflow is running (no end time set)
  const isRunning = !entityEndTime;

  // Use entityEndTime if available, otherwise use synchronized "now"
  const markerTime = useMemo(() => {
    if (entityEndTime) return entityEndTime;
    return new Date(now);
  }, [entityEndTime, now]);

  // Calculate position as percentage within the visible range
  const positionPercent = useMemo(() => {
    const timeMs = markerTime.getTime();
    const displayStartMs = displayStart.getTime();
    const displayEndMs = displayEnd.getTime();
    const displayRangeMs = displayEndMs - displayStartMs;

    if (displayRangeMs <= 0) return null;

    const offsetMs = timeMs - displayStartMs;
    const percent = (offsetMs / displayRangeMs) * 100;

    // Only show marker if it's within the visible range (with small margin)
    if (percent < -1 || percent > 101) return null;

    return percent;
  }, [markerTime, displayStart, displayEnd]);

  // Don't render if marker is outside visible range
  if (positionPercent === null) return null;

  // Color scheme: blue for running, green for completed
  const colorClasses = isRunning
    ? "bg-blue-500/30" // Blue for running
    : "bg-green-500/30"; // Green for completed

  const circleClasses = isRunning
    ? "bg-blue-500" // Blue circle for running
    : "bg-green-500"; // Green circle for completed

  const label = isRunning ? "Running" : "Completed";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn("pointer-events-none absolute inset-y-0 z-10", className)}
          style={{ left: `${positionPercent}%` }}
        >
          {/* Subtle vertical line marker */}
          <div className="relative h-full w-px">
            {/* Main marker line - color based on state */}
            <div className={cn("absolute inset-0 w-px", colorClasses)} />

            {/* Small circle indicator at top */}
            <div className={cn("absolute top-0 left-1/2 size-1.5 -translate-x-1/2 rounded-full", circleClasses)} />

            {/* Pulsing animation for running workflows */}
            {isRunning && (
              <div
                className="absolute top-0 left-1/2 size-1.5 -translate-x-1/2 animate-ping rounded-full bg-blue-500 opacity-75"
                aria-hidden="true"
              />
            )}

            {/* Interactive hit area for tooltip (pointer-events enabled) */}
            <div className="pointer-events-auto absolute inset-y-0 -left-2 w-5" />
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="text-xs"
      >
        <div className="space-y-0.5">
          <div className="text-muted-foreground">{label}</div>
          <div className="font-mono tabular-nums">{formatDateTimeFullUTC(markerTime)}</div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
