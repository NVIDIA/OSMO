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

import { useCallback, useMemo, useRef } from "react";
import type { VirtualItem } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { useVirtualizerCompat } from "@/hooks/use-virtualizer-compat";
import { TaskRow } from "@/components/event-viewer/task-row";
import type { TaskGroup } from "@/lib/api/adapter/events/events-grouping";

/**
 * Estimated collapsed row height (px).
 * Single-line layout: py-3 (12) + badge content (~20) + py-3 (12) = 44.
 * Badge cells (retry, event count) are the tallest at ~44px.
 */
const ROW_HEIGHT_COLLAPSED = 44;

/** Estimated height per event row when expanded (px) */
const ROW_HEIGHT_PER_EVENT = 28;

/** Overscan count for smooth scrolling */
const OVERSCAN_COUNT = 10;

/** Column headers matching the grid template */
const HEADERS = ["Task", "Retry", "Duration", "Lifecycle", "Events"] as const;

interface EventViewerTableProps {
  tasks: TaskGroup[];
  expandedIds: Set<string>;
  onToggleExpand?: (taskId: string) => void;
  showHeader?: boolean;
  className?: string;
}

export function EventViewerTable({
  tasks,
  expandedIds,
  onToggleExpand,
  showHeader = true,
  className,
}: EventViewerTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Expansion-aware size estimates so off-screen items get reasonable
  // positions before ResizeObserver measures them for real.
  // Uses filtered event count when available so estimates stay accurate
  // after severity/event-level filters shrink the expanded panel.
  const estimateSize = useCallback(
    (index: number) => {
      const task = tasks[index];
      if (!task || !expandedIds.has(task.id)) return ROW_HEIGHT_COLLAPSED;
      // Prefer filtered count (from event-level filters) over full count
      const eventCount =
        (task as TaskGroup & { _filteredEventsCount?: number })._filteredEventsCount ?? task.events.length;
      return ROW_HEIGHT_COLLAPSED + eventCount * ROW_HEIGHT_PER_EVENT;
    },
    [tasks, expandedIds],
  );

  // Encode expand state into the virtualizer item key.  When the expand state
  // changes the virtualizer discards the stale cached measurement for that item
  // and falls back to estimateSize.  Items that haven't changed keep their exact
  // ResizeObserver measurements — no blanket reset needed.
  //
  // IMPORTANT: event count is only included for *expanded* rows (where it affects
  // height).  For collapsed rows the height is constant regardless of event count,
  // so encoding it would needlessly invalidate cached measurements every time a
  // new event streams in, causing visible row-position shifts.
  const getItemKey = useMemo(
    () => (index: number) => {
      const task = tasks[index];
      if (!task) return index;
      const expanded = expandedIds.has(task.id);
      if (!expanded) return task.id;
      // Expanded: height depends on visible event count → encode it so the
      // cached measurement is discarded when the panel grows/shrinks.
      const eventCount =
        (task as TaskGroup & { _filteredEventsCount?: number })._filteredEventsCount ?? task.events.length;
      return `${task.id}:1:${eventCount}`;
    },
    [tasks, expandedIds],
  );

  const virtualizer = useVirtualizerCompat({
    count: tasks.length,
    getScrollElement: useCallback(() => scrollRef.current, []),
    estimateSize,
    overscan: OVERSCAN_COUNT,
    getItemKey,
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
        className="scrollbar-styled relative min-h-0 flex-1 overflow-auto contain-strict"
      >
        {/* Inner wrapper enforces min-width so horizontal scroll activates */}
        <div className="event-viewer-scroll-inner">
          {/* Table header - inside scroll container for horizontal sync */}
          {showHeader && (
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
          )}

          {/* Virtualized table body */}
          <div
            className="relative"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualItems.map((virtualRow: VirtualItem) => {
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
                    isOdd={virtualRow.index % 2 !== 0}
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
