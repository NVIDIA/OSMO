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

import { memo, useCallback } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { LifecycleProgressBar } from "@/components/event-viewer/LifecycleProgressBar";
import { EventDetailsPanel } from "@/components/event-viewer/EventDetailsPanel";
import type { TaskGroup } from "@/lib/api/adapter/events/events-grouping";
import type { K8sEvent } from "@/lib/api/adapter/events/events-types";

export interface TaskRowProps {
  task: TaskGroup & {
    /** Filtered events subset (only present when event-level filters active) */
    _filteredEvents?: K8sEvent[];
    /** Total number of events before filtering (optional) */
    _allEventsCount?: number;
    /** Number of events after filtering (optional) */
    _filteredEventsCount?: number;
    /** Whether event-level filters are active (optional) */
    _hasEventFilters?: boolean;
  };
  isExpanded: boolean;
  onToggleExpand?: (taskId: string) => void;
  isLast: boolean;
  /** Whether this is an odd-indexed section (for zebra striping) */
  isOdd: boolean;
}

/**
 * Renders a single task row with optional expand/collapse behavior.
 * Shows task name, retry badge, lifecycle progress, duration, and event count.
 * When expanded, renders EventDetailsPanel below.
 * If onToggleExpand is undefined, row is always expanded and not interactive.
 */
export const TaskRow = memo(
  function TaskRow({ task, isExpanded, onToggleExpand, isLast, isOdd }: TaskRowProps) {
    const isInteractive = onToggleExpand !== undefined;
    const onToggle = useCallback(() => onToggleExpand?.(task.id), [onToggleExpand, task.id]);

    // Check if task has filtered events
    const hasEventFilters = task._hasEventFilters ?? false;
    const allEventsCount = task._allEventsCount ?? task.events.length;
    const filteredEventsCount = task._filteredEventsCount ?? task.events.length;
    const hasSomeEventsFiltered = hasEventFilters && filteredEventsCount < allEventsCount;
    const hasNoEventsMatching = hasEventFilters && filteredEventsCount === 0;

    return (
      <div className={cn(isOdd && "bg-gray-100/60 dark:bg-zinc-900/50")}>
        {/* Task row */}
        <div
          className={cn(
            "transition-colors duration-150",
            isInteractive && "hover:bg-muted cursor-pointer",
            !isExpanded && !isLast && "border-border border-b",
            hasNoEventsMatching && "opacity-40", // Dim tasks with no matching events
          )}
          onClick={isInteractive ? onToggle : undefined}
          role={isInteractive ? "button" : undefined}
          tabIndex={isInteractive ? 0 : undefined}
          onKeyDown={
            isInteractive
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onToggle();
                  }
                }
              : undefined
          }
          aria-expanded={isInteractive ? isExpanded : undefined}
        >
          <div className="event-viewer-grid items-center">
            {/* Task name */}
            <div className="flex items-center gap-2.5 px-4 py-3">
              {isInteractive && (
                <ChevronRight
                  className={cn(
                    "text-muted-foreground size-3.5 shrink-0 transition-transform motion-reduce:transition-none",
                    isExpanded && "rotate-90",
                  )}
                  style={{ transitionDuration: "var(--duration-slow)", transitionTimingFunction: "var(--ease-spring)" }}
                />
              )}
              <div className="text-foreground min-w-0 truncate font-mono text-xs font-medium">{task.name}</div>
            </div>

            {/* Retry badge */}
            <div className="px-4 py-3">
              {task.retryId > 0 ? (
                <span className="bg-warning-bg text-warning inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums">
                  #{task.retryId}
                </span>
              ) : (
                <span className="text-muted-foreground text-xs">—</span>
              )}
            </div>

            {/* Duration */}
            <div className="px-4 py-3">
              <span className="text-muted-foreground font-mono text-xs tabular-nums">{task.duration}</span>
            </div>

            {/* Lifecycle progress bar */}
            <div className="px-4 py-3">
              <LifecycleProgressBar task={task} />
            </div>

            {/* Event count */}
            <div className="px-4 py-3 text-right">
              <span className="bg-muted text-muted-foreground inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap tabular-nums">
                {hasSomeEventsFiltered ? `${filteredEventsCount}/${allEventsCount}` : task.events.length}
              </span>
            </div>
          </div>
        </div>

        {/* Expanded events - always rendered for CSS Grid animation */}
        <div
          className="event-panel-wrapper"
          data-expanded={isExpanded}
          aria-hidden={!isExpanded}
        >
          <div className="event-panel-inner">
            <EventDetailsPanel
              task={task}
              isAnimated={isExpanded}
            />
            {!isLast && <div className="border-border border-b" />}
          </div>
        </div>
      </div>
    );
  },
  (prev, next) => {
    // Custom comparison for performance: only re-render if meaningful props changed
    return (
      prev.task.id === next.task.id &&
      prev.task.events.length === next.task.events.length &&
      prev.task.derived.podPhase === next.task.derived.podPhase &&
      prev.task.derived.lifecycle === next.task.derived.lifecycle &&
      prev.task.duration === next.task.duration &&
      prev.isExpanded === next.isExpanded &&
      prev.onToggleExpand === next.onToggleExpand &&
      prev.isLast === next.isLast &&
      prev.isOdd === next.isOdd &&
      prev.task._allEventsCount === next.task._allEventsCount &&
      prev.task._filteredEventsCount === next.task._filteredEventsCount &&
      prev.task._hasEventFilters === next.task._hasEventFilters
    );
  },
);
