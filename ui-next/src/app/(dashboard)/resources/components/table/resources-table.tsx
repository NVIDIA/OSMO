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

import { useState, useRef, useEffect, useMemo, useCallback, startTransition } from "react";
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { useTableDnd } from "@/components/data-table";
import { useSharedPreferences, type DisplayMode } from "@/stores";
import type { Resource } from "@/lib/api/adapter";
import { getVisibleColumnsConfig, MANDATORY_COLUMN_IDS, type ResourceColumnId } from "../../lib/resource-columns";
import { useResourcesTableStore } from "../../stores/resources-table-store";
import { TableHeader, type SortState, type SortColumn } from "./table-header";
import { TableContent } from "./table-content";
import "../../styles/resources.css";

// =============================================================================
// Types
// =============================================================================

export interface ResourcesTableProps {
  /** Array of resources to display */
  resources: Resource[];
  /** Count matching current filters (the "X" in "X of Y") */
  filteredCount?: number;
  /** Total count before filters (the "Y" in "X of Y") */
  totalCount?: number;
  /** Show loading skeleton */
  isLoading?: boolean;
  /** Show the Pools column (for cross-pool views) */
  showPoolsColumn?: boolean;
  /** Pool context for ResourcePanel display */
  poolName?: string;
  /** Custom click handler for row selection */
  onResourceClick?: (resource: Resource) => void;

  // === Infinite scroll props ===
  /** Whether more data is available to load */
  hasNextPage?: boolean;
  /** Function to load next page (called when scrolling near end) */
  onLoadMore?: () => void;
  /** Whether currently loading more data */
  isFetchingNextPage?: boolean;
}

// =============================================================================
// Main Component
// =============================================================================

export function ResourcesTable({
  resources,
  filteredCount,
  totalCount,
  isLoading = false,
  showPoolsColumn = false,
  poolName,
  onResourceClick,
  hasNextPage = false,
  onLoadMore,
  isFetchingNextPage = false,
}: ResourcesTableProps) {
  const [isScrolled, setIsScrolled] = useState(false);

  // Shared preferences
  const displayMode = useSharedPreferences((s) => s.displayMode);
  const compactMode = useSharedPreferences((s) => s.compactMode);

  // Table store (column visibility and order)
  const storeVisibleColumnIds = useResourcesTableStore((s) => s.visibleColumnIds) as ResourceColumnId[];
  const columnOrder = useResourcesTableStore((s) => s.columnOrder) as ResourceColumnId[];
  const setColumnOrder = useResourcesTableStore((s) => s.setColumnOrder);

  // Sort state - includes displayMode to auto-reset when it changes
  const [sortState, setSortState] = useState<{ displayMode: DisplayMode; sort: SortState }>({
    displayMode,
    sort: { column: null, direction: "asc" },
  });

  // Refs
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableHeaderRef = useRef<HTMLDivElement>(null);
  const lastClickedRowRef = useRef<HTMLElement | null>(null);

  // Merge showPoolsColumn prop with store visibility
  // showPoolsColumn=false means pools is always hidden (single-pool context)
  // showPoolsColumn=true means pools visibility is controlled by the store
  const effectiveVisibleIds = useMemo(() => {
    if (!showPoolsColumn) {
      // Remove pools when prop says to hide it (e.g., single-pool view)
      return storeVisibleColumnIds.filter((id) => id !== "pools");
    }
    // Otherwise, respect the store's visibility setting
    return storeVisibleColumnIds;
  }, [storeVisibleColumnIds, showPoolsColumn]);

  // Get column configuration based on visible columns and their order
  const columnConfig = useMemo(
    () => getVisibleColumnsConfig(effectiveVisibleIds, columnOrder),
    [effectiveVisibleIds, columnOrder],
  );
  const gridColumns = columnConfig.gridTemplate;
  const visibleColumnIds = columnConfig.columnIds;

  // Optional column IDs (draggable) - in order from columnOrder, filtered to visible
  const optionalColumnIds = useMemo(
    () => columnOrder.filter((id) => !MANDATORY_COLUMN_IDS.has(id) && visibleColumnIds.includes(id)),
    [columnOrder, visibleColumnIds],
  );

  // DnD sensors and modifiers from shared hook
  const { sensors, modifiers } = useTableDnd();

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        const oldIndex = optionalColumnIds.indexOf(active.id as ResourceColumnId);
        const newIndex = optionalColumnIds.indexOf(over.id as ResourceColumnId);
        if (oldIndex !== -1 && newIndex !== -1) {
          const newOptionalOrder = arrayMove(optionalColumnIds, oldIndex, newIndex);
          const mandatoryIds = columnOrder.filter((id) => MANDATORY_COLUMN_IDS.has(id));
          setColumnOrder([...mandatoryIds, ...newOptionalOrder]);
        }
      }
    },
    [optionalColumnIds, columnOrder, setColumnOrder],
  );

  // Row height based on compact mode
  const rowHeight = compactMode ? 32 : 48;

  // Derive current sort, resetting if displayMode changed
  const sort = useMemo<SortState>(
    () => (sortState.displayMode === displayMode ? sortState.sort : { column: null, direction: "asc" }),
    [sortState, displayMode],
  );

  const setSort = useCallback(
    (newSortOrUpdater: SortState | ((prev: SortState) => SortState)) => {
      if (typeof newSortOrUpdater === "function") {
        setSortState((prevState) => ({
          displayMode,
          sort: newSortOrUpdater(
            prevState.displayMode === displayMode ? prevState.sort : { column: null, direction: "asc" },
          ),
        }));
      } else {
        setSortState({ displayMode, sort: newSortOrUpdater });
      }
    },
    [displayMode],
  );

  // Handle column header click - wrapped in startTransition for non-blocking updates
  const handleSort = useCallback(
    (column: SortColumn) => {
      startTransition(() => {
        setSort((prev) => {
          if (prev.column === column) {
            if (prev.direction === "asc") {
              return { column, direction: "desc" };
            } else {
              return { column: null, direction: "asc" };
            }
          } else {
            return { column, direction: "asc" };
          }
        });
      });
    },
    [setSort],
  );

  // Sort resources
  const sortedResources = useMemo(() => {
    if (!sort.column) return resources;

    const sorted = [...resources].sort((a, b) => {
      let cmp = 0;
      switch (sort.column) {
        case "resource":
          cmp = a.name.localeCompare(b.name);
          break;
        case "type":
          cmp = a.resourceType.localeCompare(b.resourceType);
          break;
        case "pools": {
          const aPool = a.poolMemberships[0]?.pool ?? "";
          const bPool = b.poolMemberships[0]?.pool ?? "";
          cmp = aPool.localeCompare(bPool);
          break;
        }
        case "platform":
          cmp = a.platform.localeCompare(b.platform);
          break;
        case "backend":
          cmp = a.backend.localeCompare(b.backend);
          break;
        case "gpu":
          cmp =
            displayMode === "free" ? a.gpu.total - a.gpu.used - (b.gpu.total - b.gpu.used) : a.gpu.used - b.gpu.used;
          break;
        case "cpu":
          cmp =
            displayMode === "free" ? a.cpu.total - a.cpu.used - (b.cpu.total - b.cpu.used) : a.cpu.used - b.cpu.used;
          break;
        case "memory":
          cmp =
            displayMode === "free"
              ? a.memory.total - a.memory.used - (b.memory.total - b.memory.used)
              : a.memory.used - b.memory.used;
          break;
        case "storage":
          cmp =
            displayMode === "free"
              ? a.storage.total - a.storage.used - (b.storage.total - b.storage.used)
              : a.storage.used - b.storage.used;
          break;
      }
      return sort.direction === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [resources, sort, displayMode]);

  // Handle row click with focus tracking
  const handleRowClick = useCallback(
    (resource: Resource, rowElement?: HTMLElement) => {
      if (rowElement) {
        lastClickedRowRef.current = rowElement;
      }
      if (onResourceClick) {
        onResourceClick(resource);
      }
    },
    [onResourceClick],
  );

  // Scroll handling: shadow effect on sticky header
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;

    let wasScrolled = false;
    const handleScroll = () => {
      const scrolled = scroll.scrollTop > 0;
      if (scrolled !== wasScrolled) {
        wasScrolled = scrolled;
        setIsScrolled(scrolled);
      }
    };

    scroll.addEventListener("scroll", handleScroll, { passive: true });
    return () => scroll.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      modifiers={modifiers}
      autoScroll={false}
    >
      <div
        className="flex h-full flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
        style={{
          contain: "strict",
          transform: "translateZ(0)",
          willChange: "contents",
        }}
      >
        {/* Table - single scroll container with sticky header */}
        <div
          ref={scrollRef}
          className="resources-scroll-container scrollbar-styled flex-1 overflow-auto overscroll-contain focus:outline-none"
          role="table"
          aria-label="Resources"
          tabIndex={-1}
          style={
            {
              overscrollBehavior: "contain",
              WebkitOverflowScrolling: "touch",
              "--table-grid-columns": gridColumns,
            } as React.CSSProperties
          }
        >
          {/* Content wrapper - no explicit minWidth, let CSS grid handle column widths */}
          <div style={{ contain: "layout" }}>
            {/* Sticky Header */}
            <div
              ref={tableHeaderRef}
              className={cn(
                "sticky top-0 z-10 transition-shadow",
                isScrolled && "shadow-md",
              )}
            >
              <TableHeader
                compact={compactMode}
                visibleColumnIds={visibleColumnIds}
                optionalColumnIds={optionalColumnIds}
                sort={sort}
                onSort={handleSort}
              />
            </div>
            {/* Virtualized Body */}
            <TableContent
              resources={sortedResources}
              isLoading={isLoading}
              displayMode={displayMode}
              visibleColumnIds={visibleColumnIds}
              scrollRef={scrollRef}
              rowHeight={rowHeight}
              onRowClick={handleRowClick}
              hasNextPage={hasNextPage}
              onLoadMore={onLoadMore}
              isFetchingNextPage={isFetchingNextPage}
              totalCount={totalCount}
            />
          </div>
        </div>
      </div>
    </DndContext>
  );
}
