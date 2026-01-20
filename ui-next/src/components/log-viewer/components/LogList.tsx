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

import { useRef, useCallback, useEffect, useMemo, useState, memo } from "react";
import { cn } from "@/lib/utils";
import type { LogEntry } from "@/lib/api/log-adapter";
import { useVirtualizerCompat } from "@/hooks/use-virtualizer-compat";
import { LogEntryRow } from "./LogEntryRow";
import { DateSeparator } from "./DateSeparator";
import { useLogViewerStore } from "../store/log-viewer-store";
import {
  ROW_HEIGHT_ESTIMATE,
  EXPANDED_ROW_HEIGHT_ESTIMATE,
  OVERSCAN_COUNT,
  SCROLL_BOTTOM_THRESHOLD,
  DATE_SEPARATOR_HEIGHT,
} from "../lib/constants";

// =============================================================================
// Types
// =============================================================================

export interface LogListProps {
  /** Log entries to display */
  entries: LogEntry[];
  /** Additional CSS classes */
  className?: string;
  /** Callback when copy is clicked */
  onCopy?: (entry: LogEntry) => void;
  /** Callback when link is clicked */
  onCopyLink?: (entry: LogEntry) => void;
  /** Whether auto-scrolling (tailing) is enabled */
  isTailing?: boolean;
  /** Callback when user scrolls away from bottom (disables tailing) */
  onScrollAwayFromBottom?: () => void;
}

/** A group of log entries for a single date */
interface DateGroup {
  dateKey: string;
  date: Date;
  entries: LogEntry[];
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get a date key string for grouping (YYYY-MM-DD format).
 */
function getDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Group log entries by date.
 */
function groupEntriesByDate(entries: LogEntry[]): DateGroup[] {
  if (entries.length === 0) return [];

  const groups: DateGroup[] = [];
  let currentGroup: DateGroup | null = null;

  for (const entry of entries) {
    const dateKey = getDateKey(entry.timestamp);

    if (!currentGroup || currentGroup.dateKey !== dateKey) {
      currentGroup = {
        dateKey,
        date: entry.timestamp,
        entries: [],
      };
      groups.push(currentGroup);
    }

    currentGroup.entries.push(entry);
  }

  return groups;
}

// =============================================================================
// Date Group Component
// =============================================================================

interface DateGroupSectionProps {
  group: DateGroup;
  onCopy?: (entry: LogEntry) => void;
  onCopyLink?: (entry: LogEntry) => void;
}

/**
 * A date group section with a sticky header and virtualized entries.
 */
const DateGroupSection = memo(function DateGroupSection({
  group,
  onCopy,
  onCopyLink,
}: DateGroupSectionProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const [isStuck, setIsStuck] = useState(false);
  const expandedEntryIds = useLogViewerStore((s) => s.expandedEntryIds);
  const wrapLines = useLogViewerStore((s) => s.wrapLines);
  const showTask = useLogViewerStore((s) => s.showTask);
  const toggleExpand = useLogViewerStore((s) => s.toggleExpand);

  // Detect when sticky header is stuck using IntersectionObserver
  useEffect(() => {
    const stickyEl = stickyRef.current;
    const scrollContainer = stickyEl?.closest('[data-log-scroll-container]');
    if (!stickyEl || !scrollContainer) return;

    // Create a sentinel element just above the sticky header
    const sentinel = document.createElement('div');
    sentinel.style.height = '1px';
    sentinel.style.marginBottom = '-1px';
    stickyEl.parentElement?.insertBefore(sentinel, stickyEl);

    const observer = new IntersectionObserver(
      ([entry]) => {
        // When sentinel is not visible (scrolled past), header is stuck
        setIsStuck(!entry.isIntersecting);
      },
      { root: scrollContainer, threshold: 0 }
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
      sentinel.remove();
    };
  }, []);

  const virtualizer = useVirtualizerCompat({
    count: group.entries.length,
    getScrollElement: () => parentRef.current?.closest('[data-log-scroll-container]') as HTMLElement | null,
    estimateSize: useCallback(
      (index: number) => {
        const entry = group.entries[index];
        if (entry && expandedEntryIds.has(entry.id)) {
          return EXPANDED_ROW_HEIGHT_ESTIMATE;
        }
        return ROW_HEIGHT_ESTIMATE;
      },
      [group.entries, expandedEntryIds],
    ),
    overscan: OVERSCAN_COUNT,
  });

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div ref={parentRef}>
      {/* Sticky date header - shadow only when stuck */}
      <div
        ref={stickyRef}
        className={cn(
          "sticky top-0 z-10 bg-card transition-shadow duration-150",
          isStuck && "shadow-[0_1px_3px_0_rgb(0_0_0/0.1)]"
        )}
      >
        <DateSeparator date={group.date} isSticky />
      </div>

      {/* Entries container with virtualization */}
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualItems.map((virtualItem) => {
          const entry = group.entries[virtualItem.index];
          if (!entry) return null;

          const isExpanded = expandedEntryIds.has(entry.id);

          return (
            <div
              key={entry.id}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${virtualItem.start}px)` }}
            >
              <LogEntryRow
                entry={entry}
                isExpanded={isExpanded}
                wrapLines={wrapLines}
                showTask={showTask}
                onToggleExpand={toggleExpand}
                onCopy={onCopy}
                onCopyLink={onCopyLink}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});

// =============================================================================
// Main Component
// =============================================================================

function LogListInner({
  entries,
  className,
  onCopy,
  onCopyLink,
  isTailing = false,
  onScrollAwayFromBottom,
}: LogListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Group entries by date
  const dateGroups = useMemo(() => groupEntriesByDate(entries), [entries]);

  // Auto-scroll to bottom when tailing
  useEffect(() => {
    if (isTailing && parentRef.current && entries.length > 0) {
      parentRef.current.scrollTop = parentRef.current.scrollHeight;
    }
  }, [isTailing, entries.length]);

  // Detect scroll away from bottom
  const handleScroll = useCallback(() => {
    if (!parentRef.current || !onScrollAwayFromBottom) return;

    const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < SCROLL_BOTTOM_THRESHOLD;

    if (!isAtBottom && isTailing) {
      onScrollAwayFromBottom();
    }
  }, [isTailing, onScrollAwayFromBottom]);

  // Empty state
  if (entries.length === 0) {
    return (
      <div className={cn("text-muted-foreground flex h-full items-center justify-center", className)}>
        <div className="text-center">
          <p className="text-lg font-medium">No logs available</p>
          <p className="text-sm">Logs will appear when the task starts running.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      role="log"
      aria-live="polite"
      aria-label="Log entries"
      data-log-scroll-container
      className={cn(
        "@container",
        "relative h-full overflow-auto",
        "overscroll-contain",
        className,
      )}
      style={{ contain: "size layout style" }}
      onScroll={handleScroll}
    >
      {dateGroups.map((group, index) => (
        <DateGroupSection
          key={`${group.dateKey}-${index}`}
          group={group}
          onCopy={onCopy}
          onCopyLink={onCopyLink}
        />
      ))}
    </div>
  );
}

export const LogList = memo(LogListInner);
