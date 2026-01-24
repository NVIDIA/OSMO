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

import { useMemo, useCallback } from "react";
import {
  DataTable,
  TableLoadingSkeleton,
  TableErrorState,
  type SortState,
  type ColumnSizingPreference,
} from "@/components/data-table";
import { useSharedPreferences } from "@/stores";
import type { Pool } from "@/lib/api/adapter";
import type { SearchChip } from "@/stores";
import { MANDATORY_COLUMN_IDS, asPoolColumnIds, POOL_COLUMN_SIZE_CONFIG } from "../../lib/pool-columns";
import { createPoolColumns } from "./pool-column-defs";
import { usePoolsTableStore } from "../../stores/pools-table-store";
import { useSortedPools } from "../../hooks/use-sorted-pools";
import { useCssVarDimensions } from "@/lib/css-utils";
import { getStatusDisplay } from "../../lib/constants";
import "../../styles/pools.css";

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

export function PoolsDataTable({
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

  // Shared preferences
  const displayMode = useSharedPreferences((s) => s.displayMode);
  const compactMode = useSharedPreferences((s) => s.compactMode);

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

  // Create column visibility map
  const columnVisibility = useMemo(() => {
    const visibility: Record<string, boolean> = {};
    columnOrder.forEach((id) => {
      visibility[id] = false;
    });
    storeVisibleColumnIds.forEach((id) => {
      visibility[id] = true;
    });
    return visibility;
  }, [columnOrder, storeVisibleColumnIds]);

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

  // Row class for status styling
  const rowClassName = useCallback(
    (pool: Pool) => {
      const { category } = getStatusDisplay(pool.status);
      const isSelected = selectedPoolName === pool.name;
      return ["pools-row", `pools-row--${category}`, isSelected && "pools-row--selected"].filter(Boolean).join(" ");
    },
    [selectedPoolName],
  );

  // Empty state
  const emptyContent = useMemo(
    () => <div className="text-sm text-zinc-500 dark:text-zinc-400">No pools available</div>,
    [],
  );

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
      <DataTable<Pool>
        data={sortedPools}
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
}
