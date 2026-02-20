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

import { useMemo, useCallback, useRef, useEffect, memo } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useViewTransition } from "@/hooks/use-view-transition";
import { DataTable } from "@/components/data-table/DataTable";
import { TableEmptyState } from "@/components/data-table/TableEmptyState";
import { TableLoadingSkeleton, TableErrorState } from "@/components/data-table/TableStates";
import { useColumnVisibility } from "@/components/data-table/hooks/use-column-visibility";
import type { ColumnSizingPreference, SortState } from "@/components/data-table/types";
import { useCompactMode } from "@/stores/shared-preferences-store";
import { TABLE_ROW_HEIGHTS } from "@/lib/config";
import type { Dataset } from "@/lib/api/adapter/datasets";
import {
  MANDATORY_COLUMN_IDS,
  asDatasetColumnIds,
  DATASET_COLUMN_SIZE_CONFIG,
} from "@/app/(dashboard)/datasets/lib/dataset-columns";
import { createDatasetColumns } from "@/app/(dashboard)/datasets/components/table/dataset-column-defs";
import { useDatasetsTableStore } from "@/app/(dashboard)/datasets/stores/datasets-table-store";
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
  hasNextPage = false,
  onLoadMore,
  isFetchingNextPage = false,
}: DatasetsDataTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { startTransition } = useViewTransition();
  const { setOrigin } = useBreadcrumbOrigin();

  // Track current URL in a ref for use in navigation callbacks.
  // pathname and searchParams change identity on every URL update, but we only
  // need them at click-time (for breadcrumb origin), not for rendering.
  // Using a ref avoids recreating handleRowClick on every URL change.
  // Updated via useEffect (not during render) per React Compiler rules.
  const currentUrlRef = useRef("");
  useEffect(() => {
    const search = searchParams.toString();
    currentUrlRef.current = search ? `${pathname}?${search}` : pathname;
  }, [pathname, searchParams]);

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

  const handleRowClick = useCallback(
    (dataset: Dataset) => {
      // Use clean URL format: /datasets/bucket/name
      const detailPath = `/datasets/${encodeURIComponent(dataset.bucket)}/${encodeURIComponent(dataset.name)}`;

      setOrigin(detailPath, currentUrlRef.current);
      startTransition(() => {
        router.push(detailPath);
      });
    },
    [router, startTransition, setOrigin],
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
        getRowHref={getRowHref}
        rowClassName={rowClassName}
      />
    </div>
  );
});
