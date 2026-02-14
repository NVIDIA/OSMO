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

import { memo } from "react";
import { cn } from "@/lib/utils";
import { formatDateTimeFull, formatDateTimeSuccinctWithSeconds } from "@/lib/format-date";
import type { TaskGroup } from "@/lib/api/adapter/events/events-grouping";

export interface EventDetailsPanelProps {
  task: TaskGroup;
  className?: string;
  /** When true, event rows animate in with a stagger effect */
  isAnimated?: boolean;
}

/**
 * Expanded panel showing event details for a task.
 * Renders a mini table with time, event reason badge, and message for each event.
 */
export const EventDetailsPanel = memo(function EventDetailsPanel({
  task,
  className,
  isAnimated,
}: EventDetailsPanelProps) {
  if (task.events.length === 0) {
    return (
      <div className={cn("text-muted-foreground bg-card py-6 text-center text-xs", className)}>
        No events available for this task
      </div>
    );
  }

  return (
    <div className={cn("bg-card", className)}>
      {/* Mini header for nested events table */}
      <div className="event-details-grid text-muted-foreground/70 border-border items-center border-b py-1.5 pr-4 pl-11 text-xs font-medium tracking-wider uppercase">
        <div>Time</div>
        <div>Event</div>
        <div>Details</div>
      </div>

      {/* Event rows */}
      {task.events.map((event, index) => {
        const timeStr = formatDateTimeSuccinctWithSeconds(event.timestamp);
        const absTime = formatDateTimeFull(event.timestamp);
        // Cap stagger index at 12 so rows beyond that appear simultaneously
        const staggerIndex = Math.min(index, 12);

        return (
          <div
            key={event.id}
            className={cn(
              "event-details-grid hover:bg-accent items-start py-1.5 pr-4 pl-11 transition-colors duration-100",
              "[&:not(:last-child)]:border-border [&:not(:last-child)]:border-b [&:not(:last-child)]:border-dashed",
              isAnimated && "event-row-animated",
            )}
            style={isAnimated ? ({ "--row-index": staggerIndex } as React.CSSProperties) : undefined}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Time */}
            <div className="flex items-center">
              <span
                className="text-muted-foreground font-mono text-xs tabular-nums"
                title={absTime}
              >
                {timeStr}
              </span>
            </div>

            {/* Event reason badge */}
            <div className="flex items-center">
              <span
                className="event-badge inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium"
                data-severity={event.severity}
                data-reason={event.reason}
              >
                {event.reason}
              </span>
            </div>

            {/* Message */}
            <div className="text-muted-foreground text-xs leading-relaxed break-words">{event.message}</div>
          </div>
        );
      })}
    </div>
  );
});
