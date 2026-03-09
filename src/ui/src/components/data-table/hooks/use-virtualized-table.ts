// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import { useSyncedRef, usePrevious } from "@react-hookz/web";
import type { Section } from "@/components/data-table/types";
import { VirtualItemTypes } from "@/components/data-table/constants";

export interface VirtualizedRow {
  index: number;
  start: number;
  size: number;
  key: string | number;
}

export interface UseVirtualizedTableOptions<T, TSectionMeta = unknown> {
  /** Flat data items (mutually exclusive with sections) */
  items?: T[];
  /** Sectioned data (mutually exclusive with items) */
  sections?: Section<T, TSectionMeta>[];
  scrollRef: React.RefObject<HTMLElement | null>;
  rowHeight: number;
  sectionHeight?: number;
  overscan?: number;
  hasNextPage?: boolean;
  onLoadMore?: () => void;
  isFetchingNextPage?: boolean;
}

export interface UseVirtualizedTableResult<T, TSectionMeta = unknown> {
  virtualRows: VirtualizedRow[];
  totalHeight: number;
  totalRowCount: number;
  virtualItemCount: number;
  getItem: (
    index: number,
  ) =>
    | { type: typeof VirtualItemTypes.SECTION; section: Section<T, TSectionMeta> }
    | { type: typeof VirtualItemTypes.ROW; item: T }
    | null;
  measure: () => void;
  scrollToIndex: (index: number, options?: { align?: "start" | "center" | "end" | "auto" }) => void;
  measureElement: (node: Element | null) => void;
}

export function useVirtualizedTable<T, TSectionMeta = unknown>({
  items,
  sections,
  scrollRef,
  rowHeight,
  sectionHeight = 36,
  overscan = 20,
  hasNextPage = false,
  onLoadMore,
  isFetchingNextPage = false,
}: UseVirtualizedTableOptions<T, TSectionMeta>): UseVirtualizedTableResult<T, TSectionMeta> {
  const virtualItems = useMemo(() => {
    if (sections && sections.length > 0) {
      const result: Array<
        | { type: typeof VirtualItemTypes.SECTION; section: Section<T, TSectionMeta>; height: number }
        | { type: typeof VirtualItemTypes.ROW; item: T; height: number }
      > = [];

      for (const section of sections) {
        // Height 0 for skipped headers so they don't allocate vertical space
        const metadata = section.metadata as { skipGroupRow?: boolean } | undefined;
        const shouldSkipHeader = metadata?.skipGroupRow === true;
        const headerHeight = shouldSkipHeader ? 0 : sectionHeight;

        result.push({ type: VirtualItemTypes.SECTION, section, height: headerHeight });
        for (const item of section.items) {
          result.push({ type: VirtualItemTypes.ROW, item, height: rowHeight });
        }
      }

      return result;
    }

    if (items && items.length > 0) {
      return items.map((item) => ({
        type: VirtualItemTypes.ROW as typeof VirtualItemTypes.ROW,
        item,
        height: rowHeight,
      }));
    }

    return [];
  }, [items, sections, rowHeight, sectionHeight]);

  const virtualItemsRef = useSyncedRef(virtualItems);
  const virtualizerRef = useRef<Virtualizer<HTMLElement, Element> | null>(null);

  // Dispatched from TV's onChange(sync=false); captured by flushSync in makeRowRef
  // to commit row positions synchronously before paint.
  const [, forceSyncTick] = useReducer((x: number) => x + 1, 0);

  const estimateSize = useCallback(
    (index: number) => virtualItemsRef.current[index]?.height ?? rowHeight,
    [virtualItemsRef, rowHeight],
  );

  // Uses virtual index (not item ID) so duplicate items (e.g. a resource in
  // multiple pools) get independent entries in TV's itemSizeCache.
  const getItemKey = useCallback(
    (index: number) => {
      const item = virtualItemsRef.current[index];
      if (!item) return index;
      if (item.type === VirtualItemTypes.SECTION) return `section-${item.section.id}`;
      return index;
    },
    [virtualItemsRef],
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns unstable functions by design. React Compiler skips optimization. See: https://github.com/facebook/react/issues/33057
  const virtualizer = useVirtualizer({
    count: virtualItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    overscan,
    getItemKey,
    onChange: (_instance, sync) => {
      // Only for resize events (sync=false), not scroll updates
      if (!sync) {
        forceSyncTick();
      }
    },
  });

  virtualizerRef.current = virtualizer;

  const measure = useCallback(() => {
    virtualizerRef.current?.measure();
  }, []);

  useEffect(() => {
    virtualizer.measure();
  }, [rowHeight, sectionHeight, virtualizer]);

  const rawVirtualItems = virtualizer.getVirtualItems();
  const virtualRows: VirtualizedRow[] = rawVirtualItems.map((row) => ({
    index: row.index,
    start: row.start,
    size: row.size,
    key: String(row.key),
  }));

  const onLoadMoreRef = useSyncedRef(onLoadMore);
  const loadMoreTriggeredRef = useRef(false);

  // Reset when new data arrives so another page can be requested
  const currentItemCount = items?.length ?? 0;
  const prevItemCount = usePrevious(currentItemCount);
  useEffect(() => {
    if (currentItemCount !== prevItemCount) {
      loadMoreTriggeredRef.current = false;
    }
  }, [currentItemCount, prevItemCount]);

  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;

    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    let isActive = true;

    const checkLoadMore = () => {
      if (!isActive) return;
      if (loadMoreTriggeredRef.current) return;

      const rows = virtualizer.getVirtualItems();
      const lastRow = rows.at(-1);
      if (!lastRow) return;

      const LOAD_MORE_THRESHOLD = 10;
      if (lastRow.index >= virtualItems.length - LOAD_MORE_THRESHOLD) {
        loadMoreTriggeredRef.current = true;
        onLoadMoreRef.current?.();
      }
    };

    scrollElement.addEventListener("scroll", checkLoadMore, { passive: true });

    const INITIAL_CHECK_DELAY_MS = 100;
    const timeoutId = setTimeout(checkLoadMore, INITIAL_CHECK_DELAY_MS);

    return () => {
      isActive = false;
      scrollElement.removeEventListener("scroll", checkLoadMore);
      clearTimeout(timeoutId);
    };
  }, [scrollRef, virtualItems.length, hasNextPage, isFetchingNextPage, virtualizer, onLoadMoreRef]);

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

  const totalRowCount = useMemo(() => {
    if (sections) {
      return sections.reduce((sum, s) => sum + s.items.length, 0);
    }
    return items?.length ?? 0;
  }, [items, sections]);

  const scrollToIndex = useCallback(
    (index: number, options?: { align?: "start" | "center" | "end" | "auto" }) => {
      virtualizer.scrollToIndex(index, {
        align: options?.align ?? "auto",
        behavior: "auto",
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
    measure,
    scrollToIndex,
    measureElement: virtualizer.measureElement,
  };
}
