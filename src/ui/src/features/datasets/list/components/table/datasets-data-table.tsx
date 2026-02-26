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
 * Datasets Data Table
 *
 * Dataset-specific wrapper around DataTable that handles:
 * - Flat table with full sorting flexibility
 * - Infinite scroll pagination
 * - Navigation to dataset detail page on click
 *
 * Built on the canonical DataTable component.
 */

"use client";

import { useMemo, useCallback, useRef, memo } from "react";
import { usePathname } from "next/navigation";
import { useNavigationRouter } from "@/hooks/use-navigation-router";
import { useViewTransition } from "@/hooks/use-view-transition";
import { DataTable } from "@/components/data-table/data-table";
import { TableEmptyState } from "@/components/data-table/table-empty-state";
import { TableLoadingSkeleton, TableErrorState } from "@/components/data-table/table-states";
import { useColumnVisibility } from "@/components/data-table/hooks/use-column-visibility";
import type { ColumnSizingPreference, SortState } from "@/components/data-table/types";
import { useCompactMode } from "@/hooks/shared-preferences-hooks";
import { TABLE_ROW_HEIGHTS } from "@/lib/config";
import type { Dataset } from "@/lib/api/adapter/datasets";
import {
  MANDATORY_COLUMN_IDS,
  asDatasetColumnIds,
  DATASET_COLUMN_SIZE_CONFIG,
} from "@/features/datasets/list/lib/dataset-columns";
import { createDatasetColumns } from "@/features/datasets/list/components/table/dataset-column-defs";
import { useDatasetsTableStore } from "@/features/datasets/list/stores/datasets-table-store";
import { useBreadcrumbOrigin } from "@/components/chrome/breadcrumb-origin-context";

// =============================================================================
// Types
// =============================================================================

export interface DatasetsDataTableProps {
  /** Dataset data */
  datasets: Dataset[];
  /** Total count before filters */
  totalCount?: number;
  /** Loading state */
  isLoading?: boolean;
  /** Error state */
  error?: Error;
  /** Retry callback */
  onRetry?: () => void;

  // === Sort props ===
  /** Current sort state */
  sorting?: SortState<string>;
  /** Callback when sort changes */
  onSortingChange?: (sorting: SortState<string>) => void;

  // === Panel selection props ===
  /**
   * Single-click callback: selects the dataset to show in the slideout panel.
   * When provided, single-click selects; double-click navigates to detail page.
   * When omitted, single-click navigates.
   */
  onRowSelect?: (dataset: Dataset) => void;
  /** ID of the currently selected dataset (for row highlight) */
  selectedDatasetId?: string;
  /** Double-click callback: navigate to the dataset detail page */
  onRowDoubleClick?: (dataset: Dataset) => void;

  // === Infinite scroll props ===
  /** Whether more data is available to load */
  hasNextPage?: boolean;
  /** Function to load next page (called when scrolling near end) */
  onLoadMore?: () => void;
  /** Whether currently loading more data */
  isFetchingNextPage?: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

/** Stable row ID extractor */
const getRowId = (dataset: Dataset) => `${dataset.bucket}-${dataset.name}`;

/**
 * Debounce delay (ms) between a single-click selection and its effect.
 *
 * Must exceed the OS double-click threshold so that the second click of a
 * double-click sequence always fires before the timer resolves. The OS default
 * is typically 200–500ms (Windows/macOS both default to ~250–500ms). We use
 * 250ms as a safe minimum that is still imperceptible for deliberate clicks.
 */
const CLICK_DEBOUNCE_MS = 250;

// =============================================================================
// Component
// =============================================================================

export const DatasetsDataTable = memo(function DatasetsDataTable({
  datasets,
  totalCount,
  isLoading = false,
  error,
  onRetry,
  sorting,
  onSortingChange,
  onRowSelect,
  selectedDatasetId,
  onRowDoubleClick,
  hasNextPage = false,
  onLoadMore,
  isFetchingNextPage = false,
}: DatasetsDataTableProps) {
  const router = useNavigationRouter();
  const pathname = usePathname();
  const { startTransition } = useViewTransition();
  const { setOrigin } = useBreadcrumbOrigin();

  // Shared preferences (hydration-safe)
  const compactMode = useCompactMode();

  // Table store state
  const storeVisibleColumnIds = asDatasetColumnIds(useDatasetsTableStore((s) => s.visibleColumnIds));
  const columnOrder = asDatasetColumnIds(useDatasetsTableStore((s) => s.columnOrder));
  const setColumnOrder = useDatasetsTableStore((s) => s.setColumnOrder);
  const columnSizingPreferences = useDatasetsTableStore((s) => s.columnSizingPreferences);
  const setColumnSizingPreference = useDatasetsTableStore((s) => s.setColumnSizingPreference);

  const rowHeight = compactMode ? TABLE_ROW_HEIGHTS.COMPACT : TABLE_ROW_HEIGHTS.NORMAL;

  const columnVisibility = useColumnVisibility(columnOrder, storeVisibleColumnIds);

  // Create TanStack columns
  const columns = useMemo(() => createDatasetColumns(), []);

  // Fixed columns (not draggable)
  const fixedColumns = useMemo(() => Array.from(MANDATORY_COLUMN_IDS), []);

  // Handle column order change
  const handleColumnOrderChange = useCallback(
    (newOrder: string[]) => {
      setColumnOrder(newOrder);
    },
    [setColumnOrder],
  );

  // Handle column sizing preference change
  const handleColumnSizingPreferenceChange = useCallback(
    (columnId: string, preference: ColumnSizingPreference) => {
      setColumnSizingPreference(columnId, preference);
    },
    [setColumnSizingPreference],
  );

  const navigateToDataset = useCallback(
    (dataset: Dataset) => {
      const detailPath = `/datasets/${encodeURIComponent(dataset.bucket)}/${encodeURIComponent(dataset.name)}`;
      const currentUrl = pathname + window.location.search;
      setOrigin(detailPath, currentUrl);
      startTransition(() => {
        router.push(detailPath);
      });
    },
    [router, pathname, startTransition, setOrigin],
  );

  /**
   * Debounce timer for single-click selection.
   *
   * When a panel is open, single-click selects a dataset (opens slideout) and
   * double-click navigates to the detail page. Without debouncing, the first
   * click of a double-click sequence fires onRowSelect -> startViewTransition ->
   * setSelectedView (nuqs URL push) before the dblclick event fires. That URL
   * change then races with router.push from the double-click handler, causing
   * the navigation to inherit stale search params or be cancelled entirely.
   *
   * Fix: delay onRowSelect by CLICK_DEBOUNCE_MS. If dblclick fires within
   * that window, clearTimeout cancels the pending select so no URL state
   * change occurs before router.push runs.
   *
   * 250ms is chosen to be:
   *   - Above the OS double-click threshold (typically 200–500ms, default ~250ms)
   *   - Below the point where a deliberate single-click feels sluggish
   *
   * We use useRef (not useState) so the timer ID never triggers a re-render.
   */
  const singleClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Single-click: select for panel (if onRowSelect provided) or navigate directly
  const handleRowClick = useCallback(
    (dataset: Dataset) => {
      if (onRowSelect) {
        // Cancel any prior pending timer (rapid single-clicks on different rows).
        if (singleClickTimerRef.current !== null) clearTimeout(singleClickTimerRef.current);
        singleClickTimerRef.current = setTimeout(() => {
          singleClickTimerRef.current = null;
          onRowSelect(dataset);
        }, CLICK_DEBOUNCE_MS);
      } else {
        navigateToDataset(dataset);
      }
    },
    [onRowSelect, navigateToDataset],
  );

  // Double-click: cancel pending single-click selection and navigate instead
  const handleRowDoubleClick = useCallback(
    (dataset: Dataset) => {
      // Cancel the single-click timer so setSelectedView never fires.
      // This prevents the panel URL state from being pushed before router.push,
      // which would cause the two URL changes to race.
      if (singleClickTimerRef.current !== null) clearTimeout(singleClickTimerRef.current);
      singleClickTimerRef.current = null;

      if (onRowDoubleClick) {
        onRowDoubleClick(dataset);
      } else {
        navigateToDataset(dataset);
      }
    },
    [onRowDoubleClick, navigateToDataset],
  );

  // Get row href for middle-click support (opens in new tab)
  const getRowHref = useCallback((dataset: Dataset) => {
    return `/datasets/${encodeURIComponent(dataset.bucket)}/${encodeURIComponent(dataset.name)}`;
  }, []);

  // Augment datasets with visual row index for zebra striping
  const datasetsWithIndex = useMemo(
    () => datasets.map((dataset, index) => ({ ...dataset, _visualRowIndex: index })),
    [datasets],
  );

  // Row class for zebra striping
  const rowClassName = useCallback((dataset: Dataset & { _visualRowIndex?: number }) => {
    const visualIndex = dataset._visualRowIndex ?? 0;
    return visualIndex % 2 === 0 ? "bg-white dark:bg-zinc-950" : "bg-gray-100/60 dark:bg-zinc-900/50";
  }, []);

  const emptyContent = useMemo(() => <TableEmptyState message="No datasets found" />, []);

  // Loading state (using consolidated component)
  if (isLoading && datasets.length === 0) {
    return <TableLoadingSkeleton rowHeight={rowHeight} />;
  }

  // Error state (using consolidated component)
  if (error) {
    return (
      <TableErrorState
        error={error}
        title="Unable to load datasets"
        onRetry={onRetry}
      />
    );
  }

  return (
    <div className="table-container relative flex h-full flex-col">
      <DataTable<Dataset & { _visualRowIndex?: number }>
        data={datasetsWithIndex}
        columns={columns}
        getRowId={getRowId}
        // Column management
        columnOrder={columnOrder}
        onColumnOrderChange={handleColumnOrderChange}
        columnVisibility={columnVisibility}
        fixedColumns={fixedColumns}
        // Sorting
        sorting={sorting}
        onSortingChange={onSortingChange}
        // Column sizing
        columnSizeConfigs={DATASET_COLUMN_SIZE_CONFIG}
        columnSizingPreferences={columnSizingPreferences}
        onColumnSizingPreferenceChange={handleColumnSizingPreferenceChange}
        // Pagination
        hasNextPage={hasNextPage}
        onLoadMore={onLoadMore}
        isFetchingNextPage={isFetchingNextPage}
        totalCount={totalCount}
        // Layout
        rowHeight={rowHeight}
        compact={compactMode}
        className="text-sm"
        scrollClassName="datasets-scroll-container scrollbar-styled flex-1"
        // State
        isLoading={isLoading}
        emptyContent={emptyContent}
        // Interaction
        onRowClick={handleRowClick}
        onRowDoubleClick={onRowSelect ? handleRowDoubleClick : undefined}
        getRowHref={getRowHref}
        selectedRowId={selectedDatasetId}
        rowClassName={rowClassName}
      />
    </div>
  );
});
