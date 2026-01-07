/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
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
import { VirtualItemTypes, type VirtualItemType } from "../constants";

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
  getItem: (index: number) => { type: typeof VirtualItemTypes.SECTION; section: Section<T, TSectionMeta> } | { type: typeof VirtualItemTypes.ROW; item: T } | null;
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
        | { type: typeof VirtualItemTypes.SECTION; section: Section<T, TSectionMeta>; height: number }
        | { type: typeof VirtualItemTypes.ROW; item: T; height: number }
      > = [];

      for (const section of sections) {
        result.push({ type: VirtualItemTypes.SECTION, section, height: sectionHeight });
        for (const item of section.items) {
          result.push({ type: VirtualItemTypes.ROW, item, height: rowHeight });
        }
      }

      return result;
    }

    if (items && items.length > 0) {
      return items.map((item) => ({ type: VirtualItemTypes.ROW as typeof VirtualItemTypes.ROW, item, height: rowHeight }));
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
      if (item.type === VirtualItemTypes.SECTION) return `section-${item.section.id}`;
      return stableGetRowId(item.item);
    },
    [virtualItemsRef, stableGetRowId],
  );

  // Create virtualizer with stable callbacks
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns unstable functions by design. React Compiler skips optimization. See: https://github.com/facebook/react/issues/33057
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
  }, [rowHeight, sectionHeight, virtualizer]);

  // Get virtual items - TanStack Virtual handles reactivity internally
  const virtualRows: VirtualizedRow[] = virtualizer.getVirtualItems().map((row) => ({
    index: row.index,
    start: row.start,
    size: row.size,
    key: String(row.key),
  }));

  // Stable ref for optional load more callback
  const onLoadMoreRef = useStableValue(onLoadMore);

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
        onLoadMoreRef.current?.();
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
  }, [scrollRef, virtualItems.length, hasNextPage, isFetchingNextPage, virtualizer, onLoadMoreRef]);

  // Get item for a virtual row index
  const getItem = useCallback(
    (index: number) => {
      const item = virtualItems[index];
      if (!item) return null;
      if (item.type === VirtualItemTypes.SECTION) {
        return { type: VirtualItemTypes.SECTION as typeof VirtualItemTypes.SECTION, section: item.section };
      }
      return { type: VirtualItemTypes.ROW as typeof VirtualItemTypes.ROW, item: item.item };
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
