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

"use client";

import { useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { useVirtualizerCompat } from "@/hooks/use-virtualizer-compat";
import { TaskRow } from "@/components/event-viewer/TaskRow";
import type { TaskGroup } from "@/lib/api/adapter/events/events-grouping";

/** Estimated collapsed row height (px) */
const ROW_HEIGHT_ESTIMATE = 48;

/** Overscan count for smooth scrolling */
const OVERSCAN_COUNT = 10;

/** Column headers matching the grid template */
const HEADERS = ["Task", "Retry", "Duration", "Lifecycle", "Events"] as const;

export interface EventViewerTableProps {
  tasks: TaskGroup[];
  expandedIds: Set<string>;
  onToggleExpand: (taskId: string) => void;
  className?: string;
}

export function EventViewerTable({ tasks, expandedIds, onToggleExpand, className }: EventViewerTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizerCompat({
    count: tasks.length,
    getScrollElement: useCallback(() => scrollRef.current, []),
    estimateSize: useCallback(() => ROW_HEIGHT_ESTIMATE, []),
    overscan: OVERSCAN_COUNT,
    getItemKey: useCallback((index: number) => tasks[index]?.id ?? index, [tasks]),
  });

  if (tasks.length === 0) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-16">
        <div className="text-center">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mx-auto mb-2 opacity-50"
          >
            <circle
              cx="11"
              cy="11"
              r="8"
            />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <p className="text-sm">No tasks match the current filters</p>
        </div>
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className={cn("bg-table-surface flex min-h-0 flex-col", className)}>
      {/* Single scroll container for header + body so they scroll horizontally in sync */}
      <div
        ref={scrollRef}
        className="scrollbar-styled relative min-h-0 flex-1 overflow-auto"
      >
        {/* Inner wrapper enforces min-width so horizontal scroll activates */}
        <div className="event-viewer-scroll-inner">
          {/* Table header - inside scroll container for horizontal sync */}
          <div className="table-header sticky top-0 z-10">
            <div className="event-viewer-grid text-muted-foreground text-xs font-semibold">
              {HEADERS.map((header) => (
                <div
                  key={header}
                  className="px-4 py-2"
                >
                  {header}
                </div>
              ))}
            </div>
          </div>

          {/* Virtualized table body */}
          <div
            className="relative"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualItems.map((virtualRow) => {
              const task = tasks[virtualRow.index];
              if (!task) return null;

              return (
                <div
                  key={task.id}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className="absolute top-0 left-0 w-full"
                  style={{
                    transform: `translate3d(0, ${Math.floor(virtualRow.start)}px, 0)`,
                  }}
                >
                  <TaskRow
                    task={task}
                    isExpanded={expandedIds.has(task.id)}
                    onToggleExpand={onToggleExpand}
                    isLast={virtualRow.index === tasks.length - 1}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
