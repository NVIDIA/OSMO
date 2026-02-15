//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

/**
 * Dataset Versions Data Table
 *
 * Table display of version history matching workflows Tasks table style.
 * Supports search, filtering, column management, sorting, and virtualization.
 */

"use client";

import { useMemo, useCallback, useState, memo } from "react";
import { DataTable } from "@/components/data-table/DataTable";
import { TableEmptyState } from "@/components/data-table/TableEmptyState";
import { TableToolbar } from "@/components/data-table/TableToolbar";
import { useColumnVisibility } from "@/components/data-table/hooks/use-column-visibility";
import type { SortState } from "@/components/data-table/types";
import { useSharedPreferences } from "@/stores/shared-preferences-store";
import { TABLE_ROW_HEIGHTS } from "@/lib/config";
import { useResultsCount } from "@/hooks/use-results-count";
import { naturalCompare } from "@/lib/utils";
import { filterByChips } from "@/components/filter-bar/lib/filter";
import type { SearchChip } from "@/components/filter-bar/lib/types";

import type { DatasetVersion } from "@/lib/api/adapter/datasets";
import {
  createVersionColumns,
  type DatasetVersionWithMetadata,
} from "@/app/(dashboard)/datasets/[bucket]/[name]/lib/version-column-defs";
import {
  useVersionsTableStore,
  MANDATORY_VERSION_COLUMNS,
} from "@/app/(dashboard)/datasets/[bucket]/[name]/stores/versions-table-store";
import {
  VERSION_COLUMN_SIZE_CONFIG,
  OPTIONAL_VERSION_COLUMNS_ALPHABETICAL,
} from "@/app/(dashboard)/datasets/[bucket]/[name]/lib/version-columns";
import { VERSION_SEARCH_FIELDS } from "@/app/(dashboard)/datasets/[bucket]/[name]/lib/version-search-fields";

interface DatasetVersionsDataTableProps {
  versions: DatasetVersion[];
  currentVersion?: number;
}

export const DatasetVersionsDataTable = memo(function DatasetVersionsDataTable({
  versions,
  currentVersion,
}: DatasetVersionsDataTableProps) {
  // Search chips for filtering
  const [searchChips, setSearchChips] = useState<SearchChip[]>([]);

  // Shared preferences (compact mode)
  const compactMode = useSharedPreferences((s) => s.compactMode);

  // Versions table store (column visibility, order, sort)
  const visibleColumnIds = useVersionsTableStore((s) => s.visibleColumnIds);
  const columnOrder = useVersionsTableStore((s) => s.columnOrder);
  const setColumnOrder = useVersionsTableStore((s) => s.setColumnOrder);
  const toggleColumn = useVersionsTableStore((s) => s.toggleColumn);
  const sort = useVersionsTableStore((s) => s.sort);
  const setSort = useVersionsTableStore((s) => s.setSort);

  // Row height based on compact mode
  const rowHeight = compactMode ? TABLE_ROW_HEIGHTS.COMPACT : TABLE_ROW_HEIGHTS.NORMAL;

  // Sort comparator
  const sortComparator = useMemo(() => {
    const column = sort?.column;
    const direction = sort?.direction;
    if (!column) return null;
    const dir = direction === "asc" ? 1 : -1;

    switch (column) {
      case "version":
        return (a: DatasetVersion, b: DatasetVersion) => (parseInt(a.version) - parseInt(b.version)) * dir;
      case "status":
        return (a: DatasetVersion, b: DatasetVersion) => naturalCompare(a.status, b.status) * dir;
      case "created_by":
        return (a: DatasetVersion, b: DatasetVersion) => naturalCompare(a.created_by, b.created_by) * dir;
      case "created_date":
        return (a: DatasetVersion, b: DatasetVersion) => {
          const aTime = new Date(a.created_date).getTime();
          const bTime = new Date(b.created_date).getTime();
          return (aTime - bTime) * dir;
        };
      case "last_used":
        return (a: DatasetVersion, b: DatasetVersion) => {
          const aTime = new Date(a.last_used).getTime();
          const bTime = new Date(b.last_used).getTime();
          return (aTime - bTime) * dir;
        };
      case "size":
        return (a: DatasetVersion, b: DatasetVersion) => (a.size - b.size) * dir;
      case "retention":
        return (a: DatasetVersion, b: DatasetVersion) => (a.retention_policy - b.retention_policy) * dir;
      default:
        return null;
    }
  }, [sort]);

  // Process versions: filter, sort, augment with metadata
  const processedVersions = useMemo(() => {
    // Step 1: Apply search filtering
    const filtered = filterByChips(versions, searchChips, VERSION_SEARCH_FIELDS);

    // Step 2: Apply sorting
    const sorted = sortComparator ? [...filtered].sort(sortComparator) : filtered;

    // Step 3: Augment with metadata
    return sorted.map(
      (version, index): DatasetVersionWithMetadata => ({
        ...version,
        _visualRowIndex: index,
        _isCurrent: currentVersion !== undefined && parseInt(version.version) === currentVersion,
      }),
    );
  }, [versions, searchChips, sortComparator, currentVersion]);

  // Results count for toolbar display
  const resultsCount = useResultsCount({
    total: versions.length,
    filteredTotal: processedVersions.length,
    hasActiveFilters: searchChips.length > 0,
  });

  // Column definitions
  const columns = useMemo(() => createVersionColumns(), []);

  // Fixed columns (not draggable)
  const fixedColumns = useMemo(() => Array.from(MANDATORY_VERSION_COLUMNS), []);

  const columnVisibility = useColumnVisibility(columnOrder, visibleColumnIds);

  // Get row ID
  const getRowId = useCallback((version: DatasetVersionWithMetadata) => {
    return version.version;
  }, []);

  // Handle sort change
  const handleSortChange = useCallback(
    (newSort: SortState<string>) => {
      if (newSort.column) {
        setSort(newSort.column);
      }
    },
    [setSort],
  );

  // Convert store sort to DataTable format
  const tableSorting = useMemo<SortState<string> | undefined>(() => {
    if (!sort) return undefined;
    return { column: sort.column, direction: sort.direction };
  }, [sort]);

  // Row class name for zebra striping
  const rowClassName = useCallback((version: DatasetVersionWithMetadata) => {
    const visualIndex = version._visualRowIndex ?? 0;
    return visualIndex % 2 === 0 ? "bg-white dark:bg-zinc-950" : "bg-gray-100/60 dark:bg-zinc-900/50";
  }, []);

  const emptyContent = useMemo(() => {
    if (versions.length === 0) {
      return <TableEmptyState message="No versions available" />;
    }
    if (processedVersions.length === 0) {
      return <TableEmptyState message="No versions match your search" />;
    }
    return null;
  }, [versions.length, processedVersions.length]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar: Search + Controls */}
      <div className="border-b border-gray-200 px-4 py-3 dark:border-zinc-800">
        <TableToolbar
          data={versions}
          searchFields={VERSION_SEARCH_FIELDS}
          columns={OPTIONAL_VERSION_COLUMNS_ALPHABETICAL}
          visibleColumnIds={visibleColumnIds}
          onToggleColumn={toggleColumn}
          searchChips={searchChips}
          onSearchChipsChange={setSearchChips}
          placeholder="Filter by version, status:, user:, tags:..."
          resultsCount={resultsCount}
        />
      </div>

      {/* Versions Table */}
      <DataTable<DatasetVersionWithMetadata>
        data={processedVersions}
        columns={columns}
        getRowId={getRowId}
        // Column management
        columnOrder={columnOrder}
        onColumnOrderChange={setColumnOrder}
        columnVisibility={columnVisibility}
        fixedColumns={fixedColumns}
        // Column sizing
        columnSizeConfigs={VERSION_COLUMN_SIZE_CONFIG}
        // Sorting
        sorting={tableSorting}
        onSortingChange={handleSortChange}
        // Layout
        rowHeight={rowHeight}
        compact={compactMode}
        className="text-sm"
        scrollClassName="flex-1"
        // State
        emptyContent={emptyContent}
        rowClassName={rowClassName}
      />
    </div>
  );
});
