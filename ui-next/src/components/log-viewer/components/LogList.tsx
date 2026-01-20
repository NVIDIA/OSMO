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

import { useRef, useCallback, useEffect, useMemo, memo } from "react";
import { cn } from "@/lib/utils";
import type { LogEntry } from "@/lib/api/log-adapter";
import { useVirtualizerCompat } from "@/hooks/use-virtualizer-compat";
import { LogEntryRow } from "./LogEntryRow";
import { DateSeparator } from "./DateSeparator";
import { useLogViewerStore } from "../store/log-viewer-store";
import {
  ROW_HEIGHT_ESTIMATE,
  EXPANDED_ROW_HEIGHT_ESTIMATE,
  DATE_SEPARATOR_HEIGHT,
  OVERSCAN_COUNT,
  SCROLL_BOTTOM_THRESHOLD,
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

/**
 * A flattened virtual list item - either a date separator or a log entry.
 * Using a discriminated union for type-safe rendering.
 */
type VirtualItem =
  | { type: "separator"; dateKey: string; date: Date; index: number }
  | { type: "entry"; entry: LogEntry };

/** Information about a date separator for sticky header tracking */
interface SeparatorInfo {
  index: number;
  dateKey: string;
  date: Date;
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
 * Result of flattening entries: the flat list + separator metadata for sticky headers.
 */
interface FlattenResult {
  items: VirtualItem[];
  separators: SeparatorInfo[];
}

/**
 * Flatten log entries into a single array with date separators.
 * Also returns separator metadata for O(1) sticky header lookup.
 */
function flattenEntriesWithSeparators(entries: LogEntry[]): FlattenResult {
  if (entries.length === 0) return { items: [], separators: [] };

  const items: VirtualItem[] = [];
  const separators: SeparatorInfo[] = [];
  let currentDateKey: string | null = null;

  for (const entry of entries) {
    const dateKey = getDateKey(entry.timestamp);

    // Insert date separator when date changes
    if (dateKey !== currentDateKey) {
      const separatorIndex = items.length;
      const separator: SeparatorInfo = { index: separatorIndex, dateKey, date: entry.timestamp };
      separators.push(separator);
      items.push({ type: "separator", dateKey, date: entry.timestamp, index: separatorIndex });
      currentDateKey = dateKey;
    }

    items.push({ type: "entry", entry });
  }

  return { items, separators };
}

// =============================================================================
// Sticky Header Component
// =============================================================================

interface StickyHeaderProps {
  date: Date;
  isVisible: boolean;
  isPushing: boolean;
  pushOffset: number;
}

/**
 * Floating sticky header that shows the current date group.
 * Uses GPU-accelerated transforms for smooth push animation.
 */
const StickyHeader = memo(function StickyHeader({ date, isVisible, isPushing, pushOffset }: StickyHeaderProps) {
  if (!isVisible) return null;

  return (
    <div
      className={cn(
        "bg-card pointer-events-none absolute top-0 right-0 left-0 z-20",
        "shadow-[0_1px_3px_0_rgb(0_0_0/0.1)]",
        "transition-opacity duration-100",
      )}
      style={{
        transform: isPushing ? `translateY(${pushOffset}px)` : "translateY(0)",
        opacity: isPushing && pushOffset < -DATE_SEPARATOR_HEIGHT / 2 ? 0 : 1,
      }}
      aria-hidden="true"
    >
      <DateSeparator date={date} />
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

  // Get store values at parent level - avoid per-row subscriptions
  const expandedEntryIds = useLogViewerStore((s) => s.expandedEntryIds);
  const wrapLines = useLogViewerStore((s) => s.wrapLines);
  const showTask = useLogViewerStore((s) => s.showTask);
  const toggleExpand = useLogViewerStore((s) => s.toggleExpand);

  // Flatten entries with date separators - single pass O(n)
  const { items: flatItems, separators } = useMemo(() => flattenEntriesWithSeparators(entries), [entries]);

  // Estimate size callback - uses lookup for expanded entries
  const estimateSize = useCallback(
    (index: number): number => {
      const item = flatItems[index];
      if (!item) return ROW_HEIGHT_ESTIMATE;

      if (item.type === "separator") {
        return DATE_SEPARATOR_HEIGHT;
      }

      // Check if this entry is expanded
      if (expandedEntryIds.has(item.entry.id)) {
        return EXPANDED_ROW_HEIGHT_ESTIMATE;
      }

      return ROW_HEIGHT_ESTIMATE;
    },
    [flatItems, expandedEntryIds],
  );

  // Single virtualizer for entire list
  const virtualizer = useVirtualizerCompat({
    count: flatItems.length,
    getScrollElement: useCallback(() => parentRef.current, []),
    estimateSize,
    overscan: OVERSCAN_COUNT,
  });

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

  const virtualItems = virtualizer.getVirtualItems();
  const scrollOffset = virtualizer.scrollOffset ?? 0;

  // Determine current sticky header based on scroll position
  // Find the last separator whose position is <= scrollOffset
  let currentSeparator: SeparatorInfo | null = null;
  let nextSeparator: SeparatorInfo | null = null;

  for (let i = 0; i < separators.length; i++) {
    const sep = separators[i];
    const sepStart = virtualizer.getOffsetForIndex(sep.index)?.[0] ?? 0;

    if (sepStart <= scrollOffset) {
      currentSeparator = sep;
      nextSeparator = separators[i + 1] ?? null;
    } else {
      break;
    }
  }

  // Calculate push effect when next separator approaches
  let isPushing = false;
  let pushOffset = 0;

  if (currentSeparator && nextSeparator) {
    const nextSepStart = virtualizer.getOffsetForIndex(nextSeparator.index)?.[0] ?? 0;
    const distanceToNext = nextSepStart - scrollOffset;

    if (distanceToNext < DATE_SEPARATOR_HEIGHT) {
      isPushing = true;
      pushOffset = distanceToNext - DATE_SEPARATOR_HEIGHT;
    }
  }

  // Show sticky header when scrolled past the first separator
  const firstSeparatorStart = separators[0] ? (virtualizer.getOffsetForIndex(separators[0].index)?.[0] ?? 0) : 0;
  const showStickyHeader = currentSeparator !== null && scrollOffset > firstSeparatorStart;

  return (
    <div
      ref={parentRef}
      role="log"
      aria-live="polite"
      aria-label="Log entries"
      data-log-scroll-container
      className={cn("@container", "relative h-full overflow-auto", "overscroll-contain", className)}
      style={{
        contain: "size layout style",
        // GPU layer promotion for smoother scrolling
        transform: "translateZ(0)",
        backfaceVisibility: "hidden",
      }}
      onScroll={handleScroll}
    >
      {/* Floating sticky header - rendered outside virtual list */}
      {currentSeparator && (
        <StickyHeader
          date={currentSeparator.date}
          isVisible={showStickyHeader}
          isPushing={isPushing}
          pushOffset={pushOffset}
        />
      )}

      {/* Virtual list container */}
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualItems.map((virtualRow) => {
          const item = flatItems[virtualRow.index];
          if (!item) return null;

          if (item.type === "separator") {
            // Hide inline separator when it's the current sticky header and would overlap
            const isCurrent = currentSeparator?.index === item.index;
            const isHiddenByStickyHeader =
              isCurrent && showStickyHeader && virtualRow.start < scrollOffset + DATE_SEPARATOR_HEIGHT;

            return (
              <div
                key={item.dateKey}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className={cn("bg-card absolute top-0 left-0 w-full", isHiddenByStickyHeader && "opacity-0")}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <DateSeparator date={item.date} />
              </div>
            );
          }

          // Log entry row
          const isExpanded = expandedEntryIds.has(item.entry.id);

          return (
            <div
              key={item.entry.id}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <LogEntryRow
                entry={item.entry}
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
}

export const LogList = memo(LogListInner);
