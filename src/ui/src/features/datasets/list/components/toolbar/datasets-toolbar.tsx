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
import { User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SearchChip } from "@/stores/types";
import type { ResultsCount, SearchField, SearchPreset } from "@/components/filter-bar/lib/types";
import { TableToolbar } from "@/components/data-table/table-toolbar";
import { useDatasetsTableStore } from "@/features/datasets/list/stores/datasets-table-store";
import { OPTIONAL_COLUMNS } from "@/features/datasets/list/lib/dataset-columns";
import { DATASET_STATIC_FIELDS, type Dataset } from "@/features/datasets/list/lib/dataset-search-fields";
import { useDatasetsAsyncFields } from "@/features/datasets/list/hooks/use-datasets-async-fields";

// =============================================================================
// Helpers
// =============================================================================

function presetPillClasses(bgClass: string, active: boolean): string {
  return cn(
    "inline-flex items-center gap-1.5 rounded px-2 py-0.5 transition-all",
    bgClass,
    active && "ring-2 ring-black/15 ring-inset dark:ring-white/20",
    "group-data-[selected=true]:scale-105 group-data-[selected=true]:shadow-lg",
    !active && "opacity-70 group-data-[selected=true]:opacity-100 hover:opacity-100",
  );
}

// =============================================================================
// Props
// =============================================================================

export interface DatasetsToolbarProps {
  datasets: Dataset[];
  searchChips: SearchChip[];
  onSearchChipsChange: (chips: SearchChip[]) => void;
  /** Results count for displaying "N results" or "M of N results" */
  resultsCount?: ResultsCount;
  /** Current username for "My Datasets" preset */
  currentUsername?: string | null;
  /** Manual refresh callback */
  onRefresh: () => void;
  /** Loading state for refresh button */
  isRefreshing: boolean;
}

// =============================================================================
// Component
// =============================================================================

export const DatasetsToolbar = memo(function DatasetsToolbar({
  datasets,
  searchChips,
  onSearchChipsChange,
  resultsCount,
  currentUsername,
  onRefresh,
  isRefreshing,
}: DatasetsToolbarProps) {
  const visibleColumnIds = useDatasetsTableStore((s) => s.visibleColumnIds);
  const toggleColumn = useDatasetsTableStore((s) => s.toggleColumn);

  // Async fields: user list from /api/users with lazy loading
  const { userField } = useDatasetsAsyncFields();

  // Compose static + async fields
  const searchFields = useMemo(
    (): readonly SearchField<Dataset>[] => [
      DATASET_STATIC_FIELDS[0], // name
      DATASET_STATIC_FIELDS[1], // bucket
      userField, // async - complete user list
      DATASET_STATIC_FIELDS[2], // created_at
      DATASET_STATIC_FIELDS[3], // updated_at
    ],
    [userField],
  );

  // "My Datasets" preset: replaces all user chips with the current user chip.
  // Uses onSelect to override the default additive toggle with replace semantics.
  const myDatasetsPreset = useMemo((): SearchPreset | null => {
    if (!currentUsername) return null;

    const userChips = searchChips.filter((c) => c.field === "user");
    const isActive = userChips.length === 1 && userChips[0].value === currentUsername;

    return {
      id: "my-datasets",
      chips: [{ field: "user", value: currentUsername, label: `user: ${currentUsername}` }],
      onSelect: (currentChips) => {
        const nonUserChips = currentChips.filter((c) => c.field !== "user");
        const currentUserChips = currentChips.filter((c) => c.field === "user");
        const isMine = currentUserChips.length === 1 && currentUserChips[0].value === currentUsername;
        if (isMine) return nonUserChips;
        return [...nonUserChips, { field: "user", value: currentUsername, label: `user: ${currentUsername}` }];
      },
      render: () => (
        <span className={presetPillClasses("bg-amber-50 dark:bg-amber-500/20", isActive)}>
          <User className="size-3.5 text-amber-600 dark:text-amber-400" />
          <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">My Datasets</span>
        </span>
      ),
    };
  }, [currentUsername, searchChips]);

  const searchPresets = useMemo(() => {
    if (!myDatasetsPreset) return undefined;
    return [{ label: "User:", items: [myDatasetsPreset] }];
  }, [myDatasetsPreset]);

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
      defaultField="name"
      placeholder="Search datasets... (try 'name:', 'bucket:', 'user:', 'created_at:')"
      searchPresets={searchPresets}
      resultsCount={resultsCount}
      autoRefreshProps={autoRefreshProps}
    />
  );
});
