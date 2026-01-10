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
 * Resources Table
 *
 * Displays resources in a virtualized, sortable, DnD-enabled table.
 * Built on the canonical DataTable component.
 */

"use client";

import { useMemo, useCallback } from "react";
import { DataTable, type SortState, type ColumnSizingPreference } from "@/components/data-table";
import { useSharedPreferences, type DisplayMode } from "@/stores";
import type { Resource } from "@/lib/api/adapter";
import { MANDATORY_COLUMN_IDS, asResourceColumnIds, RESOURCE_COLUMN_SIZE_CONFIG } from "../../lib/resource-columns";
import { createResourceColumns } from "../../lib/resource-column-defs";
import { useResourcesTableStore } from "../../stores/resources-table-store";
import { TABLE_ROW_HEIGHTS } from "@/lib/config";

// =============================================================================
// Helpers
// =============================================================================

/** Stable row ID extractor - defined outside component to avoid recreating */
const getRowId = (resource: Resource) => resource.name;

/**
 * Sort resources by column and direction.
 * Numeric columns (gpu, cpu, memory, storage) sort by used or free based on displayMode.
 */
function sortResources(resources: Resource[], sort: SortState<string> | null, displayMode: DisplayMode): Resource[] {
  if (!sort?.column) return resources;

  return [...resources].sort((a, b) => {
    let cmp = 0;
    switch (sort.column) {
      case "resource":
        cmp = a.name.localeCompare(b.name);
        break;
      case "hostname":
        cmp = a.hostname.localeCompare(b.hostname);
        break;
      case "type":
        cmp = a.resourceType.localeCompare(b.resourceType);
        break;
      case "pools":
        cmp = (a.poolMemberships[0]?.pool ?? "").localeCompare(b.poolMemberships[0]?.pool ?? "");
        break;
      case "platform":
        cmp = a.platform.localeCompare(b.platform);
        break;
      case "backend":
        cmp = a.backend.localeCompare(b.backend);
        break;
      case "gpu":
        cmp = displayMode === "free" ? a.gpu.total - a.gpu.used - (b.gpu.total - b.gpu.used) : a.gpu.used - b.gpu.used;
        break;
      case "cpu":
        cmp = displayMode === "free" ? a.cpu.total - a.cpu.used - (b.cpu.total - b.cpu.used) : a.cpu.used - b.cpu.used;
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
}

// =============================================================================
// Types
// =============================================================================

export interface ResourcesTableProps {
  /** Array of resources to display */
  resources: Resource[];
  /** Total count before filters */
  totalCount?: number;
  /** Show loading skeleton */
  isLoading?: boolean;
  /** Show the Pools column (for cross-pool views) */
  showPoolsColumn?: boolean;
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
  totalCount,
  isLoading = false,
  showPoolsColumn = false,
  onResourceClick,
  selectedResourceId,
  hasNextPage = false,
  onLoadMore,
  isFetchingNextPage = false,
}: ResourcesTableProps) {
  // Shared preferences
  const displayMode = useSharedPreferences((s) => s.displayMode);
  const compactMode = useSharedPreferences((s) => s.compactMode);

  // Table store (column visibility, order, and preferences)
  const storeVisibleColumnIds = asResourceColumnIds(useResourcesTableStore((s) => s.visibleColumnIds));
  const columnOrder = asResourceColumnIds(useResourcesTableStore((s) => s.columnOrder));
  const setColumnOrder = useResourcesTableStore((s) => s.setColumnOrder);
  const sortState = useResourcesTableStore((s) => s.sort);
  const setSort = useResourcesTableStore((s) => s.setSort);
  const columnSizingPreferences = useResourcesTableStore((s) => s.columnSizingPreferences);
  const setColumnSizingPreference = useResourcesTableStore((s) => s.setColumnSizingPreference);

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

  // Sort resources based on current sort state
  const sortedResources = useMemo(
    () => sortResources(resources, sortState, displayMode),
    [resources, sortState, displayMode],
  );

  // Create TanStack columns with current display mode
  const columns = useMemo(() => createResourceColumns({ displayMode }), [displayMode]);

  // Fixed columns (not draggable)
  const fixedColumns = useMemo(() => Array.from(MANDATORY_COLUMN_IDS), []);

  // Row height based on compact mode
  const rowHeight = compactMode ? TABLE_ROW_HEIGHTS.COMPACT_SM : TABLE_ROW_HEIGHTS.NORMAL;

  // Handle column sizing preference change
  const handleColumnSizingPreferenceChange = useCallback(
    (columnId: string, preference: ColumnSizingPreference) => {
      setColumnSizingPreference(columnId, preference);
    },
    [setColumnSizingPreference],
  );

  // Handle sort change - simply pass the column to the store
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

  // Empty state - memoized to prevent re-renders
  const emptyContent = useMemo(
    () => <div className="text-sm text-zinc-500 dark:text-zinc-400">No resources found</div>,
    [],
  );

  return (
    <div className="table-container flex h-full flex-col">
      <DataTable<Resource>
        data={sortedResources}
        columns={columns}
        getRowId={getRowId}
        // Column management
        columnOrder={columnOrder}
        onColumnOrderChange={handleColumnOrderChange}
        columnVisibility={columnVisibility}
        fixedColumns={fixedColumns}
        // Column sizing
        columnSizeConfigs={RESOURCE_COLUMN_SIZE_CONFIG}
        columnSizingPreferences={columnSizingPreferences}
        onColumnSizingPreferenceChange={handleColumnSizingPreferenceChange}
        // Sorting
        sorting={sortState ?? undefined}
        onSortingChange={handleSortChange}
        // Pagination
        hasNextPage={hasNextPage}
        onLoadMore={onLoadMore}
        isFetchingNextPage={isFetchingNextPage}
        totalCount={totalCount}
        // Layout
        rowHeight={rowHeight}
        compact={compactMode}
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
