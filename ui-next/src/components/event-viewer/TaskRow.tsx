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

export interface TaskRowProps {
  task: TaskGroup;
  isExpanded: boolean;
  onToggleExpand: (taskId: string) => void;
  isLast: boolean;
}

/**
 * Renders a single task row with expand/collapse behavior.
 * Shows task name, retry badge, lifecycle progress, duration, and event count.
 * When expanded, renders EventDetailsPanel below.
 */
export const TaskRow = memo(function TaskRow({ task, isExpanded, onToggleExpand, isLast }: TaskRowProps) {
  const onToggle = useCallback(() => onToggleExpand(task.id), [onToggleExpand, task.id]);

  return (
    <div>
      {/* Task row */}
      <div
        className={cn(
          "hover:bg-muted cursor-pointer transition-colors duration-150",
          !isExpanded && !isLast && "border-border border-b",
        )}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        aria-expanded={isExpanded}
      >
        <div className="event-viewer-grid items-center">
          {/* Task name */}
          <div className="flex items-center gap-2.5 px-4 py-3">
            <ChevronRight
              className={cn(
                "text-muted-foreground size-3.5 shrink-0 transition-transform motion-reduce:transition-none",
                isExpanded && "rotate-90",
              )}
              style={{ transitionDuration: "var(--duration-slow)", transitionTimingFunction: "var(--ease-spring)" }}
            />
            <div className="min-w-0">
              <div className="text-foreground truncate font-mono text-xs font-medium">{task.name}</div>
              {task.events.length > 0 && task.events[0]?.involvedObject.kind === "Task" && (
                <div className="text-muted-foreground truncate text-xs">
                  {task.events[0].source.host || "node unknown"}
                </div>
              )}
            </div>
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
            <span className="bg-muted text-muted-foreground inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums">
              {task.events.length}
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
});
