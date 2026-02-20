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

/**
 * Datasets Page Content (Client Component)
 *
 * The interactive content of the Datasets page.
 * Receives hydrated data from the server and handles all user interactions.
 *
 * Features:
 * - Smart search with filter chips (name, bucket, user, created_at, updated_at)
 * - "My Datasets" amber pill preset (like "My Workflows")
 * - Column visibility and reordering
 * - Navigation to dataset detail page on row click
 */

"use client";

import { InlineErrorBoundary } from "@/components/error/inline-error-boundary";
import { usePage } from "@/components/chrome/page-context";
import { useResultsCount } from "@/hooks/use-results-count";
import { useDefaultFilter } from "@/hooks/use-default-filter";
import { useViewTransition } from "@/hooks/use-view-transition";
import { useCallback, useMemo } from "react";
import { DatasetsDataTable } from "@/app/(dashboard)/datasets/components/table/datasets-data-table";
import { DatasetsToolbar } from "@/app/(dashboard)/datasets/components/toolbar/datasets-toolbar";
import { useDatasetsData } from "@/app/(dashboard)/datasets/hooks/use-datasets-data";
import { useDatasetsTableStore } from "@/app/(dashboard)/datasets/stores/datasets-table-store";
import { useUser } from "@/lib/auth/user-context";
import type { SearchChip } from "@/stores/types";
import type { SortState } from "@/components/data-table/types";

// =============================================================================
// Types
// =============================================================================

interface DatasetsPageContentProps {
  initialUsername?: string | null;
}

// =============================================================================
// Client Component
// =============================================================================

export function DatasetsPageContent({ initialUsername }: DatasetsPageContentProps) {
  usePage({ title: "Datasets" });
  const { startTransition: startViewTransition } = useViewTransition();
  const { user } = useUser();

  const currentUsername = initialUsername ?? user?.username ?? null;

  // ==========================================================================
  // Sort state from store (persisted, client-side via shim)
  // ==========================================================================

  const storeSort = useDatasetsTableStore((s) => s.sort);
  const setSort = useDatasetsTableStore((s) => s.setSort);
  const clearSort = useDatasetsTableStore((s) => s.clearSort);

  const sortState = useMemo((): SortState<string> | undefined => {
    if (!storeSort) return undefined;
    return { column: storeSort.column, direction: storeSort.direction };
  }, [storeSort]);

  const handleSortingChange = useCallback(
    (newSort: SortState<string>) => {
      if (newSort.column) {
        setSort(newSort.column);
      } else {
        clearSort();
      }
    },
    [setSort, clearSort],
  );

  // ==========================================================================
  // Default user filter — "My Datasets" by default, opt-out via ?all=true
  // ==========================================================================

  const { effectiveChips, handleChipsChange, optOut } = useDefaultFilter({
    field: "user",
    defaultValue: currentUsername,
    label: `user: ${currentUsername}`,
  });

  const handleSearchChipsChange = useCallback(
    (chips: SearchChip[]) => startViewTransition(() => handleChipsChange(chips)),
    [handleChipsChange, startViewTransition],
  );

  // ==========================================================================
  // Data Fetching — fetch-all + shim approach
  // Fetches all datasets at once (count: 10_000); shim applies client-side
  // date range filters from the React Query cache (no infinite scroll).
  // ==========================================================================

  const { datasets, allDatasets, isLoading, error, refetch, total, filteredTotal, hasActiveFilters } = useDatasetsData({
    searchChips: effectiveChips,
    showAllUsers: optOut,
    sort: storeSort ?? null,
  });

  // Results count for FilterBar display (consolidated hook)
  const resultsCount = useResultsCount({ total, filteredTotal, hasActiveFilters });

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      {/* Toolbar with search and controls */}
      <div className="shrink-0">
        <InlineErrorBoundary
          title="Toolbar error"
          compact
        >
          <DatasetsToolbar
            datasets={allDatasets}
            searchChips={effectiveChips}
            onSearchChipsChange={handleSearchChipsChange}
            resultsCount={resultsCount}
            currentUsername={currentUsername}
            onRefresh={refetch}
            isRefreshing={isLoading}
          />
        </InlineErrorBoundary>
      </div>

      {/* Main datasets table */}
      <div className="min-h-0 flex-1">
        <InlineErrorBoundary
          title="Unable to display datasets table"
          resetKeys={[datasets.length]}
          onReset={refetch}
        >
          <DatasetsDataTable
            datasets={datasets}
            totalCount={total}
            isLoading={isLoading}
            error={error ?? undefined}
            onRetry={refetch}
            sorting={sortState}
            onSortingChange={handleSortingChange}
          />
        </InlineErrorBoundary>
      </div>
    </div>
  );
}
