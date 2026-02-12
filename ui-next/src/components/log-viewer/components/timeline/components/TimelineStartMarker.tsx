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
 * Timeline Start Marker
 *
 * Fixed visual marker showing the entity start time (workflow/task start).
 * Part of Layer 2 (fixed overlays) - stays at the same timeline position while histogram pans.
 */

"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { formatDateTimeFullUTC } from "@/lib/format-date";

// =============================================================================
// Types
// =============================================================================

export interface TimelineStartMarkerProps {
  /** Entity start time (workflow/task start) */
  entityStartTime: Date;
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

export function TimelineStartMarker({
  entityStartTime,
  displayStart,
  displayEnd,
  className,
}: TimelineStartMarkerProps): React.ReactNode {
  // Calculate position as percentage within the visible range
  const positionPercent = useMemo(() => {
    const startMs = entityStartTime.getTime();
    const displayStartMs = displayStart.getTime();
    const displayEndMs = displayEnd.getTime();
    const displayRangeMs = displayEndMs - displayStartMs;

    if (displayRangeMs <= 0) return null;

    const offsetMs = startMs - displayStartMs;
    const percent = (offsetMs / displayRangeMs) * 100;

    // Only show marker if it's within the visible range (with small margin)
    if (percent < -1 || percent > 101) return null;

    return percent;
  }, [entityStartTime, displayStart, displayEnd]);

  // Don't render if marker is outside visible range
  if (positionPercent === null) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn("pointer-events-none absolute inset-y-0 z-10", className)}
          style={{ left: `${positionPercent}%` }}
        >
          {/* Subtle vertical line marker */}
          <div className="relative h-full w-px">
            {/* Main marker line - subtle but visible */}
            <div className="bg-primary/30 absolute inset-0 w-px" />

            {/* Small circle indicator at top */}
            <div className="bg-primary absolute top-0 left-1/2 size-1.5 -translate-x-1/2 rounded-full" />

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
          <div className="text-muted-foreground">Started</div>
          <div className="font-mono tabular-nums">{formatDateTimeFullUTC(entityStartTime)}</div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
