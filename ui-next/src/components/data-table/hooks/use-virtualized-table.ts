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
  /** Total row count (for aria-rowcount) */
  totalRowCount: number;
  /** Get item for a virtual row index */
  getItem: (index: number) => { type: "section"; section: Section<T, TSectionMeta> } | { type: "row"; item: T } | null;
  /** Trigger measurement recalculation */
  measure: () => void;
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

  // Store virtualItems in a ref for stable access in callbacks
  const virtualItemsRef = useRef(virtualItems);
  virtualItemsRef.current = virtualItems;
  
  // Store getRowId in a ref for stable access
  const getRowIdRef = useRef(getRowId);
  getRowIdRef.current = getRowId;

  // Estimate size function - use ref for stable callback
  const estimateSize = useCallback(
    (index: number) => virtualItemsRef.current[index]?.height ?? rowHeight,
    [rowHeight],
  );
  
  // Get item key - use ref for stable callback
  const getItemKey = useCallback(
    (index: number) => {
      const item = virtualItemsRef.current[index];
      if (!item) return index;
      if (item.type === "section") return `section-${item.section.id}`;
      return getRowIdRef.current(item.item);
    },
    [],
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowHeight, sectionHeight]);

  // Get virtual items - TanStack Virtual handles reactivity internally
  const virtualRows: VirtualizedRow[] = virtualizer.getVirtualItems().map((row) => ({
    index: row.index,
    start: row.start,
    size: row.size,
    key: String(row.key),
  }));

  // Infinite scroll detection - use refs for callbacks to avoid re-subscribe on every render
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;
  
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

    const checkLoadMore = () => {
      const callback = onLoadMoreRef.current;
      if (!callback || loadMoreTriggeredRef.current) return;
      
      const rows = virtualizer.getVirtualItems();
      const lastRow = rows.at(-1);
      if (!lastRow) return;

      // Load more when within 10 items of end
      const threshold = 10;
      if (lastRow.index >= virtualItems.length - threshold) {
        loadMoreTriggeredRef.current = true;
        callback();
      }
    };

    scrollElement.addEventListener("scroll", checkLoadMore, { passive: true });
    
    // Check on mount after a short delay
    const timeoutId = setTimeout(checkLoadMore, 100);

    return () => {
      scrollElement.removeEventListener("scroll", checkLoadMore);
      clearTimeout(timeoutId);
    };
  }, [scrollRef, virtualItems.length, hasNextPage, isFetchingNextPage, virtualizer]);

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

  return {
    virtualRows,
    totalHeight: virtualizer.getTotalSize(),
    totalRowCount,
    getItem,
    measure: () => virtualizer.measure(),
  };
}
