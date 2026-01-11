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
 * Workflows Data Table
 *
 * Workflow-specific wrapper around DataTable that handles:
 * - Flat table with full sorting flexibility
 * - Workflow-specific row styling (status borders)
 * - Infinite scroll pagination
 * - Navigation to workflow detail page on click
 *
 * Built on the canonical DataTable component.
 */

"use client";

import { useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { DataTable, type SortState, type ColumnSizingPreference } from "@/components/data-table";
import { useSharedPreferences } from "@/stores";
import { cn } from "@/lib/utils";
import { TABLE_ROW_HEIGHTS } from "@/lib/config";
import type { WorkflowListEntry } from "../../lib/workflow-search-fields";
import { MANDATORY_COLUMN_IDS, asWorkflowColumnIds, WORKFLOW_COLUMN_SIZE_CONFIG } from "../../lib/workflow-columns";
import { getStatusDisplay } from "../../lib/workflow-constants";
import { createWorkflowColumns } from "./workflow-column-defs";
import { useWorkflowsTableStore } from "../../stores/workflows-table-store";

// =============================================================================
// Types
// =============================================================================

export interface WorkflowsDataTableProps {
  /** Workflow data */
  workflows: WorkflowListEntry[];
  /** Total count before filters */
  totalCount?: number;
  /** Loading state */
  isLoading?: boolean;
  /** Error state */
  error?: Error;
  /** Retry callback */
  onRetry?: () => void;

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
const getRowId = (workflow: WorkflowListEntry) => workflow.name;

// =============================================================================
// Component
// =============================================================================

export function WorkflowsDataTable({
  workflows,
  totalCount,
  isLoading = false,
  error,
  onRetry,
  hasNextPage = false,
  onLoadMore,
  isFetchingNextPage = false,
}: WorkflowsDataTableProps) {
  const router = useRouter();

  // Shared preferences
  const compactMode = useSharedPreferences((s) => s.compactMode);

  // Table store state
  const storeVisibleColumnIds = asWorkflowColumnIds(useWorkflowsTableStore((s) => s.visibleColumnIds));
  const columnOrder = asWorkflowColumnIds(useWorkflowsTableStore((s) => s.columnOrder));
  const setColumnOrder = useWorkflowsTableStore((s) => s.setColumnOrder);
  const sortState = useWorkflowsTableStore((s) => s.sort);
  const setSort = useWorkflowsTableStore((s) => s.setSort);
  const columnSizingPreferences = useWorkflowsTableStore((s) => s.columnSizingPreferences);
  const setColumnSizingPreference = useWorkflowsTableStore((s) => s.setColumnSizingPreference);

  const rowHeight = compactMode ? TABLE_ROW_HEIGHTS.COMPACT : TABLE_ROW_HEIGHTS.NORMAL;

  // NOTE: Sorting is done server-side now (only submit_time is sortable)
  // The workflows prop is already sorted by the backend based on the sort direction in the query

  // Create column visibility map
  const columnVisibility = useMemo(() => {
    const visibility: Record<string, boolean> = {};
    columnOrder.forEach((id) => {
      visibility[id] = false;
    });
    storeVisibleColumnIds.forEach((id) => {
      visibility[id] = true;
    });
    return visibility;
  }, [columnOrder, storeVisibleColumnIds]);

  // Create TanStack columns
  const columns = useMemo(() => createWorkflowColumns(), []);

  // Fixed columns (not draggable)
  const fixedColumns = useMemo(() => Array.from(MANDATORY_COLUMN_IDS), []);

  // Handle sort change
  const handleSortChange = useCallback(
    (newSort: SortState<string>) => {
      if (newSort.column) {
        setSort(newSort.column);
      }
    },
    [setSort],
  );

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

  // Handle row click - navigate to workflow detail page
  const handleRowClick = useCallback(
    (workflow: WorkflowListEntry) => {
      router.push(`/workflows/${encodeURIComponent(workflow.name)}`);
    },
    [router],
  );

  // Row class for status styling
  const rowClassName = useCallback((workflow: WorkflowListEntry) => {
    const { category } = getStatusDisplay(workflow.status);
    return cn("workflows-row", `workflows-row--${category}`);
  }, []);

  // Empty state
  const emptyContent = useMemo(
    () => <div className="text-sm text-zinc-500 dark:text-zinc-400">No workflows found</div>,
    [],
  );

  // Loading state
  if (isLoading && workflows.length === 0) {
    return (
      <div className="table-container flex h-full flex-col">
        <div className="flex flex-1 flex-col gap-2 p-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-12 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800"
            />
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="table-container flex h-full flex-col">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="text-sm text-red-600 dark:text-red-400">Unable to load workflows</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">{error.message}</div>
          {onRetry && (
            <button
              onClick={onRetry}
              className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="table-container relative flex h-full flex-col">
      <DataTable<WorkflowListEntry>
        data={workflows}
        columns={columns}
        getRowId={getRowId}
        // Column management
        columnOrder={columnOrder}
        onColumnOrderChange={handleColumnOrderChange}
        columnVisibility={columnVisibility}
        fixedColumns={fixedColumns}
        // Column sizing
        columnSizeConfigs={WORKFLOW_COLUMN_SIZE_CONFIG}
        columnSizingPreferences={columnSizingPreferences}
        onColumnSizingPreferenceChange={handleColumnSizingPreferenceChange}
        // Sorting
        sorting={sortState ?? undefined}
        onSortingChange={handleSortChange}
        // Pagination
        hasNextPage={hasNextPage}
        onLoadMore={onLoadMore}
        isFetchingNextPage={isFetchingNextPage}
        totalCount={totalCount}
        // Layout
        rowHeight={rowHeight}
        compact={compactMode}
        className="text-sm"
        scrollClassName="workflows-scroll-container scrollbar-styled flex-1"
        // State
        isLoading={isLoading}
        emptyContent={emptyContent}
        // Interaction
        onRowClick={handleRowClick}
        rowClassName={rowClassName}
      />
    </div>
  );
}
