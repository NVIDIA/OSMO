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

import { memo, useMemo } from "react";
import { User, Users } from "lucide-react";
import { SemiStatefulButton } from "@/components/shadcn/semi-stateful-button";
import type { SearchChip } from "@/stores/types";
import type { ResultsCount, SearchField } from "@/components/filter-bar/lib/types";
import { TableToolbar } from "@/components/data-table/TableToolbar";
import { useDatasetsTableStore } from "@/app/(dashboard)/datasets/stores/datasets-table-store";
import { OPTIONAL_COLUMNS } from "@/app/(dashboard)/datasets/lib/dataset-columns";
import { DATASET_STATIC_FIELDS, type Dataset } from "@/app/(dashboard)/datasets/lib/dataset-search-fields";

export interface DatasetsToolbarProps {
  datasets: Dataset[];
  searchChips: SearchChip[];
  onSearchChipsChange: (chips: SearchChip[]) => void;
  /** Results count for displaying "N results" or "M of N results" */
  resultsCount?: ResultsCount;
  /** Show all users' datasets (true) or only current user's (false) */
  showAllUsers: boolean;
  /** Whether the show all users toggle is pending (async URL update) */
  showAllUsersPending: boolean;
  /** Callback when show all users toggle is clicked */
  onToggleShowAllUsers: () => void;
  /** Manual refresh callback */
  onRefresh: () => void;
  /** Loading state for refresh button */
  isRefreshing: boolean;
}

interface UserToggleProps {
  showAllUsers: boolean;
  isTransitioning: boolean;
  onToggle: () => void;
}

const UserToggle = memo(function UserToggle({ showAllUsers, isTransitioning, onToggle }: UserToggleProps) {
  return (
    <SemiStatefulButton
      onClick={onToggle}
      currentStateIcon={showAllUsers ? <Users className="size-4" /> : <User className="size-4" />}
      nextStateIcon={showAllUsers ? <User className="size-4" /> : <Users className="size-4" />}
      label={showAllUsers ? "Show My Datasets" : "Show All Datasets"}
      aria-label={showAllUsers ? "Currently showing all users' datasets" : "Currently showing my datasets"}
      tooltipSide="top"
      isTransitioning={isTransitioning}
    />
  );
});

export const DatasetsToolbar = memo(function DatasetsToolbar({
  datasets,
  searchChips,
  onSearchChipsChange,
  resultsCount,
  showAllUsers,
  showAllUsersPending,
  onToggleShowAllUsers,
  onRefresh,
  isRefreshing,
}: DatasetsToolbarProps) {
  const visibleColumnIds = useDatasetsTableStore((s) => s.visibleColumnIds);
  const toggleColumn = useDatasetsTableStore((s) => s.toggleColumn);

  // Use static search fields
  const searchFields = useMemo((): readonly SearchField<Dataset>[] => DATASET_STATIC_FIELDS, []);

  // Memoize autoRefreshProps to prevent unnecessary TableToolbar re-renders
  const autoRefreshProps = useMemo(
    () => ({
      onRefresh,
      isRefreshing,
    }),
    [onRefresh, isRefreshing],
  );

  return (
    <TableToolbar
      data={datasets}
      searchFields={searchFields}
      columns={OPTIONAL_COLUMNS}
      visibleColumnIds={visibleColumnIds}
      onToggleColumn={toggleColumn}
      searchChips={searchChips}
      onSearchChipsChange={onSearchChipsChange}
      placeholder="Search datasets... (try 'name:', 'format:', 'bucket:')"
      resultsCount={resultsCount}
      autoRefreshProps={autoRefreshProps}
    >
      <UserToggle
        showAllUsers={showAllUsers}
        isTransitioning={showAllUsersPending}
        onToggle={onToggleShowAllUsers}
      />
    </TableToolbar>
  );
});
