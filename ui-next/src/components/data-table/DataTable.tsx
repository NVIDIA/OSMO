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

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import type { VirtualizedTableProps, SortState } from "./types";
import { columnsToGridTemplate, partitionColumns, cycleSortState } from "./types";
import { useTableDnd } from "./hooks/use-table-dnd";
import { TableHeader } from "./TableHeader";
import { TableBody } from "./TableBody";

/**
 * DataTable - A high-performance, generic table component.
 *
 * Features:
 * - Virtualized rendering for large datasets
 * - Optional section grouping (like pools status sections)
 * - Infinite scroll pagination support
 * - Drag-and-drop column reordering
 * - Sortable column headers
 * - CSS Grid layout with flexible column widths
 *
 * @example Flat List (Resources)
 * ```tsx
 * <VirtualizedTable
 *   items={resources}
 *   getRowKey={(r) => r.name}
 *   columns={resourceColumns}
 *   visibleColumnIds={visibleIds}
 *   renderCell={(resource, columnId) => <ResourceCell {...} />}
 *   rowHeight={48}
 *   hasNextPage={hasNextPage}
 *   onLoadMore={fetchNextPage}
 * />
 * ```
 *
 * @example Grouped List (Pools)
 * ```tsx
 * <VirtualizedTable
 *   sections={poolSections}
 *   getRowKey={(p) => p.name}
 *   columns={poolColumns}
 *   visibleColumnIds={visibleIds}
 *   renderCell={(pool, columnId) => <PoolCell {...} />}
 *   renderSectionHeader={(section) => <StatusHeader {...} />}
 *   rowHeight={48}
 *   sectionHeight={36}
 * />
 * ```
 */
export function DataTable<
  T,
  TColumnId extends string = string,
  TMetadata = unknown,
>({
  // Data
  items,
  sections,
  getRowKey,
  // Columns
  columns,
  visibleColumnIds,
  onColumnOrderChange,
  // Rendering
  renderCell,
  renderSectionHeader,
  emptyState,
  loadingRowCount = 5,
  // Sorting
  sort: externalSort,
  onSortChange,
  // Layout
  rowHeight,
  sectionHeight = 36,
  compact = false,
  // Infinite Scroll
  hasNextPage = false,
  onLoadMore,
  isFetchingNextPage = false,
  totalCount,
  // State
  isLoading = false,
  // Interaction
  onRowClick,
  selectedKey,
  // Styling
  className,
  scrollClassName,
  rowClassName,
}: VirtualizedTableProps<T, TColumnId, TMetadata>) {
  // Scroll state for header shadow
  const [isScrolled, setIsScrolled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // DnD setup
  const { sensors, modifiers } = useTableDnd();

  // Internal sort state (used if external not provided)
  const [internalSort, setInternalSort] = useState<SortState<TColumnId>>({
    column: null,
    direction: "asc",
  });

  // Use external or internal sort
  const sort = externalSort ?? internalSort;
  const setSort = onSortChange ?? setInternalSort;

  // Handle sort column click
  const handleSort = useCallback(
    (columnId: TColumnId) => {
      setSort(cycleSortState(sort, columnId));
    },
    [sort, setSort],
  );

  // Column configuration
  const { mandatory, optionalIds } = useMemo(
    () => partitionColumns(columns, visibleColumnIds),
    [columns, visibleColumnIds],
  );

  const gridTemplate = useMemo(
    () => columnsToGridTemplate(columns, visibleColumnIds),
    [columns, visibleColumnIds],
  );

  // Handle column reorder via DnD
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !onColumnOrderChange) return;

      const oldIndex = optionalIds.indexOf(active.id as TColumnId);
      const newIndex = optionalIds.indexOf(over.id as TColumnId);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newOptionalOrder = arrayMove(optionalIds, oldIndex, newIndex);
        const mandatoryIds = mandatory.map((c) => c.id);
        onColumnOrderChange([...mandatoryIds, ...newOptionalOrder]);
      }
    },
    [optionalIds, mandatory, onColumnOrderChange],
  );

  // Track scroll for header shadow
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
        className={cn(
          "flex h-full flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white",
          "dark:border-zinc-800 dark:bg-zinc-950",
          className,
        )}
        style={{
          contain: "strict",
          transform: "translateZ(0)",
        }}
      >
        {/* Scroll container */}
        <div
          ref={scrollRef}
          className={cn(
            "flex-1 overflow-auto overscroll-contain focus:outline-none",
            scrollClassName,
          )}
          role="table"
          aria-label="Data table"
          tabIndex={-1}
          style={{
            overscrollBehavior: "contain",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {/* Content wrapper with containment */}
          <div style={{ contain: "layout" }}>
            {/* Sticky Header */}
            <TableHeader
              columns={columns}
              visibleColumnIds={visibleColumnIds}
              optionalColumnIds={optionalIds}
              sort={sort}
              onSort={handleSort}
              compact={compact}
              gridTemplate={gridTemplate}
              isScrolled={isScrolled}
            />

            {/* Virtualized Body */}
            <TableBody
              items={items}
              sections={sections}
              getRowKey={getRowKey}
              columns={columns}
              visibleColumnIds={visibleColumnIds}
              gridTemplate={gridTemplate}
              renderCell={renderCell}
              renderSectionHeader={renderSectionHeader}
              rowHeight={rowHeight}
              sectionHeight={sectionHeight}
              scrollRef={scrollRef}
              onRowClick={onRowClick}
              selectedKey={selectedKey}
              rowClassName={rowClassName}
              isLoading={isLoading}
              loadingRowCount={loadingRowCount}
              emptyState={emptyState}
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
