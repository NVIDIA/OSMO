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

import { useMemo, useCallback, useRef, useEffect, memo } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useViewTransition } from "@/hooks/use-view-transition";
import { DataTable } from "@/components/data-table/DataTable";
import { TableEmptyState } from "@/components/data-table/TableEmptyState";
import { TableLoadingSkeleton, TableErrorState } from "@/components/data-table/TableStates";
import { useColumnVisibility } from "@/components/data-table/hooks/use-column-visibility";
import type { SortState, ColumnSizingPreference } from "@/components/data-table/types";
import { useSharedPreferences } from "@/stores/shared-preferences-store";
import { cn } from "@/lib/utils";
import { TABLE_ROW_HEIGHTS } from "@/lib/config";
import type { WorkflowListEntry } from "@/app/(dashboard)/workflows/lib/workflow-search-fields";
import {
  MANDATORY_COLUMN_IDS,
  asWorkflowColumnIds,
  WORKFLOW_COLUMN_SIZE_CONFIG,
} from "@/app/(dashboard)/workflows/lib/workflow-columns";
import { getStatusDisplay } from "@/app/(dashboard)/workflows/lib/workflow-constants";
import { createWorkflowColumns } from "@/app/(dashboard)/workflows/components/table/workflow-column-defs";
import { useWorkflowsTableStore } from "@/app/(dashboard)/workflows/stores/workflows-table-store";
import { useBreadcrumbOrigin } from "@/components/chrome/breadcrumb-origin-context";

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

export const WorkflowsDataTable = memo(function WorkflowsDataTable({
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

  const columnVisibility = useColumnVisibility(columnOrder, storeVisibleColumnIds);

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

  const handleRowClick = useCallback(
    (workflow: WorkflowListEntry) => {
      const detailPath = `/workflows/${encodeURIComponent(workflow.name)}`;

      setOrigin(detailPath, currentUrlRef.current);
      startTransition(() => {
        router.push(detailPath);
      });
    },
    [router, startTransition, setOrigin],
  );

  // Get row href for middle-click support (opens in new tab)
  const getRowHref = useCallback(
    (workflow: WorkflowListEntry) => `/workflows/${encodeURIComponent(workflow.name)}`,
    [],
  );

  // Augment workflows with visual row index for zebra striping
  const workflowsWithIndex = useMemo(
    () => workflows.map((workflow, index) => ({ ...workflow, _visualRowIndex: index })),
    [workflows],
  );

  // Row class for status styling + zebra striping
  const rowClassName = useCallback((workflow: WorkflowListEntry & { _visualRowIndex?: number }) => {
    const { category } = getStatusDisplay(workflow.status);
    const visualIndex = workflow._visualRowIndex ?? 0;
    const zebraClass = visualIndex % 2 === 0 ? "bg-white dark:bg-zinc-950" : "bg-gray-100/60 dark:bg-zinc-900/50";
    return cn("workflows-row", `workflows-row--${category}`, zebraClass);
  }, []);

  const emptyContent = useMemo(() => <TableEmptyState message="No workflows found" />, []);

  // Loading state (using consolidated component)
  if (isLoading && workflows.length === 0) {
    return <TableLoadingSkeleton rowHeight={rowHeight} />;
  }

  // Error state (using consolidated component)
  if (error) {
    return (
      <TableErrorState
        error={error}
        title="Unable to load workflows"
        onRetry={onRetry}
      />
    );
  }

  return (
    <div className="table-container relative flex h-full flex-col">
      <DataTable<WorkflowListEntry & { _visualRowIndex?: number }>
        data={workflowsWithIndex}
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
        getRowHref={getRowHref}
        rowClassName={rowClassName}
      />
    </div>
  );
});
