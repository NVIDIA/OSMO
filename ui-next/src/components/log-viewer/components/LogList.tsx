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

import {
  useRef,
  useCallback,
  memo,
  useLayoutEffect,
  useEffect,
  useState,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from "react";
import { cn } from "@/lib/utils";
import { formatDateShort } from "@/lib/format-date";
import type { LogEntry } from "@/lib/api/log-adapter/types";
import { useVirtualizerCompat } from "@/hooks/use-virtualizer-compat";
import { LogEntryRow } from "@/components/log-viewer/components/LogEntryRow";
import { useLogViewerStore } from "@/components/log-viewer/store/log-viewer-store";
import {
  ROW_HEIGHT_ESTIMATE,
  DATE_SEPARATOR_HEIGHT,
  OVERSCAN_COUNT,
  SCROLL_BOTTOM_THRESHOLD,
} from "@/components/log-viewer/lib/constants";
import { useIncrementalFlatten } from "@/components/log-viewer/lib/use-incremental-flatten";
import { useServices } from "@/contexts/service-context";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/shadcn/context-menu";

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
  /**
   * Force-hide task tags regardless of store state.
   * Used when scoped to a single task where the tag is redundant.
   */
  hideTask?: boolean;
}

// =============================================================================
// Date Separator (Inlined)
// =============================================================================

interface DateSeparatorProps {
  date: Date;
  className?: string;
}

/**
 * A subtle date separator row for providing date context in log lists.
 * Uses .dashed-line-separator utility from src/styles/utilities.css
 */
const DateSeparator = memo(function DateSeparator({ date, className }: DateSeparatorProps) {
  const formattedDate = formatDateShort(date);

  return (
    <div
      className={cn("flex items-center gap-2 px-3 py-1", className)}
      role="separator"
      aria-label={`Logs from ${formattedDate}`}
    >
      <div className="dashed-line-separator h-px flex-1" />
      <span className="text-muted-foreground/50 shrink-0 text-[10px] tracking-wider uppercase">{formattedDate}</span>
      <div className="dashed-line-separator h-px flex-1" />
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
// Selection helper
// =============================================================================

/** Walk up the DOM to find the nearest data-entry-id attribute. */
function findEntryId(element: Element | null): string | null {
  let current: Element | null = element;
  while (current) {
    const id = current.getAttribute("data-entry-id");
    if (id) return id;
    current = current.parentElement;
  }
  return null;
}

// =============================================================================
// Main Component
// =============================================================================

const LogListInner = forwardRef<LogListHandle, LogListProps>(function LogListInner(
  { entries, className, isPinnedToBottom = false, onScrollAwayFromBottom, isStale = false, hideTask = false },
  ref,
) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { clipboard } = useServices();

  // Track programmatic scrolls to avoid unpinning during auto-scroll
  const isAutoScrollingRef = useRef(false);

  // Get store values at parent level - avoid per-row subscriptions
  const wrapLines = useLogViewerStore((s) => s.wrapLines);
  const showTaskStore = useLogViewerStore((s) => s.showTask);
  // Force-hide task tags when scoped to a single task (hideTask overrides store)
  const showTask = hideTask ? false : showTaskStore;

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
        // Mark as programmatic scroll to avoid unpinning
        isAutoScrollingRef.current = true;
        virtualizer.scrollToIndex(flatItems.length - 1, { align: "end" });
        // Clear flag after scroll events
        setTimeout(() => {
          isAutoScrollingRef.current = false;
        }, 150);
      },
    }),
    [virtualizer, flatItems.length],
  );

  // Auto-scroll to bottom when pinned.
  // Uses the virtualizer's scrollToIndex for stable positioning - no manual
  // scroll calculations that can race with virtualizer updates.
  useLayoutEffect(() => {
    if (!isPinnedToBottom || flatItems.length === 0) return;

    // Mark that we're programmatically scrolling to avoid unpinning
    isAutoScrollingRef.current = true;

    // Use the virtualizer's built-in scrollToIndex for consistent positioning.
    // align: 'end' ensures the last item is fully visible at the bottom.
    virtualizer.scrollToIndex(flatItems.length - 1, { align: "end" });

    // Clear the flag after scroll events have fired (typically < 100ms)
    const timer = setTimeout(() => {
      isAutoScrollingRef.current = false;
    }, 150);

    return () => clearTimeout(timer);
  }, [isPinnedToBottom, flatItems.length, virtualizer]);

  // ── Row range selection ──────────────────────────────────────────────────
  // Virtual list rows are position:absolute, so native browser text selection
  // can't cross between them. We implement a terminal-style row selection:
  //   • click          → set anchor (single row selected)
  //   • shift+click    → extend selection from existing anchor
  //   • pointerdown+move → drag to highlight a range (pointer capture used
  //                        so events keep firing even outside the container)
  //   • Ctrl/Cmd+C     → copies only the .message of selected rows

  // O(1) entry lookup: id → index in `entries` array
  const entryIdToIndex = useMemo(() => {
    const map = new Map<string, number>();
    entries.forEach((entry, i) => map.set(entry.id, i));
    return map;
  }, [entries]);

  // Selection includes its epoch (resetCount when it was set) so it self-invalidates
  // when entries are fully replaced — no effect needed to clear it.
  const [selection, setSelection] = useState<{
    anchorIdx: number;
    focusIdx: number;
    epoch: number;
  } | null>(null);
  // anchorIdxRef stores epoch too so shift+click and drag can detect stale anchors
  const anchorIdxRef = useRef<{ idx: number; epoch: number }>({ idx: -1, epoch: -1 });

  // Derived: selection is valid only if it was set in the current epoch
  const effectiveSelection = selection?.epoch === resetCount ? selection : null;

  // Sorted bounds for O(1) isSelected check per rendered row
  const selectionBounds = useMemo(() => {
    if (!effectiveSelection) return null;
    return {
      start: Math.min(effectiveSelection.anchorIdx, effectiveSelection.focusIdx),
      end: Math.max(effectiveSelection.anchorIdx, effectiveSelection.focusIdx),
    };
  }, [effectiveSelection]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      // elementFromPoint resolves the actual element even after pointer capture
      const id = findEntryId(document.elementFromPoint(e.clientX, e.clientY));
      if (!id) {
        setSelection(null);
        anchorIdxRef.current = { idx: -1, epoch: resetCount };
        return;
      }
      const idx = entryIdToIndex.get(id) ?? -1;
      if (idx === -1) return;

      if (e.shiftKey && anchorIdxRef.current.epoch === resetCount && anchorIdxRef.current.idx !== -1) {
        // Extend from existing anchor — don't change the anchor
        setSelection({ anchorIdx: anchorIdxRef.current.idx, focusIdx: idx, epoch: resetCount });
        return;
      }

      // New selection: capture pointer so drag events keep coming even if
      // the cursor leaves the scroll container or the browser window.
      anchorIdxRef.current = { idx, epoch: resetCount };
      setSelection({ anchorIdx: idx, focusIdx: idx, epoch: resetCount });
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    },
    [entryIdToIndex, resetCount],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!(e.buttons & 1) || anchorIdxRef.current.epoch !== resetCount || anchorIdxRef.current.idx === -1) return;
      const id = findEntryId(document.elementFromPoint(e.clientX, e.clientY));
      if (!id) return;
      const idx = entryIdToIndex.get(id) ?? -1;
      if (idx !== -1) setSelection({ anchorIdx: anchorIdxRef.current.idx, focusIdx: idx, epoch: resetCount });
    },
    [entryIdToIndex, resetCount],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
  }, []);

  // Refs so the global keydown handler always reads fresh values without
  // being recreated on every selection/entries change (avoids add/remove churn).
  const selectionRef = useRef(effectiveSelection);
  const entriesRef = useRef(entries);
  useLayoutEffect(() => {
    selectionRef.current = effectiveSelection;
  }, [effectiveSelection]);
  useLayoutEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  // Single shared copy function — called by both the global keydown handler
  // and the right-click context menu, reads from refs to avoid stale closures.
  const copySelection = useCallback(() => {
    const sel = selectionRef.current;
    if (!sel) return;
    const startIdx = Math.min(sel.anchorIdx, sel.focusIdx);
    const endIdx = Math.max(sel.anchorIdx, sel.focusIdx);
    const text = entriesRef.current
      .slice(startIdx, endIdx + 1)
      .map((entry) => entry.message)
      .join("\n");
    void clipboard.copy(text);
  }, [clipboard]);

  // Global keydown — fires regardless of which element has focus, so Cmd/Ctrl+C
  // works even after the user clicks a button elsewhere on the page.
  // Guard: skip when a text field has focus so we don't steal normal copy actions.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "c") return;
      if (!selectionRef.current) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      )
        return;
      copySelection();
      e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [copySelection]);

  // Detect scroll away from bottom - unpins when user scrolls up
  const handleScroll = useCallback(() => {
    if (!parentRef.current || !onScrollAwayFromBottom) return;

    // Ignore scroll events triggered by programmatic auto-scroll
    // This prevents the auto-scroll itself from unpinning the auto-scroll
    if (isAutoScrollingRef.current) return;

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
    <ContextMenu>
      <ContextMenuTrigger asChild>
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
            "contain-size-layout-style gpu-layer",
            className,
          )}
          onScroll={handleScroll}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {/* CSS sticky header - simple date display, swaps instantly */}
          {showStickyHeader && <StickyHeader date={currentDate} />}

          {/* Virtual list container */}
          <div
            className="gpu-layer relative z-10 w-full contain-layout"
            style={{
              // Use ceil to ensure container fits all content - floor could clip the last row
              height: `${Math.ceil(virtualizer.getTotalSize())}px`,
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
              const entryIdx = entryIdToIndex.get(item.entry.id) ?? -1;
              const isSelected =
                selectionBounds !== null && entryIdx >= selectionBounds.start && entryIdx <= selectionBounds.end;

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
                    isSelected={isSelected}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem
          onClick={copySelection}
          disabled={!effectiveSelection}
        >
          Copy
          <ContextMenuShortcut>⌘C</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

export const LogList = memo(LogListInner);
