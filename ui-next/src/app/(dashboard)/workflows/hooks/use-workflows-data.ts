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
 * Data hook for workflows page with SmartSearch chip filtering.
 *
 * Architecture:
 * - Fetches workflows from the API
 * - Converts SmartSearch chips to filter logic
 * - Returns filtered data for UI
 *
 * Currently implements client-side filtering.
 * When backend supports filtering, this can be updated to pass params to API.
 */

"use client";

import { useMemo, useCallback } from "react";
import {
  useListWorkflowApiWorkflowGet,
  type SrcServiceCoreWorkflowObjectsListEntry,
  type ListWorkflowApiWorkflowGetParams,
} from "@/lib/api/generated";
import type { SearchChip } from "@/stores";
import { filterByChips } from "@/components/smart-search";
import { createWorkflowSearchFields, type WorkflowListEntry } from "../lib/workflow-search-fields";

// =============================================================================
// Types
// =============================================================================

interface UseWorkflowsDataParams {
  searchChips: SearchChip[];
  /** Number of workflows to fetch (default: 100) */
  limit?: number;
}

interface UseWorkflowsDataReturn {
  /** Filtered workflows (after applying search chips) */
  workflows: WorkflowListEntry[];
  /** All workflows (unfiltered, for suggestions) */
  allWorkflows: WorkflowListEntry[];
  /** Whether any filters are active */
  hasActiveFilters: boolean;
  /** Total workflows before filtering */
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
}

// =============================================================================
// Hook
// =============================================================================

export function useWorkflowsData({ searchChips, limit = 100 }: UseWorkflowsDataParams): UseWorkflowsDataReturn {
  // API params - fetch all user's workflows
  const params: ListWorkflowApiWorkflowGetParams = useMemo(
    () => ({
      limit,
      order: "DESC", // Most recent first
    }),
    [limit],
  );

  // Fetch workflows from API
  const { data: rawData, isLoading, error, refetch } = useListWorkflowApiWorkflowGet(params);

  // Parse the response (API returns JSON string)
  const parsedData = useMemo(() => {
    if (!rawData) return null;
    try {
      // The API returns a JSON string that we need to parse
      const parsed = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
      return parsed as { workflows: SrcServiceCoreWorkflowObjectsListEntry[]; more_entries: boolean };
    } catch {
      console.error("Failed to parse workflow response");
      return null;
    }
  }, [rawData]);

  // Get all workflows
  const allWorkflows = useMemo((): WorkflowListEntry[] => {
    return parsedData?.workflows ?? [];
  }, [parsedData]);

  // Create search fields for filtering
  const searchFields = useMemo(() => createWorkflowSearchFields(), []);

  // Filter workflows by chips (client-side)
  const workflows = useMemo((): WorkflowListEntry[] => {
    if (searchChips.length === 0) return allWorkflows;
    return filterByChips(allWorkflows, searchChips, searchFields);
  }, [allWorkflows, searchChips, searchFields]);

  // Stable refetch callback
  const handleRefetch = useCallback(() => {
    refetch();
  }, [refetch]);

  return {
    workflows,
    allWorkflows,
    hasActiveFilters: searchChips.length > 0,
    total: allWorkflows.length,
    filteredTotal: workflows.length,
    isLoading,
    error: error as Error | null,
    refetch: handleRefetch,
    hasMore: parsedData?.more_entries ?? false,
  };
}
