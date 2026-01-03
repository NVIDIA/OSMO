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

import { memo, useEffect, useCallback } from "react";
import { useVirtualizerCompat } from "@/hooks";
import { LoadingMoreIndicator } from "@/components/loading-more-indicator";
import { cn } from "@/lib/utils";
import { getResourceAllocationTypeDisplay } from "@/lib/constants/ui";
import type { Resource } from "@/lib/api/adapter";
import type { DisplayMode } from "@/stores";
import type { ResourceColumnId } from "../../lib";
import { CapacityCell } from "../cells";

interface TableContentProps {
  resources: Resource[];
  isLoading: boolean;
  displayMode: DisplayMode;
  /** IDs of columns to display (in order) */
  visibleColumnIds: ResourceColumnId[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  rowHeight: number;
  onRowClick: (resource: Resource, rowElement?: HTMLElement) => void;
  hasNextPage?: boolean;
  onLoadMore?: () => void;
  isFetchingNextPage?: boolean;
  totalCount?: number;
}

/**
 * Virtualized table content.
 * Uses CSS custom property --table-grid-columns from parent for column alignment.
 */
export const TableContent = memo(function TableContent({
  resources,
  isLoading,
  displayMode,
  visibleColumnIds,
  scrollRef,
  rowHeight,
  onRowClick,
  hasNextPage = false,
  onLoadMore,
  isFetchingNextPage = false,
  totalCount,
}: TableContentProps) {
  // Helper to render a cell based on column ID
  const renderCell = useCallback(
    (columnId: ResourceColumnId, resource: Resource) => {
      switch (columnId) {
        case "resource":
          return (
            <div key={columnId} className="truncate px-3 font-medium text-zinc-900 dark:text-zinc-100">
              {resource.name}
            </div>
          );
        case "type": {
          const typeDisplay = getResourceAllocationTypeDisplay(resource.resourceType);
          return (
            <div key={columnId} className="px-3">
              <span
                className={cn(
                  "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                  typeDisplay.className,
                )}
              >
                {typeDisplay.label}
              </span>
            </div>
          );
        }
        case "pools":
          return (
            <div key={columnId} className="truncate px-3 text-zinc-500 dark:text-zinc-400">
              {resource.poolMemberships[0]?.pool ?? "—"}
              {resource.poolMemberships.length > 1 && (
                <span className="ml-1 text-xs text-zinc-400">+{resource.poolMemberships.length - 1}</span>
              )}
            </div>
          );
        case "platform":
          return (
            <div key={columnId} className="truncate px-3 text-zinc-500 dark:text-zinc-400">
              {resource.platform}
            </div>
          );
        case "backend":
          return (
            <div key={columnId} className="truncate px-3 text-zinc-500 dark:text-zinc-400">
              {resource.backend}
            </div>
          );
        case "gpu":
          return (
            <div key={columnId} className="whitespace-nowrap px-3 text-right tabular-nums">
              <CapacityCell used={resource.gpu.used} total={resource.gpu.total} mode={displayMode} />
            </div>
          );
        case "cpu":
          return (
            <div key={columnId} className="whitespace-nowrap px-3 text-right tabular-nums">
              <CapacityCell used={resource.cpu.used} total={resource.cpu.total} mode={displayMode} />
            </div>
          );
        case "memory":
          return (
            <div key={columnId} className="whitespace-nowrap px-3 text-right tabular-nums">
              <CapacityCell used={resource.memory.used} total={resource.memory.total} isBytes mode={displayMode} />
            </div>
          );
        case "storage":
          return (
            <div key={columnId} className="whitespace-nowrap px-3 text-right tabular-nums">
              <CapacityCell used={resource.storage.used} total={resource.storage.total} isBytes mode={displayMode} />
            </div>
          );
        default:
          return null;
      }
    },
    [displayMode],
  );
  const rowVirtualizer = useVirtualizerCompat({
    count: resources.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 5,
  });

  // Reset measurements when row height changes
  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowHeight, rowVirtualizer]);

  // Trigger load more when scrolling near bottom
  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement || !onLoadMore) return;

    const checkLoadMore = () => {
      if (!hasNextPage || isFetchingNextPage) return;

      const virtualItems = rowVirtualizer.getVirtualItems();
      const lastItem = virtualItems.at(-1);

      if (!lastItem) return;

      // Load more when within 10 items of end
      const threshold = 10;
      if (lastItem.index >= resources.length - threshold) {
        onLoadMore();
      }
    };

    scrollElement.addEventListener("scroll", checkLoadMore, { passive: true });
    checkLoadMore();

    return () => {
      scrollElement.removeEventListener("scroll", checkLoadMore);
    };
  }, [scrollRef, rowVirtualizer, resources.length, hasNextPage, isFetchingNextPage, onLoadMore]);

  // Skeleton widths per column type
  const skeletonWidths: Record<ResourceColumnId, string> = {
    resource: "w-40",
    type: "w-16",
    pools: "w-16",
    platform: "w-16",
    backend: "w-12",
    gpu: "w-8",
    cpu: "w-8",
    memory: "w-12",
    storage: "w-12",
  };

  if (isLoading) {
    return (
      <div style={{ contain: "content" }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="grid gap-0 border-b border-zinc-100 py-3 dark:border-zinc-800/50"
            style={{ gridTemplateColumns: "var(--table-grid-columns)", contain: "layout style" }}
          >
            {visibleColumnIds.map((columnId) => (
              <div key={columnId} className="px-3">
                <div className={`h-4 ${skeletonWidths[columnId]} skeleton-shimmer rounded`} />
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (resources.length === 0) {
    return <div className="p-8 text-center text-sm text-zinc-500 dark:text-zinc-400">No resources found</div>;
  }

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
          const resource = resources[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              role="row"
              tabIndex={0}
              onClick={(e) => onRowClick(resource, e.currentTarget)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onRowClick(resource, e.currentTarget);
                }
              }}
              className="virtual-item"
              style={{
                height: virtualRow.size,
                transform: `translate3d(0, ${virtualRow.start}px, 0)`,
              }}
            >
              <div
                className="grid h-full cursor-pointer items-center gap-0 border-b border-zinc-100 text-sm transition-[background-color] duration-150 hover:bg-zinc-50 focus:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--nvidia-green)] dark:border-zinc-800/50 dark:hover:bg-zinc-900 dark:focus:bg-zinc-900"
                style={{ gridTemplateColumns: "var(--table-grid-columns)", contain: "layout style" }}
              >
                {visibleColumnIds.map((columnId) => renderCell(columnId, resource))}
              </div>
            </div>
          );
        })}
      </div>
      {/* Loading/end indicator - outside virtualized container to be visible */}
      <LoadingMoreIndicator
        isLoading={isFetchingNextPage}
        hasMore={hasNextPage}
        loadedCount={resources.length}
        totalCount={totalCount}
      />
    </>
  );
});
