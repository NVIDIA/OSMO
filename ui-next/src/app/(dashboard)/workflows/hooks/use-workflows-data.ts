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
 * Data hook for workflows page with server-side filtering and infinite scroll.
 *
 * Architecture:
 * - Uses usePaginatedData for offset-based pagination with infinite scroll
 * - Passes SmartSearch chips directly to backend API for server-side filtering
 * - Returns paginated data for UI
 *
 * Server-side filtering:
 * - All filters (status, user, pool, etc.) are passed to the backend
 * - Backend handles filtering and pagination
 * - No client-side filtering needed
 */

"use client";

import { useMemo } from "react";
import type { SearchChip } from "@/stores";
import { usePaginatedData, type PaginationParams, type PaginatedResponse } from "@/lib/api/pagination";
import type { WorkflowListEntry } from "../lib/workflow-search-fields";
import {
  fetchPaginatedWorkflows,
  buildWorkflowsQueryKey,
  hasActiveFilters,
  type WorkflowFilterParams,
} from "../lib/workflows-shim";

// =============================================================================
// Types
// =============================================================================

interface UseWorkflowsDataParams {
  /** Search chips from SmartSearch */
  searchChips: SearchChip[];
  /** Show all users' workflows (default: false = current user only) */
  showAllUsers?: boolean;
  /** Sort direction (default: DESC = most recent first) */
  sortDirection?: "ASC" | "DESC";
  /** Number of workflows per page (default: 50) */
  pageSize?: number;
}

interface UseWorkflowsDataReturn {
  /** Workflows from the current query */
  workflows: WorkflowListEntry[];
  /** All loaded workflows (for suggestions in SmartSearch) */
  allWorkflows: WorkflowListEntry[];
  /** Whether any filters are active */
  hasActiveFilters: boolean;
  /** Total workflows before filtering (if available from server) */
  total: number;
  /** Total workflows after filtering */
  filteredTotal: number;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Refetch function */
  refetch: () => void;
  /** Whether there are more workflows available */
  hasMore: boolean;
  /** Function to load next page */
  fetchNextPage: () => void;
  /** Whether currently loading more data */
  isFetchingNextPage: boolean;
}

// =============================================================================
// Hook
// =============================================================================

export function useWorkflowsData({
  searchChips,
  showAllUsers = false,
  sortDirection = "DESC",
  pageSize = 50,
}: UseWorkflowsDataParams): UseWorkflowsDataReturn {
  // Build stable query key - changes when filters/options change, which resets pagination
  const queryKey = useMemo(
    () => buildWorkflowsQueryKey(searchChips, showAllUsers, sortDirection),
    [searchChips, showAllUsers, sortDirection],
  );

  // Use paginated data hook for infinite scroll
  const {
    items: workflows,
    filteredCount,
    totalCount,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    isLoading,
    error,
    refetch,
  } = usePaginatedData<WorkflowListEntry, WorkflowFilterParams>({
    queryKey,
    queryFn: async (params: PaginationParams & WorkflowFilterParams): Promise<PaginatedResponse<WorkflowListEntry>> => {
      return fetchPaginatedWorkflows(params);
    },
    params: { searchChips, showAllUsers, sortDirection },
    config: {
      pageSize,
      staleTime: 60_000, // 1 minute
    },
  });

  return {
    workflows,
    // For SmartSearch suggestions, we use the currently loaded workflows
    // This provides a reasonable suggestion pool without fetching all data
    allWorkflows: workflows,
    hasActiveFilters: hasActiveFilters(searchChips),
    total: totalCount ?? workflows.length,
    filteredTotal: filteredCount ?? workflows.length,
    isLoading,
    error,
    refetch,
    hasMore: hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  };
}
