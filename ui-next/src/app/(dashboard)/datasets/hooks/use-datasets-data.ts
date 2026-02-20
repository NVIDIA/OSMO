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
 * Data hook for datasets page.
 *
 * Architecture:
 * - useAllDatasets fetches all datasets at once (count: 10_000)
 *   Server-side filters: name, bucket, user, all_users
 * - applyDatasetsFiltersSync applies client-side filters from cache
 *   Client-side filters: created_at, updated_at date ranges
 * - Returns all filtered datasets; DataTable uses virtual scrolling for display
 */

"use client";

import { useMemo } from "react";
import type { SearchChip } from "@/stores/types";
import type { Dataset } from "@/lib/api/adapter/datasets";
import { useAllDatasets } from "@/lib/api/adapter/datasets-hooks";
import { applyDatasetsFiltersSync, hasActiveDatasetFilters } from "@/lib/api/adapter/datasets-shim";

// =============================================================================
// Types
// =============================================================================

interface UseDatasetsDataParams {
  /** Search chips from FilterBar */
  searchChips: SearchChip[];
  /** Show all users' datasets (default: false = current user only) */
  showAllUsers?: boolean;
  /** Sort state for client-side sorting via shim */
  sort?: { column: string; direction: "asc" | "desc" } | null;
}

interface UseDatasetsDataReturn {
  /** Filtered datasets for display */
  datasets: Dataset[];
  /** All loaded datasets (for FilterBar suggestions) */
  allDatasets: Dataset[];
  /** Whether any filters are active */
  hasActiveFilters: boolean;
  /** Total datasets before client-side filtering */
  total: number;
  /** Total datasets after client-side filtering */
  filteredTotal: number;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Refetch function */
  refetch: () => void;
}

// =============================================================================
// Hook
// =============================================================================

export function useDatasetsData({
  searchChips,
  showAllUsers = false,
  sort = null,
}: UseDatasetsDataParams): UseDatasetsDataReturn {
  // Fetch all datasets (server-side filters: name, bucket, user, all_users)
  // Query key only includes server-side params so client-side filter changes
  // (created_at, updated_at) don't trigger new API calls — shim handles them.
  const { data: allDatasets = [], isLoading, error, refetch } = useAllDatasets(showAllUsers, searchChips);

  // Apply client-side filters (date ranges) and sort from cache — no new API call
  // searchChips and sort passed directly to avoid new-object-every-render bug
  const { datasets, total, filteredTotal } = useMemo(
    () => applyDatasetsFiltersSync(allDatasets, searchChips, sort),
    [allDatasets, searchChips, sort],
  );

  return {
    datasets,
    allDatasets,
    hasActiveFilters: hasActiveDatasetFilters(searchChips),
    total,
    filteredTotal,
    isLoading,
    error: error instanceof Error ? error : null,
    refetch,
  };
}
