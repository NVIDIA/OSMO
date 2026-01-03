/**
 * Copyright (c) 2025-2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

"use client";

import { useMemo, useCallback } from "react";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { Check } from "lucide-react";
import { getOrderedColumns, type SortState } from "@/lib/table";
import { useTableDnd } from "@/components/data-table";
import type { PoolsResponse } from "@/lib/api/adapter";
import { useSharedPreferences } from "@/stores";
import type { SearchChip } from "@/stores";
import { usePoolsTableStore } from "../../stores/pools-table-store";
import { usePoolSections } from "../../hooks/use-pool-sections";
import { useSectionScroll } from "../../hooks/use-section-scroll";
import { useLayoutDimensions } from "../../hooks/use-layout-dimensions";
import { COLUMN_MAP, MANDATORY_COLUMN_IDS, type PoolColumnId } from "../../lib/pool-columns";
import { SectionRow } from "./section-row";
import { BottomSectionStack } from "./bottom-sections";
import { PoolRow } from "./pool-row";
import { TableHeader } from "./table-header";
import "../../styles/pools.css";


export interface PoolsTableProps {
  /** Pre-filtered pools data from usePoolsData */
  poolsData: PoolsResponse | null;
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  /** Callback when a pool is selected (for URL sync) */
  onPoolSelect?: (poolName: string) => void;
  /** Currently selected pool name (for row highlighting) */
  selectedPoolName?: string | null;
  /** Callback when chips change (for shared filter feature) */
  onSearchChipsChange?: (chips: SearchChip[]) => void;
}

export function PoolsTable({
  poolsData,
  isLoading,
  error,
  onRetry,
  onPoolSelect,
  selectedPoolName,
  onSearchChipsChange,
}: PoolsTableProps) {
  const layout = useLayoutDimensions();
  const { headerHeight, sectionHeight } = layout;

  // Store state (non-URL synced preferences)
  const visibleColumnIds = usePoolsTableStore((s) => s.visibleColumnIds) as PoolColumnId[];
  const columnOrder = usePoolsTableStore((s) => s.columnOrder) as PoolColumnId[];
  const sort = usePoolsTableStore((s) => s.sort) as SortState<PoolColumnId>;
  const setSort = usePoolsTableStore((s) => s.setSort);
  const setColumnOrder = usePoolsTableStore((s) => s.setColumnOrder);

  // Shared preferences (across pools & resources)
  const displayMode = useSharedPreferences((s) => s.displayMode);
  const compactMode = useSharedPreferences((s) => s.compactMode);

  const pools = poolsData?.pools ?? [];
  const sharingGroups = poolsData?.sharingGroups ?? [];

  // Memoize shared pools filter callbacks to preserve PoolRow memo optimization
  // Key: poolName -> callback (stable references across renders)
  const filterBySharedPoolsMap = useMemo(() => {
    if (!onSearchChipsChange) return new Map<string, () => void>();

    const map = new Map<string, () => void>();
    for (const group of sharingGroups) {
      if (group.length > 1) {
        for (const poolName of group) {
          map.set(poolName, () => {
            onSearchChipsChange([{
              field: "shared",
              value: poolName,
              label: `Shared: ${poolName}`,
            }]);
          });
        }
      }
    }
    return map;
  }, [sharingGroups, onSearchChipsChange]);

  // Organize pools into sections (pools are pre-filtered by usePoolsData)
  const { sections, sharingMap } = usePoolSections({
    pools,
    sort,
    sharingGroups,
    displayMode,
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

  const optionalColumnIds = useMemo(
    () => columnOrder.filter((id) => !MANDATORY_COLUMN_IDS.has(id) && visibleColumnIds.includes(id)),
    [columnOrder, visibleColumnIds],
  );

  // DnD setup from shared hook
  const { sensors, modifiers } = useTableDnd();

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        const oldIndex = optionalColumnIds.indexOf(active.id as PoolColumnId);
        const newIndex = optionalColumnIds.indexOf(over.id as PoolColumnId);
        if (oldIndex !== -1 && newIndex !== -1) {
          const newOptionalOrder = arrayMove(optionalColumnIds, oldIndex, newIndex);
          const mandatoryIds = columnOrder.filter((id) => MANDATORY_COLUMN_IDS.has(id));
          setColumnOrder([...mandatoryIds, ...newOptionalOrder]);
        }
      }
    },
    [optionalColumnIds, columnOrder, setColumnOrder],
  );

  // Event handlers
  const handleSort = useCallback((column: PoolColumnId) => setSort(column as string), [setSort]);

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

  const columnCount = columns.length;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      modifiers={modifiers}
      autoScroll={false}
    >
      <div className="pools-table-container h-full overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div
          ref={scrollRef}
          className="scrollbar-styled flex-1 overflow-auto overscroll-contain"
        >
          <table className="pools-table w-full border-collapse">
            <TableHeader
              columns={columns}
              sort={sort}
              onSort={handleSort}
              optionalColumnIds={optionalColumnIds}
            />

          <tbody>
            {sections.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="p-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  No pools available
                </td>
              </tr>
            ) : (
              sections.flatMap((section, sectionIndex) => [
                <SectionRow
                  key={`section-${section.status}`}
                  label={section.label}
                  status={section.status}
                  count={section.pools.length}
                  sectionIndex={sectionIndex}
                  columnCount={columnCount}
                  onJumpTo={() => scrollToSection(sectionIndex)}
                />,
                ...section.pools.map((pool) => (
                  <PoolRow
                    key={pool.name}
                    pool={pool}
                    columns={columns}
                    isSelected={selectedPoolName === pool.name}
                    onSelect={onPoolSelect}
                    displayMode={displayMode}
                    compact={compactMode}
                    isShared={sharingMap.has(pool.name)}
                    onFilterBySharedPools={filterBySharedPoolsMap.get(pool.name)}
                  />
                )),
              ])
            )}
          </tbody>

            {/* End of list marker */}
            {sections.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={columnCount}>
                    <div className="flex items-center justify-center gap-1.5 py-4 text-xs text-zinc-400 dark:text-zinc-500">
                      <Check className="h-3.5 w-3.5" />
                      <span>You&apos;ve reached the end</span>
                    </div>
                  </td>
                </tr>
              </tfoot>
            )}

            {sections.length > 1 && hiddenSectionIndices.length > 0 && (
              <BottomSectionStack
                sections={sections}
                hiddenSectionIndices={hiddenSectionIndices}
                columnCount={columnCount}
                onJumpTo={scrollToSection}
              />
            )}
          </table>
        </div>
      </div>
    </DndContext>
  );
}
