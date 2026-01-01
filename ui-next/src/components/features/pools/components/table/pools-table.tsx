/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

"use client";

import { useMemo, useCallback } from "react";
import { getGridTemplate, getMinTableWidth, getOrderedColumns, type SortState } from "@/lib/table";
import type { PoolsResponse } from "@/lib/api/adapter";
import { usePoolsTableStore, usePoolsExtendedStore } from "../../stores/pools-table-store";
import { usePoolSections, useSectionScroll, useLayoutDimensions } from "../../hooks";
import { COLUMN_MAP, MANDATORY_COLUMN_IDS, type PoolColumnId } from "../../lib";
import { SectionRow } from "./section-row";
import { BottomSectionStack } from "./bottom-sections";
import { PoolRow } from "./pool-row";
import { TableHeader } from "./table-header";
import "../../pools.css";

const DEFAULT_GAP = 24;

export interface PoolsTableProps {
  poolsData: PoolsResponse | null;
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
}

export function PoolsTable({ poolsData, isLoading, error, onRetry }: PoolsTableProps) {
  const layout = useLayoutDimensions();
  const { headerHeight, sectionHeight } = layout;

  // Store state
  const visibleColumnIds = usePoolsTableStore((s) => s.visibleColumnIds) as PoolColumnId[];
  const columnOrder = usePoolsTableStore((s) => s.columnOrder) as PoolColumnId[];
  const sort = usePoolsTableStore((s) => s.sort) as SortState<PoolColumnId>;
  const compactMode = usePoolsTableStore((s) => s.compactMode);
  const searchChips = usePoolsTableStore((s) => s.searchChips);
  const setSort = usePoolsTableStore((s) => s.setSort);
  const setColumnOrder = usePoolsTableStore((s) => s.setColumnOrder);

  const displayMode = usePoolsExtendedStore((s) => s.displayMode);
  const selectedPoolName = usePoolsExtendedStore((s) => s.selectedPoolName);
  const setSelectedPool = usePoolsExtendedStore((s) => s.setSelectedPool);

  const pools = poolsData?.pools ?? [];
  const sharingGroups = poolsData?.sharingGroups ?? [];

  // Business logic hooks
  const { sections, sharingMap } = usePoolSections({
    pools,
    searchChips,
    sort,
    sharingGroups,
  });

  const rowHeight = compactMode ? layout.rowHeightCompact : layout.rowHeight;

  const { scrollRef, hiddenSectionIndices, scrollToSection } = useSectionScroll({
    sections,
    headerHeight,
    sectionHeight,
    rowHeight,
  });

  // Column configuration
  const columns = useMemo(
    () => getOrderedColumns(COLUMN_MAP, columnOrder, visibleColumnIds),
    [columnOrder, visibleColumnIds],
  );

  const gridTemplate = useMemo(() => getGridTemplate(columns), [columns]);
  const minWidth = useMemo(() => getMinTableWidth(columns, DEFAULT_GAP), [columns]);

  const optionalColumnIds = useMemo(
    () => columnOrder.filter((id) => !MANDATORY_COLUMN_IDS.has(id) && visibleColumnIds.includes(id)),
    [columnOrder, visibleColumnIds],
  );

  // Event handlers
  const handleSort = useCallback((column: PoolColumnId) => setSort(column as string), [setSort]);

  const handleReorderColumns = useCallback(
    (newOptionalOrder: PoolColumnId[]) => {
      const mandatoryIds = columnOrder.filter((id) => MANDATORY_COLUMN_IDS.has(id));
      setColumnOrder([...mandatoryIds, ...newOptionalOrder]);
    },
    [columnOrder, setColumnOrder],
  );

  // Inline state rendering
  if (isLoading) {
    return (
      <div className="pools-table-container h-full overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-1 flex-col gap-2 p-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="pools-table-container h-full overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="text-sm text-red-600 dark:text-red-400">Unable to load pools</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">{error.message}</div>
          {onRetry && (
            <button
              onClick={onRetry}
              className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="pools-table-container h-full overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div
        ref={scrollRef}
        className="pools-scroll-container flex-1 overflow-auto overscroll-contain"
        role="table"
        aria-label="Pools table"
      >
        <div style={{ minWidth }}>
          <div className="sticky top-0 z-20 touch-none" role="rowgroup">
            <TableHeader
              columns={columns}
              gridTemplate={gridTemplate}
              minWidth={minWidth}
              gap={DEFAULT_GAP}
              headerHeight={headerHeight}
              sort={sort}
              onSort={handleSort}
              optionalColumnIds={optionalColumnIds}
              onReorder={handleReorderColumns}
            />
          </div>

          {sections.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-8 text-sm text-zinc-500 dark:text-zinc-400">
              {searchChips.length > 0 ? "No pools match your filters" : "No pools available"}
            </div>
          ) : (
            <div role="rowgroup">
              {sections.flatMap((section, sectionIndex) => [
                <SectionRow
                  key={`section-${section.status}`}
                  label={section.label}
                  icon={section.icon}
                  count={section.pools.length}
                  sectionIndex={sectionIndex}
                  onJumpTo={() => scrollToSection(sectionIndex)}
                />,
                ...section.pools.map((pool) => (
                  <PoolRow
                    key={pool.name}
                    pool={pool}
                    columns={columns}
                    gridTemplate={gridTemplate}
                    minWidth={minWidth}
                    gap={DEFAULT_GAP}
                    isSelected={selectedPoolName === pool.name}
                    onSelect={() => setSelectedPool(pool.name)}
                    displayMode={displayMode}
                    compact={compactMode}
                    isShared={sharingMap.has(pool.name)}
                  />
                )),
              ])}
            </div>
          )}
        </div>
      </div>

      {sections.length > 1 && (
        <BottomSectionStack
          sections={sections}
          hiddenSectionIndices={hiddenSectionIndices}
          onJumpTo={scrollToSection}
        />
      )}
    </div>
  );
}

export default PoolsTable;
