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
 * Pools Data Table
 *
 * Pool-specific wrapper around DataTable that handles:
 * - Flat table (no sections) with full sorting flexibility
 * - Pool-specific row styling (status borders)
 * - Sharing group indicators
 *
 * Built on the canonical DataTable component.
 */

"use client";

import { useMemo, useCallback, memo } from "react";
import { DataTable } from "@/components/data-table/data-table";
import { TableEmptyState } from "@/components/data-table/table-empty-state";
import { TableLoadingSkeleton, TableErrorState } from "@/components/data-table/table-states";
import { useColumnVisibility } from "@/components/data-table/hooks/use-column-visibility";
import type { SortState, ColumnSizingPreference } from "@/components/data-table/types";
import { useDisplayMode, useCompactMode } from "@/stores/shared-preferences-store";
import type { Pool } from "@/lib/api/adapter/types";
import type { SearchChip } from "@/stores/types";
import {
  MANDATORY_COLUMN_IDS,
  asPoolColumnIds,
  POOL_COLUMN_SIZE_CONFIG,
} from "@/app/(dashboard)/pools/lib/pool-columns";
import { createPoolColumns } from "@/app/(dashboard)/pools/components/table/pool-column-defs";
import { usePoolsTableStore } from "@/app/(dashboard)/pools/stores/pools-table-store";
import { useSortedPools } from "@/app/(dashboard)/pools/hooks/use-sorted-pools";
import { useCssVarDimensions } from "@/lib/css-utils";
import { getStatusDisplay } from "@/lib/pool-status";
import "@/app/(dashboard)/pools/styles/pools.css";

// =============================================================================
// Types
// =============================================================================

export interface PoolsDataTableProps {
  /** Pool data */
  pools: Pool[];
  /** Sharing groups for capacity indicators */
  sharingGroups: string[][];
  /** Loading state */
  isLoading?: boolean;
  /** Error state */
  error?: Error;
  /** Retry callback */
  onRetry?: () => void;
  /** Callback when a pool is selected */
  onPoolSelect?: (poolName: string) => void;
  /** Currently selected pool name */
  selectedPoolName?: string | null;
  /** Callback when chips change (for shared filter feature) */
  onSearchChipsChange?: (chips: SearchChip[]) => void;
}

// =============================================================================
// Helpers
// =============================================================================

/** Stable row ID extractor */
const getRowId = (pool: Pool) => pool.name;

// =============================================================================
// Component
// =============================================================================

export const PoolsDataTable = memo(function PoolsDataTable({
  pools,
  sharingGroups,
  isLoading = false,
  error,
  onRetry,
  onPoolSelect,
  selectedPoolName,
  onSearchChipsChange,
}: PoolsDataTableProps) {
  // Layout dimensions from CSS variables
  const layout = useCssVarDimensions({
    headerHeight: ["--pools-header-height", "2.25rem"],
    sectionHeight: ["--pools-section-height", "2.25rem"],
    rowHeight: ["--pools-row-height", "3rem"],
    rowHeightCompact: ["--pools-row-height-compact", "2rem"],
  } as const);

  // Shared preferences (hydration-safe)
  const displayMode = useDisplayMode();
  const compactMode = useCompactMode();

  // Table store state
  const storeVisibleColumnIds = asPoolColumnIds(usePoolsTableStore((s) => s.visibleColumnIds));
  const columnOrder = asPoolColumnIds(usePoolsTableStore((s) => s.columnOrder));
  const setColumnOrder = usePoolsTableStore((s) => s.setColumnOrder);
  const sortState = usePoolsTableStore((s) => s.sort);
  const setSort = usePoolsTableStore((s) => s.setSort);
  const columnSizingPreferences = usePoolsTableStore((s) => s.columnSizingPreferences);
  const setColumnSizingPreference = usePoolsTableStore((s) => s.setColumnSizingPreference);

  const rowHeight = compactMode ? layout.rowHeightCompact : layout.rowHeight;

  // Sort pools (flat list, no sections)
  const { sortedPools, sharingMap } = useSortedPools({
    pools,
    sort: sortState,
    sharingGroups,
    displayMode,
  });

  const columnVisibility = useColumnVisibility(columnOrder, storeVisibleColumnIds);

  // Memoize shared pools filter callbacks
  const filterBySharedPoolsMap = useMemo(() => {
    if (!onSearchChipsChange) return new Map<string, () => void>();

    const map = new Map<string, () => void>();
    for (const group of sharingGroups) {
      if (group.length > 1) {
        for (const poolName of group) {
          map.set(poolName, () => {
            onSearchChipsChange([
              {
                field: "shared",
                value: poolName,
                label: `Shared: ${poolName}`,
              },
            ]);
          });
        }
      }
    }
    return map;
  }, [sharingGroups, onSearchChipsChange]);

  // Create TanStack columns
  const columns = useMemo(
    () =>
      createPoolColumns({
        displayMode,
        compact: compactMode,
        sharingMap,
        filterBySharedPoolsMap,
      }),
    [displayMode, compactMode, sharingMap, filterBySharedPoolsMap],
  );

  // Fixed columns (not draggable)
  const fixedColumns = useMemo(() => Array.from(MANDATORY_COLUMN_IDS), []);

  // Handle sort change
  const handleSortChange = useCallback(
    (newSort: SortState<string>) => {
      if (newSort.column) {
        setSort(newSort.column);
      }
    },
    [setSort],
  );

  // Handle column order change
  const handleColumnOrderChange = useCallback(
    (newOrder: string[]) => {
      setColumnOrder(newOrder);
    },
    [setColumnOrder],
  );

  // Handle column sizing preference change
  const handleColumnSizingPreferenceChange = useCallback(
    (columnId: string, preference: ColumnSizingPreference) => {
      setColumnSizingPreference(columnId, preference);
    },
    [setColumnSizingPreference],
  );

  // Handle row click - call onPoolSelect with pool name
  const handleRowClick = useCallback(
    (pool: Pool) => {
      onPoolSelect?.(pool.name);
    },
    [onPoolSelect],
  );

  // Augment pools with visual row index for zebra striping
  const poolsWithIndex = useMemo(
    () => sortedPools.map((pool, index) => ({ ...pool, _visualRowIndex: index })),
    [sortedPools],
  );

  // Row class for status styling + zebra striping
  const rowClassName = useCallback(
    (pool: Pool & { _visualRowIndex?: number }) => {
      const { category } = getStatusDisplay(pool.status);
      const isSelected = selectedPoolName === pool.name;
      const visualIndex = pool._visualRowIndex ?? 0;
      const zebraClass = visualIndex % 2 === 0 ? "bg-white dark:bg-zinc-950" : "bg-gray-100/60 dark:bg-zinc-900/50";
      return ["pools-row", `pools-row--${category}`, isSelected && "pools-row--selected", zebraClass]
        .filter(Boolean)
        .join(" ");
    },
    [selectedPoolName],
  );

  const emptyContent = useMemo(() => <TableEmptyState message="No pools available" />, []);

  // Loading state (using consolidated component)
  if (isLoading && pools.length === 0) {
    return (
      <TableLoadingSkeleton
        className="pools-table-container"
        rowHeight={rowHeight}
      />
    );
  }

  // Error state (using consolidated component)
  if (error) {
    return (
      <TableErrorState
        error={error}
        title="Unable to load pools"
        onRetry={onRetry}
        className="pools-table-container"
      />
    );
  }

  return (
    <div className="pools-table-container table-container relative h-full">
      <DataTable<Pool & { _visualRowIndex?: number }>
        data={poolsWithIndex}
        columns={columns}
        getRowId={getRowId}
        // Column management
        columnOrder={columnOrder}
        onColumnOrderChange={handleColumnOrderChange}
        columnVisibility={columnVisibility}
        fixedColumns={fixedColumns}
        // Column sizing
        columnSizeConfigs={POOL_COLUMN_SIZE_CONFIG}
        columnSizingPreferences={columnSizingPreferences}
        onColumnSizingPreferenceChange={handleColumnSizingPreferenceChange}
        // Sorting
        sorting={sortState ?? undefined}
        onSortingChange={handleSortChange}
        // Layout
        rowHeight={rowHeight}
        compact={compactMode}
        className="text-sm"
        scrollClassName="scrollbar-styled flex-1"
        // State
        isLoading={isLoading}
        emptyContent={emptyContent}
        // Interaction
        onRowClick={handleRowClick}
        selectedRowId={selectedPoolName ?? undefined}
        rowClassName={rowClassName}
      />
    </div>
  );
});
