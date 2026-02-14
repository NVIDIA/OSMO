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

import { useState, useMemo, useDeferredValue, useCallback, startTransition } from "react";
import { Search, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEvents } from "@/lib/api/adapter/events/events-hooks";
import { groupEventsByTask } from "@/lib/api/adapter/events/events-grouping";
import { EventViewerTable } from "@/components/event-viewer/EventViewerTable";
import "@/components/event-viewer/event-viewer.css";

export interface EventViewerContainerProps {
  url: string;
  className?: string;
  /** Scope: "workflow" shows search bar and expand/collapse controls, "task" always expands all rows with no controls */
  scope?: "workflow" | "task";
}

export function EventViewerContainer({ url, className, scope = "workflow" }: EventViewerContainerProps) {
  const isTaskScope = scope === "task";

  const [searchTerm, setSearchTerm] = useState("");
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const { events, isLoading, error, refetch } = useEvents({ url });

  const groupedTasks = useMemo(() => groupEventsByTask(events), [events]);

  const filteredTasks = useMemo(() => {
    // In task scope, no search filtering
    if (isTaskScope) return groupedTasks;
    if (!deferredSearchTerm) return groupedTasks;

    const term = deferredSearchTerm.toLowerCase();
    return groupedTasks.filter((task) => {
      if (task.name.toLowerCase().includes(term)) return true;
      for (const e of task.events) {
        if (e.reason.toLowerCase().includes(term) || e.message.toLowerCase().includes(term)) {
          return true;
        }
      }
      return false;
    });
  }, [groupedTasks, deferredSearchTerm, isTaskScope]);

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

  // Loading state
  if (isLoading && events.length === 0) {
    return (
      <div className={cn("flex items-center justify-center p-8", className)}>
        <div className="text-center">
          <div className="mb-2 inline-block size-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent motion-reduce:animate-[spin_1.5s_linear_infinite]" />
          <p className="text-muted-foreground text-sm">Loading events...</p>
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
          onClick={refetch}
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
        <div className="bg-card border-border border-b px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* Search */}
            <div
              className={cn(
                "relative flex min-w-[300px] flex-1 items-center gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors",
                "border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900",
                "focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500",
              )}
            >
              <Search className="size-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
              <input
                type="search"
                placeholder="Search tasks or events..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="min-w-[150px] flex-1 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-zinc-400 focus:ring-0 dark:text-zinc-100 dark:placeholder:text-zinc-500"
              />
            </div>

            {/* Expand/Collapse All */}
            <div className="flex items-center gap-1">
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
        </div>
      )}

      {/* Table */}
      <EventViewerTable
        tasks={filteredTasks}
        expandedIds={effectiveExpandedIds}
        onToggleExpand={isTaskScope ? undefined : toggleExpand}
        showHeader={!isTaskScope}
        className="min-h-0 flex-1"
      />
    </div>
  );
}
