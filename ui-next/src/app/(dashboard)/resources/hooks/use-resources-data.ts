/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Data hook for resources page with SmartSearch chip filtering.
 *
 * Architecture:
 * - Converts SmartSearch chips to filter params
 * - Calls adapter (which handles client/server filtering transparently)
 * - Returns clean data for UI
 *
 * SHIM NOTE:
 * Currently filtering happens client-side in the adapter (resources-shim.ts).
 * When backend supports filtering, the adapter will pass filters to the API
 * and this hook remains unchanged.
 *
 * See: BACKEND_TODOS.md#11
 */

"use client";

import { useMemo } from "react";
import {
  fetchResources,
  type Resource,
  type PaginatedResourcesResult,
  type ResourceFilterParams,
} from "@/lib/api/adapter";
import { usePaginatedData } from "@/lib/api/pagination";
import type { SearchChip } from "@/stores";
import { filterByChips } from "@/components/smart-search";
import { RESOURCE_SEARCH_FIELDS } from "../lib/resource-search-fields";

// =============================================================================
// Types
// =============================================================================

interface UseResourcesDataParams {
  searchChips: SearchChip[];
}

interface UseResourcesDataReturn {
  /** Filtered resources (after applying search chips) */
  resources: Resource[];
  /** All resources (unfiltered, for suggestions) */
  allResources: Resource[];
  filteredCount?: number;
  totalCount?: number;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  isFetchingNextPage: boolean;
}

// =============================================================================
// Chip to Filter Conversion
// =============================================================================

/** Fields handled by the shim (these get converted to params) */
const SHIM_HANDLED_FIELDS = new Set(["pool", "platform", "type", "backend", "name", "hostname"]);

/**
 * Convert SmartSearch chips to resource filter params.
 *
 * This mapping stays the same whether filtering is client or server side.
 * The adapter handles where the filtering actually happens.
 */
function chipsToFilterParams(chips: SearchChip[]): ResourceFilterParams {
  const params: ResourceFilterParams = {};

  for (const chip of chips) {
    switch (chip.field) {
      case "pool":
        params.pools = [...(params.pools ?? []), chip.value];
        break;
      case "platform":
        params.platforms = [...(params.platforms ?? []), chip.value];
        break;
      case "type":
        params.resourceTypes = [...(params.resourceTypes ?? []), chip.value];
        break;
      case "backend":
        params.backends = [...(params.backends ?? []), chip.value];
        break;
      case "name":
        // Name maps to search (substring match in shim)
        params.search = chip.value;
        break;
      case "hostname":
        params.hostname = chip.value;
        break;
    }
  }

  return params;
}

/**
 * Get chips that need client-side filtering (not handled by shim).
 * These are numeric filters that require % calculations.
 */
function getClientOnlyChips(chips: SearchChip[]): SearchChip[] {
  return chips.filter((chip) => !SHIM_HANDLED_FIELDS.has(chip.field));
}

// =============================================================================
// Hook
// =============================================================================

export function useResourcesData({ searchChips }: UseResourcesDataParams): UseResourcesDataReturn {
  // Convert chips to filter params for the shim
  const filterParams = useMemo(() => chipsToFilterParams(searchChips), [searchChips]);

  // Get chips that shim doesn't handle (numeric filters with % calculations)
  const clientOnlyChips = useMemo(() => getClientOnlyChips(searchChips), [searchChips]);

  // Build query key from filter params (stable key for cache)
  const queryKey = useMemo(
    () => [
      "resources",
      "filtered",
      {
        pools: filterParams.pools?.sort().join(",") ?? "",
        platforms: filterParams.platforms?.sort().join(",") ?? "",
        resourceTypes: filterParams.resourceTypes?.sort().join(",") ?? "",
        backends: filterParams.backends?.sort().join(",") ?? "",
        search: filterParams.search ?? "",
        hostname: filterParams.hostname ?? "",
        // Include client-only chips in key for proper cache invalidation
        clientFilters: clientOnlyChips
          .map((c) => `${c.field}:${c.value}`)
          .sort()
          .join(","),
      },
    ],
    [filterParams, clientOnlyChips],
  );

  // Use data table hook for pagination
  const {
    items: allResources,
    filteredCount: rawFilteredCount,
    totalCount,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    isLoading,
    error,
    refetch,
  } = usePaginatedData<Resource, ResourceFilterParams>({
    queryKey,
    queryFn: async (params): Promise<PaginatedResourcesResult> => {
      // Pass filter params to adapter - shim handles filtering
      return fetchResources(params);
    },
    params: filterParams,
    config: {
      pageSize: 50,
      staleTime: 60_000,
    },
  });

  // Apply client-only chips (numeric filters with % calculations)
  // These can't be handled by the shim because they need complex math
  const filteredResources = useMemo(() => {
    if (clientOnlyChips.length === 0) return allResources;
    return filterByChips(allResources, clientOnlyChips, RESOURCE_SEARCH_FIELDS);
  }, [allResources, clientOnlyChips]);

  return {
    resources: filteredResources,
    allResources,
    filteredCount: clientOnlyChips.length > 0 ? filteredResources.length : rawFilteredCount,
    totalCount,
    isLoading,
    error,
    refetch,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  };
}
