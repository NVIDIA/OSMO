/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

"use client";

import { memo, useCallback, useEffect, useMemo } from "react";
import { useVirtualizerCompat } from "@/hooks";
import { cn } from "@/lib/utils";
import { LoadingMoreIndicator } from "@/components/loading-more-indicator";
import type { VirtualItem, Section, ColumnConfig } from "./types";
import {
  itemsToVirtualItems,
  sectionsToVirtualItems,
} from "./types";

// =============================================================================
// Types
// =============================================================================

interface TableBodyProps<T, TColumnId extends string, TMetadata> {
  /** Items (for flat list) */
  items?: T[];
  /** Sections (for grouped list) */
  sections?: Section<T, TMetadata>[];
  /** Row key extractor */
  getRowKey: (item: T) => string;
  /** Column definitions */
  columns: ColumnConfig<TColumnId>[];
  /** Visible column IDs */
  visibleColumnIds: TColumnId[];
  /** CSS grid template */
  gridTemplate: string;
  /** Cell renderer */
  renderCell: (item: T, columnId: TColumnId) => React.ReactNode;
  /** Section header renderer */
  renderSectionHeader?: (section: Section<T, TMetadata>, columnCount: number) => React.ReactNode;
  /** Row height */
  rowHeight: number;
  /** Section header height */
  sectionHeight?: number;
  /** Scroll container ref */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Row click handler */
  onRowClick?: (item: T, event: React.MouseEvent | React.KeyboardEvent) => void;
  /** Selected item key */
  selectedKey?: string | null;
  /** Custom row class */
  rowClassName?: string | ((item: T) => string);
  /** Loading state */
  isLoading?: boolean;
  /** Loading row count */
  loadingRowCount?: number;
  /** Empty state */
  emptyState?: React.ReactNode;
  /** Has next page */
  hasNextPage?: boolean;
  /** Load more callback */
  onLoadMore?: () => void;
  /** Is fetching next page */
  isFetchingNextPage?: boolean;
  /** Total count */
  totalCount?: number;
}

// =============================================================================
// Loading Skeleton
// =============================================================================

function LoadingSkeleton<TColumnId extends string>({
  columns,
  visibleColumnIds,
  gridTemplate,
  rowCount,
}: {
  columns: ColumnConfig<TColumnId>[];
  visibleColumnIds: TColumnId[];
  gridTemplate: string;
  rowCount: number;
}) {
  return (
    <div style={{ contain: "content" }}>
      {Array.from({ length: rowCount }).map((_, i) => (
        <div
          key={i}
          className="grid gap-0 border-b border-zinc-100 py-3 dark:border-zinc-800/50"
          style={{ gridTemplateColumns: gridTemplate, contain: "layout style" }}
        >
          {visibleColumnIds.map((columnId) => {
            const column = columns.find((c) => c.id === columnId);
            const width = column?.minWidth ?? 80;
            return (
              <div key={columnId} className="px-3">
                <div
                  className="h-4 skeleton-shimmer rounded"
                  style={{ width: Math.min(width - 24, 160) }}
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// Table Body Component
// =============================================================================

export const TableBody = memo(function TableBody<
  T,
  TColumnId extends string,
  TMetadata,
>({
  items,
  sections,
  getRowKey,
  columns,
  visibleColumnIds,
  gridTemplate,
  renderCell,
  renderSectionHeader,
  rowHeight,
  sectionHeight = 36,
  scrollRef,
  onRowClick,
  selectedKey,
  rowClassName,
  isLoading = false,
  loadingRowCount = 5,
  emptyState,
  hasNextPage = false,
  onLoadMore,
  isFetchingNextPage = false,
  totalCount,
}: TableBodyProps<T, TColumnId, TMetadata>) {
  // Convert to virtual items
  const virtualItems = useMemo<VirtualItem<T, TMetadata>[]>(() => {
    if (sections && sections.length > 0) {
      return sectionsToVirtualItems(sections);
    }
    if (items && items.length > 0) {
      return itemsToVirtualItems(items);
    }
    return [];
  }, [items, sections]);

  // Item size estimator (sections have different height)
  const estimateSize = useCallback(
    (index: number) => {
      const item = virtualItems[index];
      if (!item) return rowHeight;
      return item.type === "section" ? sectionHeight : rowHeight;
    },
    [virtualItems, rowHeight, sectionHeight],
  );

  // Virtualizer
  const rowVirtualizer = useVirtualizerCompat({
    count: virtualItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    overscan: 5,
  });

  // Re-measure when row height changes
  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowHeight, sectionHeight, rowVirtualizer]);

  // Infinite scroll trigger
  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement || !onLoadMore) return;

    const checkLoadMore = () => {
      if (!hasNextPage || isFetchingNextPage) return;

      const virtualRows = rowVirtualizer.getVirtualItems();
      const lastItem = virtualRows.at(-1);

      if (!lastItem) return;

      // Load more when within 10 items of end
      const threshold = 10;
      if (lastItem.index >= virtualItems.length - threshold) {
        onLoadMore();
      }
    };

    scrollElement.addEventListener("scroll", checkLoadMore, { passive: true });
    checkLoadMore();

    return () => {
      scrollElement.removeEventListener("scroll", checkLoadMore);
    };
  }, [scrollRef, rowVirtualizer, virtualItems.length, hasNextPage, isFetchingNextPage, onLoadMore]);

  // Handle row click and keyboard
  const handleRowInteraction = useCallback(
    (item: T, event: React.MouseEvent | React.KeyboardEvent) => {
      if (event.type === "keydown") {
        const keyEvent = event as React.KeyboardEvent;
        if (keyEvent.key !== "Enter" && keyEvent.key !== " ") return;
        event.preventDefault();
      }
      onRowClick?.(item, event);
    },
    [onRowClick],
  );

  // Loading state
  if (isLoading) {
    return (
      <LoadingSkeleton
        columns={columns}
        visibleColumnIds={visibleColumnIds}
        gridTemplate={gridTemplate}
        rowCount={loadingRowCount}
      />
    );
  }

  // Empty state
  if (virtualItems.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {emptyState ?? "No items found"}
      </div>
    );
  }

  // Get total item count (for display)
  const totalItems = sections
    ? sections.reduce((sum, s) => sum + s.items.length, 0)
    : items?.length ?? 0;

  return (
    <>
      <div
        role="rowgroup"
        style={{
          height: rowVirtualizer.getTotalSize(),
          position: "relative",
          contain: "strict",
          isolation: "isolate",
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const item = virtualItems[virtualRow.index];
          if (!item) return null;

          // Section header
          if (item.type === "section") {
            return (
              <div
                key={`section-${item.section.id}`}
                className="virtual-item"
                style={{
                  height: virtualRow.size,
                  transform: `translate3d(0, ${virtualRow.start}px, 0)`,
                }}
              >
                {renderSectionHeader?.(item.section, visibleColumnIds.length)}
              </div>
            );
          }

          // Data row
          const rowKey = getRowKey(item.item);
          const isSelected = selectedKey === rowKey;
          const customClass =
            typeof rowClassName === "function"
              ? rowClassName(item.item)
              : rowClassName;

          return (
            <div
              key={rowKey}
              role="row"
              tabIndex={0}
              onClick={(e) => handleRowInteraction(item.item, e)}
              onKeyDown={(e) => handleRowInteraction(item.item, e)}
              aria-selected={isSelected}
              className="virtual-item"
              style={{
                height: virtualRow.size,
                transform: `translate3d(0, ${virtualRow.start}px, 0)`,
              }}
            >
              <div
                className={cn(
                  "grid h-full cursor-pointer items-center gap-0 border-b border-zinc-100 text-sm",
                  "transition-[background-color] duration-150",
                  "hover:bg-zinc-50 dark:border-zinc-800/50 dark:hover:bg-zinc-900",
                  "focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500",
                  isSelected && "bg-blue-50 dark:bg-blue-950/30",
                  customClass,
                )}
                style={{
                  gridTemplateColumns: gridTemplate,
                  contain: "layout style",
                }}
              >
                {visibleColumnIds.map((columnId) => {
                  const column = columns.find((c) => c.id === columnId);
                  return (
                    <div
                      key={columnId}
                      role="cell"
                      className={cn(
                        "truncate px-3",
                        column?.align === "right" && "text-right",
                      )}
                    >
                      {renderCell(item.item, columnId)}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Loading indicator */}
      <LoadingMoreIndicator
        isLoading={isFetchingNextPage}
        hasMore={hasNextPage}
        loadedCount={totalItems}
        totalCount={totalCount}
      />
    </>
  );
}) as <T, TColumnId extends string, TMetadata>(
  props: TableBodyProps<T, TColumnId, TMetadata>,
) => React.ReactElement;
