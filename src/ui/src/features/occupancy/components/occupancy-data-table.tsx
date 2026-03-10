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

"use client";

import { useMemo, useCallback, memo } from "react";
import { DataTable } from "@/components/data-table/data-table";
import { TableEmptyState } from "@/components/data-table/table-empty-state";
import { TableLoadingSkeleton, TableErrorState } from "@/components/data-table/table-states";
import { useColumnVisibility } from "@/components/data-table/hooks/use-column-visibility";
import type { SortState } from "@/components/data-table/types";
import { useCompactMode } from "@/hooks/shared-preferences-hooks";
import { TABLE_ROW_HEIGHTS } from "@/lib/config";
import type { OccupancyGroup, OccupancyFlatRow, OccupancyGroupBy } from "@/lib/api/adapter/occupancy";
import {
  MANDATORY_COLUMN_IDS,
  asOccupancyColumnIds,
  OCCUPANCY_COLUMN_SIZE_CONFIG,
} from "@/features/occupancy/lib/occupancy-columns";
import { createOccupancyColumns } from "@/features/occupancy/components/occupancy-column-defs";
import { useOccupancyTableStore } from "@/features/occupancy/stores/occupancy-table-store";
import "@/features/occupancy/styles/occupancy.css";

// Module-level constant — stable reference, no useMemo needed
const FIXED_COLUMNS = Array.from(MANDATORY_COLUMN_IDS);

// =============================================================================
// Helpers
// =============================================================================

/** Flatten groups + expand state into a flat row array for DataTable */
function flattenForTable(groups: OccupancyGroup[], expandedKeys: Set<string>): OccupancyFlatRow[] {
  return groups.flatMap((group, groupIndex) => {
    const parent: OccupancyFlatRow = {
      _type: "parent",
      ...group,
      isExpanded: expandedKeys.has(group.key),
      childCount: group.children.length,
      _visualGroupIndex: groupIndex,
    };
    if (!expandedKeys.has(group.key)) return [parent];
    return [
      parent,
      ...group.children.map(
        (child): OccupancyFlatRow => ({
          _type: "child",
          parentKey: group.key,
          _visualGroupIndex: groupIndex,
          ...child,
        }),
      ),
    ];
  });
}

/** Stable row ID: parent = key, child = parentKey::key */
function getRowId(row: OccupancyFlatRow): string {
  if (row._type === "parent") return row.key;
  return `${row.parentKey}::${row.key}`;
}

// =============================================================================
// Types
// =============================================================================

export interface OccupancyDataTableProps {
  groups: OccupancyGroup[];
  groupBy: OccupancyGroupBy;
  expandedKeys: Set<string>;
  onToggleExpand: (key: string) => void;
  isLoading?: boolean;
  error?: Error;
  onRetry?: () => void;
}

// =============================================================================
// Component
// =============================================================================

export const OccupancyDataTable = memo(function OccupancyDataTable({
  groups,
  groupBy,
  expandedKeys,
  onToggleExpand,
  isLoading = false,
  error,
  onRetry,
}: OccupancyDataTableProps) {
  const compactMode = useCompactMode();
  const rowHeight = compactMode ? TABLE_ROW_HEIGHTS.COMPACT : TABLE_ROW_HEIGHTS.NORMAL;

  // Table store state
  const storeVisibleColumnIds = asOccupancyColumnIds(useOccupancyTableStore((s) => s.visibleColumnIds));
  const columnOrder = asOccupancyColumnIds(useOccupancyTableStore((s) => s.columnOrder));
  const setColumnOrder = useOccupancyTableStore((s) => s.setColumnOrder);
  const sortState = useOccupancyTableStore((s) => s.sort);
  const setSort = useOccupancyTableStore((s) => s.setSort);
  const columnSizingPreferences = useOccupancyTableStore((s) => s.columnSizingPreferences);
  const setColumnSizingPreference = useOccupancyTableStore((s) => s.setColumnSizingPreference);

  const columnVisibility = useColumnVisibility(columnOrder, storeVisibleColumnIds);

  // Flatten groups into flat rows for DataTable (includes expanded children)
  const flatRows = useMemo(() => flattenForTable(groups, expandedKeys), [groups, expandedKeys]);

  const columns = useMemo(() => createOccupancyColumns(groupBy), [groupBy]);

  const handleSortChange = useCallback(
    (newSort: SortState<string>) => {
      if (newSort.column) setSort(newSort.column);
    },
    [setSort],
  );

  // Row click toggles expand on parent rows; no-op on children
  const handleRowClick = useCallback(
    (row: OccupancyFlatRow) => {
      if (row._type === "parent") onToggleExpand(row.key);
    },
    [onToggleExpand],
  );

  // Row styling: zebra striping keyed on group index so parent + all children share the same stripe
  const rowClassName = useCallback((row: OccupancyFlatRow) => {
    const zebraClass =
      row._visualGroupIndex % 2 === 0 ? "bg-white dark:bg-zinc-950" : "bg-gray-100/60 dark:bg-zinc-900/50";
    if (row._type === "child") return `occupancy-row occupancy-row--child ${zebraClass}`;
    return `occupancy-row ${zebraClass}${row.isExpanded ? " font-medium" : ""}`;
  }, []);

  const emptyContent = useMemo(() => <TableEmptyState message="No occupancy data available" />, []);

  if (isLoading && groups.length === 0) {
    return (
      <TableLoadingSkeleton
        className="occupancy-table-container table-container"
        rowHeight={rowHeight}
      />
    );
  }

  if (error) {
    return (
      <TableErrorState
        error={error}
        title="Unable to load occupancy data"
        onRetry={onRetry}
        className="occupancy-table-container table-container"
      />
    );
  }

  return (
    <div className="occupancy-table-container table-container relative h-full">
      <DataTable<OccupancyFlatRow>
        data={flatRows}
        columns={columns}
        getRowId={getRowId}
        // Column management
        columnOrder={columnOrder}
        onColumnOrderChange={setColumnOrder}
        columnVisibility={columnVisibility}
        fixedColumns={FIXED_COLUMNS}
        // Column sizing
        columnSizeConfigs={OCCUPANCY_COLUMN_SIZE_CONFIG}
        columnSizingPreferences={columnSizingPreferences}
        onColumnSizingPreferenceChange={setColumnSizingPreference}
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
        rowClassName={rowClassName}
      />
    </div>
  );
});
