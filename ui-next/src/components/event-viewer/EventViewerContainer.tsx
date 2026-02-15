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

import { useState, useMemo, useCallback, startTransition, useDeferredValue } from "react";
import { ChevronsDownUp, ChevronsUpDown, Loader2, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEventStream } from "@/lib/api/adapter/events/use-event-stream";
import { groupEventsByTask } from "@/lib/api/adapter/events/events-grouping";
import { EventViewerTable } from "@/components/event-viewer/EventViewerTable";
import { FilterBar } from "@/components/filter-bar/filter-bar";
import { useUrlChips } from "@/hooks/use-url-chips";
import { EVENT_SEARCH_FIELDS, EVENT_PRESETS } from "@/app/(dashboard)/workflows/[name]/lib/event-search-fields";
import { filterTaskGroups } from "@/app/(dashboard)/workflows/[name]/lib/event-filtering";
import "@/components/event-viewer/event-viewer.css";

export interface EventViewerContainerProps {
  url: string;
  className?: string;
  /** Scope: "workflow" shows search bar and expand/collapse controls, "task" always expands all rows with no controls */
  scope?: "workflow" | "task";
  /**
   * Whether the parent entity (workflow or task) has reached a terminal state.
   * Enables inference of missing terminal events in the lifecycle progress bar.
   */
  isTerminal?: boolean;
}

export function EventViewerContainer({ url, className, scope = "workflow", isTerminal }: EventViewerContainerProps) {
  const isTaskScope = scope === "task";

  // URL-synced filter chips (only in workflow scope)
  const { searchChips, setSearchChips } = useUrlChips({ paramName: "ef" });
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const { events, phase, error, isStreaming, isReconnecting, restart } = useEventStream({ url });

  const groupedTasks = useMemo(() => groupEventsByTask(events), [events]);

  // Defer search chips to keep FilterBar input responsive (P0 performance requirement)
  const deferredSearchChips = useDeferredValue(searchChips);

  // Apply hierarchical filtering (task-level and event-level)
  const filteredTasks = useMemo(() => {
    // In task scope, no filtering
    if (isTaskScope) return groupedTasks;
    // No chips = no filtering
    if (deferredSearchChips.length === 0) return groupedTasks;
    // Apply hierarchical filtering with deferred chips
    return filterTaskGroups(groupedTasks, deferredSearchChips);
  }, [groupedTasks, deferredSearchChips, isTaskScope]);

  // In task scope, always expand all tasks
  const effectiveExpandedIds = useMemo(() => {
    if (isTaskScope) {
      return new Set(filteredTasks.map((t) => t.id));
    }
    return expandedIds;
  }, [isTaskScope, filteredTasks, expandedIds]);

  // Expand/collapse handlers
  const toggleExpand = useCallback((taskId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    startTransition(() => {
      setExpandedIds((prev) => {
        const allIds = filteredTasks.map((t) => t.id);
        // Idempotent: if every filtered task is already expanded, return same reference
        if (prev.size === allIds.length && allIds.every((id) => prev.has(id))) {
          return prev;
        }
        return new Set(allIds);
      });
    });
  }, [filteredTasks]);

  const collapseAll = useCallback(() => {
    startTransition(() => {
      setExpandedIds((prev) => {
        // Idempotent: if already empty, return same reference to skip re-render
        if (prev.size === 0) return prev;
        return new Set<string>();
      });
    });
  }, []);

  // Loading state (connecting/reconnecting with no data yet)
  if ((phase === "connecting" || phase === "reconnecting" || phase === "idle") && events.length === 0) {
    const message = phase === "reconnecting" ? "Reconnecting..." : "Loading events...";
    return (
      <div className={cn("flex items-center justify-center p-8", className)}>
        <div className="text-center">
          <div className="mb-2 inline-block size-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent motion-reduce:animate-[spin_1.5s_linear_infinite]" />
          <p className="text-muted-foreground text-sm">{message}</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={cn("p-4 text-center", className)}>
        <p className="text-destructive mb-2 text-sm">Failed to load events: {error.message}</p>
        <button
          onClick={restart}
          className="text-muted-foreground hover:text-foreground text-sm underline hover:no-underline"
        >
          Retry
        </button>
      </div>
    );
  }

  // Empty state
  if (groupedTasks.length === 0) {
    return (
      <div className={cn("p-8 text-center", className)}>
        <p className="text-muted-foreground text-sm">No events available</p>
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      {/* Filter bar - only in workflow scope */}
      {!isTaskScope && (
        <div className="bg-card border-border flex items-center gap-3 border-b px-4 py-3">
          {/* FilterBar with search fields and presets */}
          <div className="min-w-0 flex-1">
            <FilterBar
              data={groupedTasks}
              fields={EVENT_SEARCH_FIELDS}
              chips={searchChips}
              onChipsChange={setSearchChips}
              placeholder="Search tasks or events..."
              presets={EVENT_PRESETS}
            />
          </div>

          {/* Streaming status indicator */}
          {isStreaming && (
            <div className="flex shrink-0 items-center gap-1.5 rounded-md border border-green-500/30 bg-green-500/10 px-2 py-1 text-xs font-medium text-green-600 dark:text-green-400">
              <Radio className="size-3 animate-pulse" />
              <span>Live</span>
            </div>
          )}
          {isReconnecting && (
            <div className="flex shrink-0 items-center gap-1.5 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-2 py-1 text-xs font-medium text-yellow-600 dark:text-yellow-400">
              <Loader2 className="size-3 animate-spin" />
              <span>Reconnecting</span>
            </div>
          )}

          {/* Expand/Collapse All */}
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={expandAll}
              className="text-muted-foreground hover:text-foreground hover:bg-accent flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors"
              title="Expand all tasks"
            >
              <ChevronsUpDown className="size-3" />
              <span>Expand All</span>
            </button>
            <button
              onClick={collapseAll}
              className="text-muted-foreground hover:text-foreground hover:bg-accent flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors"
              title="Collapse all tasks"
            >
              <ChevronsDownUp className="size-3" />
              <span>Collapse All</span>
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <EventViewerTable
        tasks={filteredTasks}
        expandedIds={effectiveExpandedIds}
        onToggleExpand={isTaskScope ? undefined : toggleExpand}
        showHeader={!isTaskScope}
        isParentTerminal={isTerminal}
        className="min-h-0 flex-1"
      />
    </div>
  );
}
