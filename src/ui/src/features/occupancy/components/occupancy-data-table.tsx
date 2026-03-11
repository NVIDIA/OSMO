// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useMemo, useCallback, memo } from "react";
import { DataTable } from "@/components/data-table/data-table";
import { TableEmptyState } from "@/components/data-table/table-empty-state";
import { TableLoadingSkeleton, TableErrorState } from "@/components/data-table/table-states";
import { useColumnVisibility } from "@/components/data-table/hooks/use-column-visibility";
import type { SortState } from "@/components/data-table/types";
import { useCompactMode } from "@/hooks/shared-preferences-hooks";
import { TABLE_ROW_HEIGHTS } from "@/lib/config";
import type { SearchChip } from "@/stores/types";
import type { OccupancyGroup, OccupancyFlatRow, OccupancyGroupBy } from "@/lib/api/adapter/occupancy";
import {
  MANDATORY_COLUMN_IDS,
  asOccupancyColumnIds,
  OCCUPANCY_COLUMN_SIZE_CONFIG,
} from "@/features/occupancy/lib/occupancy-columns";
import { createOccupancyColumns } from "@/features/occupancy/components/occupancy-column-defs";
import { useOccupancyTableStore } from "@/features/occupancy/stores/occupancy-table-store";
import "@/features/occupancy/styles/occupancy.css";

const FIXED_COLUMNS = Array.from(MANDATORY_COLUMN_IDS);
const isOccupancyRowInteractive = (row: OccupancyFlatRow) => row._type === "parent";

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

function getRowId(row: OccupancyFlatRow): string {
  if (row._type === "parent") return row.key;
  return `${row.parentKey}::${row.key}`;
}

export interface OccupancyDataTableProps {
  groups: OccupancyGroup[];
  groupBy: OccupancyGroupBy;
  searchChips: SearchChip[];
  expandedKeys: Set<string>;
  onToggleExpand: (key: string) => void;
  isLoading?: boolean;
  error?: Error;
  onRetry?: () => void;
}

export const OccupancyDataTable = memo(function OccupancyDataTable({
  groups,
  groupBy,
  searchChips,
  expandedKeys,
  onToggleExpand,
  isLoading = false,
  error,
  onRetry,
}: OccupancyDataTableProps) {
  const compactMode = useCompactMode();
  const rowHeight = compactMode ? TABLE_ROW_HEIGHTS.COMPACT : TABLE_ROW_HEIGHTS.NORMAL;

  const storeVisibleColumnIds = asOccupancyColumnIds(useOccupancyTableStore((s) => s.visibleColumnIds));
  const columnOrder = asOccupancyColumnIds(useOccupancyTableStore((s) => s.columnOrder));
  const setColumnOrder = useOccupancyTableStore((s) => s.setColumnOrder);
  const sortState = useOccupancyTableStore((s) => s.sort);
  const setSort = useOccupancyTableStore((s) => s.setSort);
  const columnSizingPreferences = useOccupancyTableStore((s) => s.columnSizingPreferences);
  const setColumnSizingPreference = useOccupancyTableStore((s) => s.setColumnSizingPreference);

  const columnVisibility = useColumnVisibility(columnOrder, storeVisibleColumnIds);

  const flatRows = useMemo(() => flattenForTable(groups, expandedKeys), [groups, expandedKeys]);

  const columns = useMemo(() => createOccupancyColumns(groupBy, searchChips), [groupBy, searchChips]);

  const handleSortChange = useCallback(
    (newSort: SortState<string>) => {
      if (newSort.column) setSort(newSort.column);
    },
    [setSort],
  );

  const handleRowClick = useCallback(
    (row: OccupancyFlatRow) => {
      if (isOccupancyRowInteractive(row)) onToggleExpand(row.key);
    },
    [onToggleExpand],
  );

  // Zebra striping keyed on group index so parent + children share the same stripe
  const rowClassName = useCallback((row: OccupancyFlatRow) => {
    const zebraClass =
      row._visualGroupIndex % 2 === 0 ? "bg-white dark:bg-zinc-950" : "bg-gray-100/60 dark:bg-zinc-900/50";
    if (row._type === "child") return `occupancy-row occupancy-row--child ${zebraClass}`;
    return `occupancy-row group/occ-row ${zebraClass}${row.isExpanded ? " font-medium" : ""}`;
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
        columnOrder={columnOrder}
        onColumnOrderChange={setColumnOrder}
        columnVisibility={columnVisibility}
        fixedColumns={FIXED_COLUMNS}
        columnSizeConfigs={OCCUPANCY_COLUMN_SIZE_CONFIG}
        columnSizingPreferences={columnSizingPreferences}
        onColumnSizingPreferenceChange={setColumnSizingPreference}
        sorting={sortState ?? undefined}
        onSortingChange={handleSortChange}
        rowHeight={rowHeight}
        compact={compactMode}
        className="text-sm"
        scrollClassName="scrollbar-styled flex-1"
        isLoading={isLoading}
        emptyContent={emptyContent}
        onRowClick={handleRowClick}
        rowClassName={rowClassName}
        isRowInteractive={isOccupancyRowInteractive}
      />
    </div>
  );
});
