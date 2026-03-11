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

import { memo, useId, useMemo } from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { TableToolbar } from "@/components/data-table/table-toolbar";
import { Button } from "@/components/shadcn/button";
import type { RefreshControlProps } from "@/components/refresh/refresh-control";
import type { ResultsCount } from "@/components/filter-bar/lib/types";
import type { SearchChip } from "@/stores/types";
import type { OccupancyGroup, OccupancyGroupBy } from "@/lib/api/adapter/occupancy";
import { OPTIONAL_COLUMNS } from "@/features/occupancy/lib/occupancy-columns";
import { getOccupancySearchFields } from "@/features/occupancy/lib/occupancy-search-fields";
import { useOccupancyTableStore } from "@/features/occupancy/stores/occupancy-table-store";
import { TASK_GROUP_STATUS_PRESETS } from "@/lib/task-group-status-presets";

export interface OccupancyToolbarProps {
  groups: OccupancyGroup[];
  groupBy: OccupancyGroupBy;
  onGroupByChange: (groupBy: OccupancyGroupBy) => void;
  allExpanded: boolean;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  searchChips: SearchChip[];
  onSearchChipsChange: (chips: SearchChip[]) => void;
  resultsCount?: ResultsCount;
  onRefresh: () => void;
  isRefreshing: boolean;
}

const GROUP_BY_OPTIONS: { value: OccupancyGroupBy; label: string }[] = [
  { value: "pool", label: "By Pool" },
  { value: "user", label: "By User" },
];

function GroupByToggle({ value, onChange }: { value: OccupancyGroupBy; onChange: (v: OccupancyGroupBy) => void }) {
  const groupId = useId();
  const selectedIndex = GROUP_BY_OPTIONS.findIndex((o) => o.value === value);

  return (
    <div
      className="bg-muted relative flex gap-1 rounded-md p-1"
      role="radiogroup"
      aria-label="Group by"
    >
      <div
        className="bg-background pointer-events-none absolute inset-y-1 rounded-sm shadow-sm transition-transform duration-200 ease-out"
        style={{
          left: "0.25rem",
          width: `calc((100% - 0.5rem - 0.25rem) / 2)`,
          transform: `translateX(calc(${selectedIndex * 100}% + ${selectedIndex * 0.25}rem))`,
        }}
      />
      {GROUP_BY_OPTIONS.map((option) => {
        const inputId = `${groupId}-${option.value}`;
        const isSelected = value === option.value;
        return (
          <label
            key={option.value}
            htmlFor={inputId}
            className={`relative z-10 cursor-pointer rounded-sm px-3 py-1.5 text-sm font-medium transition-colors duration-200 ease-out ${isSelected ? "text-foreground" : "text-muted-foreground"}`}
          >
            <input
              type="radio"
              id={inputId}
              name={`${groupId}-groupby`}
              value={option.value}
              checked={isSelected}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}

export const OccupancyToolbar = memo(function OccupancyToolbar({
  groups,
  groupBy,
  onGroupByChange,
  allExpanded,
  onExpandAll,
  onCollapseAll,
  searchChips,
  onSearchChipsChange,
  resultsCount,
  onRefresh,
  isRefreshing,
}: OccupancyToolbarProps) {
  const visibleColumnIds = useOccupancyTableStore((s) => s.visibleColumnIds);
  const toggleColumn = useOccupancyTableStore((s) => s.toggleColumn);

  const searchFields = useMemo(() => getOccupancySearchFields(groupBy), [groupBy]);
  const refreshProps: RefreshControlProps = useMemo(() => ({ onRefresh, isRefreshing }), [onRefresh, isRefreshing]);

  return (
    <div className="flex items-center gap-3">
      <GroupByToggle
        value={groupBy}
        onChange={onGroupByChange}
      />
      <div className="min-w-0 flex-1">
        <TableToolbar
          data={groups}
          searchFields={searchFields}
          columns={OPTIONAL_COLUMNS}
          visibleColumnIds={visibleColumnIds}
          onToggleColumn={toggleColumn}
          searchChips={searchChips}
          onSearchChipsChange={onSearchChipsChange}
          placeholder="Search pools, users, priority..."
          searchPresets={TASK_GROUP_STATUS_PRESETS}
          resultsCount={resultsCount}
          autoRefreshProps={refreshProps}
        >
          <Button
            variant="outline"
            size="sm"
            onClick={allExpanded ? onCollapseAll : onExpandAll}
            title={allExpanded ? "Collapse all" : "Expand all"}
            aria-label={allExpanded ? "Collapse all rows" : "Expand all rows"}
          >
            {allExpanded ? <ChevronsDownUp className="h-4 w-4" /> : <ChevronsUpDown className="h-4 w-4" />}
          </Button>
        </TableToolbar>
      </div>
    </div>
  );
});
