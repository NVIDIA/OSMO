/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Resources Table
 *
 * Displays resources in a virtualized, sortable, DnD-enabled table.
 * Built on the canonical DataTable component.
 */

"use client";

import { useMemo, useCallback } from "react";
import { DataTable, type SortState } from "@/components/data-table";
import { useSharedPreferences } from "@/stores";
import type { Resource } from "@/lib/api/adapter";
import { MANDATORY_COLUMN_IDS, type ResourceColumnId } from "../../lib/resource-columns";
import { createResourceColumns } from "../../lib/resource-table-columns";
import { useResourcesTableStore } from "../../stores/resources-table-store";
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
  /** Currently selected resource ID */
  selectedResourceId?: string;

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
  selectedResourceId,
  hasNextPage = false,
  onLoadMore,
  isFetchingNextPage = false,
}: ResourcesTableProps) {
  // Shared preferences
  const displayMode = useSharedPreferences((s) => s.displayMode);
  const compactMode = useSharedPreferences((s) => s.compactMode);

  // Table store (column visibility and order)
  const storeVisibleColumnIds = useResourcesTableStore((s) => s.visibleColumnIds) as ResourceColumnId[];
  const columnOrder = useResourcesTableStore((s) => s.columnOrder) as ResourceColumnId[];
  const setColumnOrder = useResourcesTableStore((s) => s.setColumnOrder);
  const sortState = useResourcesTableStore((s) => s.sort);
  const setSort = useResourcesTableStore((s) => s.setSort);

  // Merge showPoolsColumn prop with store visibility
  const effectiveVisibleIds = useMemo(() => {
    if (!showPoolsColumn) {
      return storeVisibleColumnIds.filter((id) => id !== "pools");
    }
    return storeVisibleColumnIds;
  }, [storeVisibleColumnIds, showPoolsColumn]);

  // Create column visibility map for DataTable
  const columnVisibility = useMemo(() => {
    const visibility: Record<string, boolean> = {};
    // Start with all columns hidden
    columnOrder.forEach((id) => {
      visibility[id] = false;
    });
    // Show only effective visible columns
    effectiveVisibleIds.forEach((id) => {
      visibility[id] = true;
    });
    return visibility;
  }, [columnOrder, effectiveVisibleIds]);

  // Create TanStack columns with current display mode
  const columns = useMemo(
    () => createResourceColumns({ displayMode }),
    [displayMode],
  );

  // Fixed columns (not draggable)
  const fixedColumns = useMemo(
    () => Array.from(MANDATORY_COLUMN_IDS),
    [],
  );

  // Row height based on compact mode
  const rowHeight = compactMode ? 32 : 48;

  // Handle sort change - simply pass the column to the store
  // The store handles direction toggle internally
  const handleSortChange = useCallback(
    (newSort: SortState<string>) => {
      if (newSort.column) {
        setSort(newSort.column);
      }
      // If newSort.column is null, do nothing - let user click again to toggle
    },
    [setSort],
  );

  // Handle column order change
  const handleColumnOrderChange = useCallback(
    (newOrder: string[]) => {
      setColumnOrder(newOrder as ResourceColumnId[]);
    },
    [setColumnOrder],
  );

  // Get row ID
  const getRowId = useCallback((resource: Resource) => resource.name, []);

  // Empty state - memoized to prevent re-renders
  const emptyContent = useMemo(
    () => (
      <div className="text-sm text-zinc-500 dark:text-zinc-400">
        No resources found
      </div>
    ),
    [],
  );

  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
    >
      <DataTable<Resource>
        data={resources}
        columns={columns}
        getRowId={getRowId}
        // Column management
        columnOrder={columnOrder}
        onColumnOrderChange={handleColumnOrderChange}
        columnVisibility={columnVisibility}
        fixedColumns={fixedColumns}
        // Sorting
        sorting={sortState as SortState<string>}
        onSortingChange={handleSortChange}
        // Pagination
        hasNextPage={hasNextPage}
        onLoadMore={onLoadMore}
        isFetchingNextPage={isFetchingNextPage}
        totalCount={totalCount}
        // Layout
        rowHeight={rowHeight}
        className="text-sm"
        scrollClassName="resources-scroll-container scrollbar-styled flex-1"
        // State
        isLoading={isLoading}
        emptyContent={emptyContent}
        // Interaction
        onRowClick={onResourceClick}
        selectedRowId={selectedResourceId}
      />
    </div>
  );
}
