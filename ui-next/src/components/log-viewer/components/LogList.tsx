// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { useRef, useCallback, useEffect, memo } from "react";
import { cn } from "@/lib/utils";
import type { LogEntry } from "@/lib/api/log-adapter";
import { useVirtualizerCompat } from "@/hooks/use-virtualizer-compat";
import { LogEntryRow } from "./LogEntryRow";
import { useLogViewerStore } from "../store/log-viewer-store";

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

// =============================================================================
// Constants
// =============================================================================

/** Estimated row height for virtualization */
const ROW_HEIGHT_ESTIMATE = 32;

/** Threshold for detecting scroll to bottom (pixels from bottom) */
const SCROLL_BOTTOM_THRESHOLD = 50;

/** Overscan count for smooth scrolling */
const OVERSCAN_COUNT = 10;

// =============================================================================
// Component
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
  const expandedEntryIds = useLogViewerStore((s) => s.expandedEntryIds);
  const wrapLines = useLogViewerStore((s) => s.wrapLines);
  const toggleExpand = useLogViewerStore((s) => s.toggleExpand);

  // Virtualizer instance
  const virtualizer = useVirtualizerCompat({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback(
      (index: number) => {
        // Expanded rows are taller
        const entry = entries[index];
        if (entry && expandedEntryIds.has(entry.id)) {
          return ROW_HEIGHT_ESTIMATE * 4; // Expanded height estimate
        }
        return ROW_HEIGHT_ESTIMATE;
      },
      [entries, expandedEntryIds],
    ),
    overscan: OVERSCAN_COUNT,
  });

  // Auto-scroll to bottom when tailing
  useEffect(() => {
    if (isTailing && entries.length > 0) {
      virtualizer.scrollToIndex(entries.length - 1, { align: "end", behavior: "smooth" });
    }
  }, [isTailing, entries.length, virtualizer]);

  // Detect scroll away from bottom
  const handleScroll = useCallback(() => {
    if (!parentRef.current || !onScrollAwayFromBottom) return;

    const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < SCROLL_BOTTOM_THRESHOLD;

    if (!isAtBottom && isTailing) {
      onScrollAwayFromBottom();
    }
  }, [isTailing, onScrollAwayFromBottom]);

  const virtualItems = virtualizer.getVirtualItems();

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
      className={cn(
        "relative h-full overflow-auto",
        "content-visibility-auto contain-strict",
        "overscroll-contain",
        className,
      )}
      style={{ containIntrinsicSize: `auto ${ROW_HEIGHT_ESTIMATE}px` }}
      onScroll={handleScroll}
    >
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualItems.map((virtualItem) => {
          const entry = entries[virtualItem.index];
          if (!entry) return null;

          const isExpanded = expandedEntryIds.has(entry.id);

          return (
            <div
              key={entry.id}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full"
              style={{
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <LogEntryRow
                entry={entry}
                isExpanded={isExpanded}
                wrapLines={wrapLines}
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
