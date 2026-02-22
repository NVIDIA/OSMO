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
import { useSelectionState } from "@/hooks/use-url-state";
import { usePanelLifecycle } from "@/hooks/use-panel-lifecycle";
import { usePanelWidth } from "@/hooks/use-panel-width";
import { useViewTransition } from "@/hooks/use-view-transition";
import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { DatasetsDataTable } from "@/app/(dashboard)/datasets/components/table/datasets-data-table";
import { DatasetsToolbar } from "@/app/(dashboard)/datasets/components/toolbar/datasets-toolbar";
import { DatasetPanel } from "@/app/(dashboard)/datasets/components/panel/dataset-panel";
import { useDatasetsData } from "@/app/(dashboard)/datasets/hooks/use-datasets-data";
import { useDatasetsTableStore } from "@/app/(dashboard)/datasets/stores/datasets-table-store";
import { useUser } from "@/lib/auth/user-context";
import { ResizablePanel } from "@/components/panel/resizable-panel";
import { PANEL } from "@/components/panel/panel-header-controls";
import type { SearchChip } from "@/stores/types";
import type { SortState } from "@/components/data-table/types";
import type { Dataset } from "@/lib/api/adapter/datasets";

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
  const router = useRouter();
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
  // Panel state — URL-synced (?view=bucket/name), ResizablePanel slideout
  // ==========================================================================

  // URL state: format is "bucket/name" (nuqs encodes the slash)
  const [selectedView, setSelectedView] = useSelectionState("view");

  // Parse bucket and name from "bucket/name" (split on first "/" only)
  const slashIndex = selectedView ? selectedView.indexOf("/") : -1;
  const selectedBucket = selectedView ? (slashIndex === -1 ? selectedView : selectedView.slice(0, slashIndex)) : null;
  const selectedName = selectedView && slashIndex !== -1 ? selectedView.slice(slashIndex + 1) : null;

  const { panelWidth, setPanelWidth } = usePanelWidth({
    storedWidth: useDatasetsTableStore((s) => s.panelWidth),
    setStoredWidth: useDatasetsTableStore((s) => s.setPanelWidth),
  });

  const {
    isPanelOpen,
    handleClose: handleClosePanel,
    handleClosed: handlePanelClosed,
  } = usePanelLifecycle({
    hasSelection: Boolean(selectedView),
    onClosed: () =>
      startViewTransition(() => {
        void setSelectedView(null);
      }),
  });

  const handleRowSelect = useCallback(
    (dataset: Dataset) => {
      startViewTransition(() => {
        void setSelectedView(`${dataset.bucket}/${dataset.name}`);
      });
    },
    [setSelectedView, startViewTransition],
  );

  const handleRowDoubleClick = useCallback(
    (dataset: Dataset) => {
      startViewTransition(() => {
        router.push(`/datasets/${encodeURIComponent(dataset.bucket)}/${encodeURIComponent(dataset.name)}`);
      });
    },
    [router, startViewTransition],
  );

  const selectedDatasetId = useMemo(() => {
    if (!selectedBucket || !selectedName) return undefined;
    return `${selectedBucket}-${selectedName}`;
  }, [selectedBucket, selectedName]);

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

  const pageContent = (
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
            onRowSelect={handleRowSelect}
            onRowDoubleClick={handleRowDoubleClick}
            selectedDatasetId={selectedDatasetId}
          />
        </InlineErrorBoundary>
      </div>
    </div>
  );

  return (
    <ResizablePanel
      open={isPanelOpen}
      onClose={handleClosePanel}
      onClosed={handlePanelClosed}
      width={panelWidth}
      onWidthChange={setPanelWidth}
      minWidth={PANEL.MIN_WIDTH_PCT}
      maxWidth={PANEL.OVERLAY_MAX_WIDTH_PCT}
      mainContent={pageContent}
      backdrop={false}
      aria-label={selectedBucket && selectedName ? `Dataset details: ${selectedName}` : "Datasets"}
      className="datasets-panel"
    >
      {selectedBucket && selectedName && (
        <InlineErrorBoundary
          title="Unable to load dataset details"
          resetKeys={[selectedBucket, selectedName]}
        >
          <DatasetPanel
            bucket={selectedBucket}
            name={selectedName}
            onClose={handleClosePanel}
          />
        </InlineErrorBoundary>
      )}
    </ResizablePanel>
  );
}
