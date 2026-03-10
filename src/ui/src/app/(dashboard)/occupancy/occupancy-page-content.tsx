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
 * Occupancy Page Content (Client Component)
 *
 * Layout: Toolbar → Summary cards → Collapsible-row table
 *
 * Data source: GET /api/task?summary=true → aggregated by user or pool.
 * All aggregation is client-side (shim) until backend ships group_by pagination (Issue #23).
 */

"use client";

import { useMemo, useCallback, useState } from "react";
import { useQueryState, parseAsStringLiteral } from "nuqs";
import { InlineErrorBoundary } from "@/components/error/inline-error-boundary";
import { usePage } from "@/components/chrome/page-context";
import { useResultsCount } from "@/components/filter-bar/hooks/use-results-count";
import { useUrlChips } from "@/components/filter-bar/hooks/use-url-chips";
import { OccupancyToolbar } from "@/features/occupancy/components/occupancy-toolbar";
import { OccupancySummary } from "@/features/occupancy/components/occupancy-summary";
import { OccupancyDataTable } from "@/features/occupancy/components/occupancy-data-table";
import { useOccupancyData } from "@/features/occupancy/hooks/use-occupancy-data";
import { useOccupancyTableStore } from "@/features/occupancy/stores/occupancy-table-store";
import type { OccupancyGroupBy, OccupancySortBy } from "@/lib/api/adapter/occupancy";

// =============================================================================
// GroupBy parser for URL state
// =============================================================================

const GROUP_BY_VALUES = ["user", "pool"] as const;
const parseAsGroupBy = parseAsStringLiteral(GROUP_BY_VALUES);

// =============================================================================
// Component
// =============================================================================

export function OccupancyPageContent() {
  usePage({ title: "Occupancy" });

  // ==========================================================================
  // URL State
  // ==========================================================================

  const [groupBy, setGroupBy] = useQueryState(
    "groupBy",
    parseAsGroupBy.withDefault("user").withOptions({ shallow: true, history: "replace", clearOnDefault: true }),
  );

  const { searchChips, setSearchChips } = useUrlChips();

  // ==========================================================================
  // Sort state from table store
  // ==========================================================================

  const sortState = useOccupancyTableStore((s) => s.sort);
  const sortBy: OccupancySortBy = (sortState?.column as OccupancySortBy) ?? "gpu";
  const order: "asc" | "desc" = sortState?.direction ?? "desc";

  // ==========================================================================
  // Data
  // ==========================================================================

  const { groups, totals, isLoading, error, refetch, truncated } = useOccupancyData({
    groupBy,
    sortBy,
    order,
    searchChips,
  });

  // ==========================================================================
  // Toolbar props
  // ==========================================================================

  const resultsCount = useResultsCount({
    total: groups.length,
    filteredTotal: groups.length,
    hasActiveFilters: searchChips.length > 0,
  });

  const handleGroupByChange = useCallback(
    (value: OccupancyGroupBy) => {
      void setGroupBy(value);
    },
    [setGroupBy],
  );

  // ==========================================================================
  // Expand/collapse state — lifted here so toolbar can drive expand-all/collapse-all.
  // Reset when groupBy changes (stale keys from old view are meaningless).
  // ==========================================================================

  const [expandedState, setExpandedState] = useState<{ groupBy: OccupancyGroupBy; keys: Set<string> }>({
    groupBy,
    keys: new Set(),
  });

  const expandedKeys = useMemo(
    () => (expandedState.groupBy === groupBy ? expandedState.keys : new Set<string>()),
    [expandedState, groupBy],
  );

  const handleToggleExpand = useCallback(
    (key: string) => {
      setExpandedState((prev) => {
        const base = prev.groupBy === groupBy ? new Set(prev.keys) : new Set<string>();
        if (base.has(key)) base.delete(key);
        else base.add(key);
        return { groupBy, keys: base };
      });
    },
    [groupBy],
  );

  const handleExpandAll = useCallback(() => {
    setExpandedState({ groupBy, keys: new Set(groups.map((g) => g.key)) });
  }, [groupBy, groups]);

  const handleCollapseAll = useCallback(() => {
    setExpandedState({ groupBy, keys: new Set() });
  }, [groupBy]);

  const allExpanded = groups.length > 0 && expandedKeys.size === groups.length;

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      {/* Toolbar */}
      <div className="shrink-0">
        <InlineErrorBoundary
          title="Toolbar error"
          compact
        >
          <OccupancyToolbar
            groups={groups}
            groupBy={groupBy}
            onGroupByChange={handleGroupByChange}
            allExpanded={allExpanded}
            onExpandAll={handleExpandAll}
            onCollapseAll={handleCollapseAll}
            searchChips={searchChips}
            onSearchChipsChange={setSearchChips}
            resultsCount={resultsCount}
            onRefresh={refetch}
            isRefreshing={isLoading}
          />
        </InlineErrorBoundary>
      </div>

      {/* KPI summary cards */}
      <div className="shrink-0">
        <InlineErrorBoundary
          title="Summary cards error"
          compact
        >
          <OccupancySummary
            totals={totals}
            isLoading={isLoading && groups.length === 0}
          />
        </InlineErrorBoundary>
      </div>

      {/* Scale limit warning */}
      {truncated && (
        <div className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          Results may be incomplete — reached the 10,000 row fetch limit. Backend group_by pagination (Issue #23) is
          required for full data at this scale.
        </div>
      )}

      {/* Main table */}
      <div className="min-h-0 flex-1">
        <InlineErrorBoundary
          title="Unable to display occupancy table"
          resetKeys={[groups.length]}
          onReset={refetch}
        >
          <OccupancyDataTable
            groups={groups}
            groupBy={groupBy}
            expandedKeys={expandedKeys}
            onToggleExpand={handleToggleExpand}
            isLoading={isLoading}
            error={error ?? undefined}
            onRetry={refetch}
          />
        </InlineErrorBoundary>
      </div>
    </div>
  );
}
