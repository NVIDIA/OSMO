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

import { useRef, useCallback, memo, useLayoutEffect, forwardRef, useImperativeHandle } from "react";
import { cn } from "@/lib/utils";
import { formatDateShort } from "@/lib/format-date";
import type { LogEntry } from "@/lib/api/log-adapter";
import { useVirtualizerCompat } from "@/hooks/use-virtualizer-compat";
import { LogEntryRow } from "./LogEntryRow";
import { useLogViewerStore } from "../store/log-viewer-store";
import { ROW_HEIGHT_ESTIMATE, DATE_SEPARATOR_HEIGHT, OVERSCAN_COUNT, SCROLL_BOTTOM_THRESHOLD } from "../lib/constants";
import { useIncrementalFlatten } from "../lib/use-incremental-flatten";

// =============================================================================
// Types
// =============================================================================

export interface LogListHandle {
  scrollToBottom: () => void;
}

export interface LogListProps {
  /** Log entries to display */
  entries: LogEntry[];
  /** Additional CSS classes */
  className?: string;
  /**
   * Whether auto-scroll to bottom is enabled (pinned to bottom).
   * When true, automatically scrolls to show latest entries.
   */
  isPinnedToBottom?: boolean;
  /** Callback when user scrolls away from bottom (unpins auto-scroll) */
  onScrollAwayFromBottom?: () => void;
  /**
   * Whether the displayed data is stale (background refetch in progress).
   * When true, applies subtle visual feedback without blocking interaction.
   */
  isStale?: boolean;
}

// =============================================================================
// Date Separator (Inlined)
// =============================================================================

const dashedLineStyle = {
  backgroundImage: "linear-gradient(to right, transparent 50%, var(--border) 50%)",
  backgroundSize: "6px 1px",
  opacity: 0.4,
};

interface DateSeparatorProps {
  date: Date;
  className?: string;
}

/**
 * A subtle date separator row for providing date context in log lists.
 */
const DateSeparator = memo(function DateSeparator({ date, className }: DateSeparatorProps) {
  const formattedDate = formatDateShort(date);

  return (
    <div
      className={cn("flex items-center gap-2 px-3 py-1", className)}
      role="separator"
      aria-label={`Logs from ${formattedDate}`}
    >
      <div
        className="h-px flex-1"
        style={dashedLineStyle}
      />
      <span className="text-muted-foreground/50 shrink-0 text-[10px] tracking-wider uppercase">{formattedDate}</span>
      <div
        className="h-px flex-1"
        style={dashedLineStyle}
      />
    </div>
  );
});

// =============================================================================
// Sticky Header Component (CSS-driven)
// =============================================================================

interface StickyHeaderProps {
  date: Date | null;
}

/**
 * CSS-driven sticky header that shows the current date group.
 * Uses position: sticky for native browser stickiness.
 * Date changes instantly when scrolling past boundaries (no JS push animation).
 */
const StickyHeader = memo(function StickyHeader({ date }: StickyHeaderProps) {
  if (!date) return null;

  return (
    <div
      className="bg-card pointer-events-none sticky top-0 z-20 shadow-[0_1px_3px_0_rgb(0_0_0/0.1)]"
      style={{
        // Negative margin so it doesn't take up layout space
        marginBottom: -DATE_SEPARATOR_HEIGHT,
        height: DATE_SEPARATOR_HEIGHT,
        // Force GPU layer to prevent z-index conflicts with transformed virtual items
        transform: "translateZ(0)",
        willChange: "transform",
        // Ensure isolation from virtual list stacking contexts
        isolation: "isolate",
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

const LogListInner = forwardRef<LogListHandle, LogListProps>(function LogListInner(
  { entries, className, isPinnedToBottom = false, onScrollAwayFromBottom, isStale = false },
  ref,
) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Get store values at parent level - avoid per-row subscriptions
  const wrapLines = useLogViewerStore((s) => s.wrapLines);
  const showTask = useLogViewerStore((s) => s.showTask);

  // Flatten entries with date separators using incremental algorithm
  // O(k) for streaming appends where k = new entries, O(n) for full replacement
  const { items: flatItems, separators, resetCount } = useIncrementalFlatten(entries);

  // Keep flatItems in a ref to allow stable estimateSize callback
  // This prevents virtualizer from resetting on every flatItems change
  const flatItemsRef = useRef(flatItems);
  useLayoutEffect(() => {
    flatItemsRef.current = flatItems;
  });

  // Estimate size callback - uses ref to access current flatItems
  // without recreating the callback on every change
  const estimateSize = useCallback((index: number): number => {
    const item = flatItemsRef.current[index];
    if (!item) return ROW_HEIGHT_ESTIMATE;
    return item.type === "separator" ? DATE_SEPARATOR_HEIGHT : ROW_HEIGHT_ESTIMATE;
  }, []);

  // Single virtualizer for entire list
  const virtualizer = useVirtualizerCompat({
    count: flatItems.length,
    getScrollElement: useCallback(() => parentRef.current, []),
    estimateSize,
    overscan: OVERSCAN_COUNT,
  });

  // Clear virtualizer measurements cache when data is reset (filter/replace).
  // resetCount increments only on full resets, not streaming appends.
  // This prevents phantom separators caused by stale cached positions.
  useLayoutEffect(() => {
    if (resetCount > 0) {
      // Force virtualizer to recalculate all measurements
      virtualizer.measure();
    }
  }, [resetCount, virtualizer]);

  // Expose scrollToBottom method via ref
  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: () => {
        if (flatItems.length === 0) return;
        virtualizer.scrollToIndex(flatItems.length - 1, { align: "end" });
      },
    }),
    [virtualizer, flatItems.length],
  );

  // Auto-scroll to bottom when pinned.
  // Uses the virtualizer's scrollToIndex for stable positioning - no manual
  // scroll calculations that can race with virtualizer updates.
  useLayoutEffect(() => {
    if (!isPinnedToBottom || flatItems.length === 0) return;

    // Use the virtualizer's built-in scrollToIndex for consistent positioning.
    // align: 'end' ensures the last item is fully visible at the bottom.
    virtualizer.scrollToIndex(flatItems.length - 1, { align: "end" });
  }, [isPinnedToBottom, flatItems.length, virtualizer]);

  // Detect scroll away from bottom - unpins when user scrolls up
  const handleScroll = useCallback(() => {
    if (!parentRef.current || !onScrollAwayFromBottom) return;

    const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < SCROLL_BOTTOM_THRESHOLD;

    if (!isAtBottom && isPinnedToBottom) {
      onScrollAwayFromBottom();
    }
  }, [isPinnedToBottom, onScrollAwayFromBottom]);

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

  // Find the current date based on scroll position.
  // Simple approach: find the last separator that's been scrolled past.
  let currentDate: Date | null = null;
  let currentSeparatorIndex: number | null = null;

  for (const sep of separators) {
    // Access virtualizer.measurementsCache for accurate separator positions.
    // NOTE: measurementsCache is an internal API of @tanstack/react-virtual.
    // If this breaks in a future version, fall back to pure estimation:
    // const sepStart = sep.index * ROW_HEIGHT_ESTIMATE;
    const measured = virtualizer.measurementsCache[sep.index];
    const sepStart = measured?.start ?? sep.index * ROW_HEIGHT_ESTIMATE;

    if (sepStart <= scrollOffset) {
      currentDate = sep.date;
      currentSeparatorIndex = sep.index;
    } else {
      break;
    }
  }

  // Only show sticky header when scrolled past the first separator
  const showStickyHeader = scrollOffset > 0 && currentDate !== null;

  return (
    <div
      ref={parentRef}
      role="log"
      aria-live="polite"
      aria-label="Log entries"
      aria-busy={isStale}
      data-log-scroll-container
      data-stale={isStale || undefined}
      className={cn(
        "@container",
        "relative h-full overflow-auto",
        "overscroll-contain",
        // Smooth opacity transition for stale state (GPU-accelerated)
        "transition-opacity duration-150 ease-out",
        isStale && "opacity-70",
        className,
      )}
      style={{
        contain: "size layout style",
        // GPU layer promotion for smoother scrolling
        transform: "translateZ(0)",
        backfaceVisibility: "hidden",
      }}
      onScroll={handleScroll}
    >
      {/* CSS sticky header - simple date display, swaps instantly */}
      {showStickyHeader && <StickyHeader date={currentDate} />}

      {/* Virtual list container */}
      <div
        className="relative z-10 w-full"
        style={{
          // Use ceil to ensure container fits all content - floor could clip the last row
          height: `${Math.ceil(virtualizer.getTotalSize())}px`,
          // Contain layout to prevent position recalculations from propagating
          contain: "layout",
          // GPU layer for stable compositing of child transforms
          transform: "translateZ(0)",
        }}
      >
        {virtualItems.map((virtualRow) => {
          const item = flatItems[virtualRow.index];
          if (!item) return null;

          if (item.type === "separator") {
            // Hide inline separator when sticky header is showing the same date
            // and the separator is at or above the sticky header position
            const isCurrentSticky = currentSeparatorIndex === item.index;
            const isUnderStickyHeader = virtualRow.start < scrollOffset + DATE_SEPARATOR_HEIGHT;
            const shouldHide = showStickyHeader && isCurrentSticky && isUnderStickyHeader;

            return (
              <div
                // Use dateKey + index to ensure unique keys across filter changes.
                // Without the index, React may reuse DOM elements when the same date
                // appears in different positions, causing phantom separator artifacts.
                key={`${item.dateKey}-${item.index}`}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className="bg-card absolute top-0 left-0 w-full"
                style={{
                  // Use floor for consistent anchoring - round() can oscillate causing 1px jitter.
                  // translate3d forces GPU compositing layer for stable transforms.
                  transform: `translate3d(0, ${Math.floor(virtualRow.start)}px, 0)`,
                  // Use opacity instead of visibility for GPU-accelerated hiding
                  // This prevents artifacts during fast scrolling
                  opacity: shouldHide ? 0 : 1,
                }}
              >
                <DateSeparator date={item.date} />
              </div>
            );
          }

          // Log entry row
          return (
            <div
              key={item.entry.id}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full"
              style={{
                // Use floor for consistent anchoring - round() can oscillate causing 1px jitter.
                // translate3d forces GPU compositing layer for stable transforms.
                transform: `translate3d(0, ${Math.floor(virtualRow.start)}px, 0)`,
              }}
            >
              <LogEntryRow
                entry={item.entry}
                wrapLines={wrapLines}
                showTask={showTask}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});

export const LogList = memo(LogListInner);
