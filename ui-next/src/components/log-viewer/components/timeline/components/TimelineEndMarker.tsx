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
 * Visual marker showing the entity end time or current "now" for running workflows.
 * Displayed below the timeline axis to avoid overlapping with histogram bars.
 *
 * ## Behavior
 *
 * - If workflow is completed (entityEndTime set): shows static green check marker
 * - If workflow is running (no entityEndTime): shows dynamic blue "running" marker that updates with `now`
 */

"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { formatDateTimeFullUTC } from "@/lib/format-date";
import { Tag } from "lucide-react";
import type { HistogramBucket } from "@/lib/api/log-adapter/types";
import { calculateBucketWidth } from "@/components/log-viewer/components/timeline/lib/invalid-zones";

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
  /** Histogram buckets for center alignment */
  buckets: HistogramBucket[];
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
  buckets,
  className,
}: TimelineEndMarkerProps): React.ReactNode {
  const isRunning = !entityEndTime;
  const markerTime = useMemo(() => entityEndTime ?? new Date(now), [entityEndTime, now]);

  // Calculate center-aligned visual position within the display range.
  // Returns null if the marker is outside the visible range.
  const positionPercent = useMemo(() => {
    const displayStartMs = displayStart.getTime();
    const displayEndMs = displayEnd.getTime();
    const displayRangeMs = displayEndMs - displayStartMs;

    if (displayRangeMs <= 0) return null;

    // Visibility check using exact marker time (with small margin)
    const markerMs = markerTime.getTime();
    const exactPercent = ((markerMs - displayStartMs) / displayRangeMs) * 100;
    if (exactPercent < -1 || exactPercent > 101) return null;

    // Center-align with the containing bucket for visual positioning
    const bucketTimestamps = buckets.map((b) => b.timestamp);
    const bucketWidthMs = calculateBucketWidth(bucketTimestamps);

    if (bucketWidthMs === 0) return exactPercent;

    const containingBucket = buckets.find((b) => {
      const bucketStart = b.timestamp.getTime();
      return markerMs >= bucketStart && markerMs < bucketStart + bucketWidthMs;
    });

    const visualTimeMs = containingBucket
      ? containingBucket.timestamp.getTime() + bucketWidthMs / 2
      : buckets[buckets.length - 1].timestamp.getTime() + bucketWidthMs / 2;

    return ((visualTimeMs - displayStartMs) / displayRangeMs) * 100;
  }, [markerTime, displayStart, displayEnd, buckets]);

  if (positionPercent === null) return null;

  const iconColor = isRunning ? "text-blue-500" : "text-green-500";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn("absolute top-[2px] z-10 -translate-x-1/2 cursor-default", className)}
          style={{ left: `${positionPercent}%` }}
          aria-label={`Workflow ${isRunning ? "running" : "completed"} time`}
        >
          <Tag className={cn("size-3 rotate-[45deg] fill-current", iconColor)} />
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="text-xs"
      >
        <div className="space-y-0.5">
          <div className="text-muted-foreground">{isRunning ? "Running" : "Completed"}</div>
          <div className="font-mono tabular-nums">{formatDateTimeFullUTC(markerTime)}</div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
