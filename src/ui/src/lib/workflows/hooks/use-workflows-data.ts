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

import { useMemo } from "react";
import type { SearchChip } from "@/stores/types";
import type { PaginationParams, PaginatedResponse } from "@/lib/api/pagination/types";
import { usePaginatedData } from "@/lib/api/pagination/use-paginated-data";
import type { WorkflowListEntry } from "@/lib/api/adapter/types";
import {
  fetchPaginatedWorkflows,
  buildWorkflowsQueryKey,
  hasActiveFilters as hasActiveWorkflowFilters,
  type WorkflowFilterParams,
} from "@/lib/api/adapter/workflows-shim";
import { QUERY_STALE_TIME } from "@/lib/config";

interface UseWorkflowsDataParams {
  searchChips: SearchChip[];
  showAllUsers?: boolean;
  sortDirection?: "ASC" | "DESC";
  pageSize?: number;
  refetchInterval?: number;
  /** ISO date string — only return workflows submitted after this time */
  submittedAfter?: string;
}

interface UseWorkflowsDataReturn {
  workflows: WorkflowListEntry[];
  allWorkflows: WorkflowListEntry[];
  hasActiveFilters: boolean;
  total: number;
  filteredTotal: number;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  hasMore: boolean;
  fetchNextPage: () => void;
  isFetchingNextPage: boolean;
}

export function useWorkflowsData({
  searchChips,
  showAllUsers: showAllUsersProp = false,
  sortDirection = "DESC",
  pageSize = 50,
  refetchInterval = 0,
  submittedAfter,
}: UseWorkflowsDataParams): UseWorkflowsDataReturn {
  const hasUserChips = useMemo(() => searchChips.some((chip) => chip.field === "user"), [searchChips]);
  const showAllUsers = hasUserChips ? false : showAllUsersProp;

  const queryKey = useMemo(
    () => buildWorkflowsQueryKey(searchChips, showAllUsers, sortDirection, submittedAfter),
    [searchChips, showAllUsers, sortDirection, submittedAfter],
  );

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
    params: { searchChips, showAllUsers, sortDirection, submittedAfter },
    config: {
      pageSize,
      staleTime: QUERY_STALE_TIME.REALTIME,
      refetchInterval,
      refetchIntervalInBackground: false,
    },
  });

  return {
    workflows,
    allWorkflows: workflows,
    hasActiveFilters: hasActiveWorkflowFilters(searchChips),
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
