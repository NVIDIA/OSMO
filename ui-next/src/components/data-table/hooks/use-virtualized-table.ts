/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Hook for virtualized table rendering.
 *
 * Wraps TanStack Virtual to work with native <table> elements.
 * Provides row indices, positions, and infinite scroll detection.
 *
 * Note: Requires @tanstack/react-virtual 3.13.12 (not 3.13.13+) to avoid
 * flushSync warnings during render. See https://github.com/TanStack/virtual/issues/1094
 */

"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useStableCallback, useStableValue } from "@/hooks";
import type { Section } from "../types";

// =============================================================================
// Types
// =============================================================================

export interface VirtualizedRow {
  /** Index in the virtual list */
  index: number;
  /** Pixel offset from top */
  start: number;
  /** Row height in pixels */
  size: number;
  /** Unique key for React */
  key: string | number;
}

export interface UseVirtualizedTableOptions<T, TSectionMeta = unknown> {
  /** Flat data items (mutually exclusive with sections) */
  items?: T[];
  /** Sectioned data (mutually exclusive with items) */
  sections?: Section<T, TSectionMeta>[];
  /** Row key extractor */
  getRowId: (item: T) => string;
  /** Scroll container ref */
  scrollRef: React.RefObject<HTMLElement | null>;
  /** Row height in pixels */
  rowHeight: number;
  /** Section header height (required if using sections) */
  sectionHeight?: number;
  /** Overscan count for virtualization */
  overscan?: number;
  /** Enable infinite scroll */
  hasNextPage?: boolean;
  /** Load more callback */
  onLoadMore?: () => void;
  /** Is currently loading more */
  isFetchingNextPage?: boolean;
}

export interface UseVirtualizedTableResult<T, TSectionMeta = unknown> {
  /** Virtual rows to render */
  virtualRows: VirtualizedRow[];
  /** Total height of all rows */
  totalHeight: number;
  /** Total data row count (excluding section headers, for aria-rowcount) */
  totalRowCount: number;
  /** Total virtual item count (sections + data rows, for navigation) */
  virtualItemCount: number;
  /** Get item for a virtual row index */
  getItem: (index: number) => { type: "section"; section: Section<T, TSectionMeta> } | { type: "row"; item: T } | null;
  /** Trigger measurement recalculation */
  measure: () => void;
  /** Scroll to a specific virtual index */
  scrollToIndex: (index: number, options?: { align?: "start" | "center" | "end" | "auto" }) => void;
}

// =============================================================================
// Hook
// =============================================================================

export function useVirtualizedTable<T, TSectionMeta = unknown>({
  items,
  sections,
  getRowId,
  scrollRef,
  rowHeight,
  sectionHeight = 36,
  overscan = 5,
  hasNextPage = false,
  onLoadMore,
  isFetchingNextPage = false,
}: UseVirtualizedTableOptions<T, TSectionMeta>): UseVirtualizedTableResult<T, TSectionMeta> {
  // Build flat list of virtual items (sections + rows or just rows)
  const virtualItems = useMemo(() => {
    if (sections && sections.length > 0) {
      const result: Array<
        | { type: "section"; section: Section<T, TSectionMeta>; height: number }
        | { type: "row"; item: T; height: number }
      > = [];

      for (const section of sections) {
        result.push({ type: "section", section, height: sectionHeight });
        for (const item of section.items) {
          result.push({ type: "row", item, height: rowHeight });
        }
      }

      return result;
    }

    if (items && items.length > 0) {
      return items.map((item) => ({ type: "row" as const, item, height: rowHeight }));
    }

    return [];
  }, [items, sections, rowHeight, sectionHeight]);

  // Stable refs for accessing changing data in stable callbacks
  const virtualItemsRef = useStableValue(virtualItems);
  const stableGetRowId = useStableCallback(getRowId);

  // Estimate size function - stable callback using ref
  const estimateSize = useCallback(
    (index: number) => virtualItemsRef.current[index]?.height ?? rowHeight,
    [virtualItemsRef, rowHeight],
  );

  // Get item key - stable callback using refs
  const getItemKey = useCallback(
    (index: number) => {
      const item = virtualItemsRef.current[index];
      if (!item) return index;
      if (item.type === "section") return `section-${item.section.id}`;
      return stableGetRowId(item.item);
    },
    [virtualItemsRef, stableGetRowId],
  );

  // Create virtualizer with stable callbacks
  const virtualizer = useVirtualizer({
    count: virtualItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    overscan,
    getItemKey,
  });

  // Re-measure when heights change
  useEffect(() => {
    virtualizer.measure();
  }, [rowHeight, sectionHeight]);

  // Get virtual items - TanStack Virtual handles reactivity internally
  const virtualRows: VirtualizedRow[] = virtualizer.getVirtualItems().map((row) => ({
    index: row.index,
    start: row.start,
    size: row.size,
    key: String(row.key),
  }));

  // Infinite scroll detection - stable callback to avoid re-subscribe on every render
  const stableOnLoadMore = useStableCallback(onLoadMore);

  // Track if we've already triggered load more to prevent duplicate calls
  const loadMoreTriggeredRef = useRef(false);

  // Reset the trigger flag when fetching completes
  useEffect(() => {
    if (!isFetchingNextPage) {
      loadMoreTriggeredRef.current = false;
    }
  }, [isFetchingNextPage]);

  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;

    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    // Track if effect is still active to prevent stale callback execution
    let isActive = true;

    const checkLoadMore = () => {
      // Guard against stale execution after unmount
      if (!isActive) return;

      if (loadMoreTriggeredRef.current) return;

      const rows = virtualizer.getVirtualItems();
      const lastRow = rows.at(-1);
      if (!lastRow) return;

      // Trigger load when within threshold items of end (balances UX with network efficiency)
      const LOAD_MORE_THRESHOLD = 10;
      if (lastRow.index >= virtualItems.length - LOAD_MORE_THRESHOLD) {
        loadMoreTriggeredRef.current = true;
        stableOnLoadMore?.();
      }
    };

    scrollElement.addEventListener("scroll", checkLoadMore, { passive: true });

    // Initial check after layout settles (100ms is typical for initial render)
    const INITIAL_CHECK_DELAY_MS = 100;
    const timeoutId = setTimeout(checkLoadMore, INITIAL_CHECK_DELAY_MS);

    return () => {
      isActive = false;
      scrollElement.removeEventListener("scroll", checkLoadMore);
      clearTimeout(timeoutId);
    };
  }, [scrollRef, virtualItems.length, hasNextPage, isFetchingNextPage, virtualizer, stableOnLoadMore]);

  // Get item for a virtual row index
  const getItem = useCallback(
    (index: number) => {
      const item = virtualItems[index];
      if (!item) return null;
      if (item.type === "section") {
        return { type: "section" as const, section: item.section };
      }
      return { type: "row" as const, item: item.item };
    },
    [virtualItems],
  );

  // Count total data rows (excluding section headers)
  const totalRowCount = useMemo(() => {
    if (sections) {
      return sections.reduce((sum, s) => sum + s.items.length, 0);
    }
    return items?.length ?? 0;
  }, [items, sections]);

  // Scroll to a specific index
  const scrollToIndex = useCallback(
    (index: number, options?: { align?: "start" | "center" | "end" | "auto" }) => {
      virtualizer.scrollToIndex(index, { 
        align: options?.align ?? "auto",
        behavior: "auto", // instant for keyboard nav
      });
    },
    [virtualizer],
  );

  return {
    virtualRows,
    totalHeight: virtualizer.getTotalSize(),
    totalRowCount,
    virtualItemCount: virtualItems.length,
    getItem,
    measure: () => virtualizer.measure(),
    scrollToIndex,
  };
}
