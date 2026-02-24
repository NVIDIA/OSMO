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
 * Data hook for pools page with FilterBar chip filtering.
 *
 * Architecture:
 * - Converts FilterBar chips to filter params
 * - Calls adapter (which handles client/server filtering transparently)
 * - Returns clean data for UI
 *
 * SHIM NOTE:
 * Currently filtering happens client-side in the adapter (pools-shim.ts).
 * When backend supports filtering, the adapter will pass filters to the API
 * and this hook remains unchanged.
 *
 * See: BACKEND_TODOS.md#12
 */

"use client";

import { useMemo } from "react";
import { useFilteredPools, type PoolFilterParams, type PoolMetadata } from "@/lib/api/adapter/hooks";
import type { Pool } from "@/lib/api/adapter/types";
import type { SearchChip } from "@/stores/types";
import { chipsToParams, filterChipsByFields, type ChipMappingConfig } from "@/lib/api/chip-filter-utils";
import { filterByChips } from "@/components/filter-bar/lib/filter";
import { createPoolSearchFields } from "@/features/pools/lib/pool-search-fields";

// =============================================================================
// Types
// =============================================================================

interface UsePoolsDataParams {
  searchChips: SearchChip[];
  /** Pool names the current user has access to (from profile settings) */
  accessiblePoolNames?: string[];
  /** Auto-refresh interval in milliseconds (0 = disabled) */
  refetchInterval?: number;
}

interface UsePoolsDataReturn {
  /** Filtered pools (after applying search chips) */
  pools: Pool[];
  /** All pools (unfiltered, for suggestions) */
  allPools: Pool[];
  /** Sharing groups for panel and shared: filter */
  sharingGroups: string[][];
  /** Metadata for filter options (status counts, platforms, backends) */
  metadata: PoolMetadata | null;
  /** Whether any filters are active */
  hasActiveFilters: boolean;
  /** Total pools before filtering */
  total: number;
  /** Total pools after filtering */
  filteredTotal: number;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Refetch function */
  refetch: () => void;
}

// =============================================================================
// Chip to Filter Mapping
// =============================================================================

/** Fields handled by the shim (converted to PoolFilterParams) */
const SHIM_HANDLED_FIELDS = new Set(["status", "platform", "backend", "shared", "text", "pool"]);

/**
 * Mapping of FilterBar chip fields to pool filter params.
 *
 * This mapping stays the same whether filtering is client or server side.
 * The adapter handles where the filtering actually happens.
 */
const POOL_CHIP_MAPPING: ChipMappingConfig<PoolFilterParams> = {
  status: { type: "array", paramKey: "statuses" },
  platform: { type: "array", paramKey: "platforms" },
  backend: { type: "array", paramKey: "backends" },
  shared: { type: "single", paramKey: "sharedWith" },
  text: { type: "single", paramKey: "search" },
  pool: { type: "array", paramKey: "pools" },
};

// =============================================================================
// Hook
// =============================================================================

export function usePoolsData({
  searchChips,
  accessiblePoolNames,
  refetchInterval = 0,
}: UsePoolsDataParams): UsePoolsDataReturn {
  // Extract scope chip to determine whether to filter to accessible pools
  const scopeValue = useMemo(() => searchChips.find((c) => c.field === "scope")?.value ?? null, [searchChips]);
  const showOnlyMyPools = scopeValue === "user";

  // Filter out scope chip before passing to adapter (adapter doesn't know about scope)
  const adapterChips = useMemo(() => searchChips.filter((c) => c.field !== "scope"), [searchChips]);

  // Convert shim-handled chips to filter params
  const filterParams = useMemo(
    () => chipsToParams(adapterChips, POOL_CHIP_MAPPING) as PoolFilterParams,
    [adapterChips],
  );

  // Get chips the shim doesn't handle (description, numeric quota/capacity filters)
  const clientOnlyChips = useMemo(
    () => filterChipsByFields(adapterChips, SHIM_HANDLED_FIELDS, true),
    [adapterChips],
  );

  // Use adapter hook (handles client/server filtering transparently)
  const {
    pools: shimFilteredPools,
    allPools,
    sharingGroups,
    metadata,
    hasActiveFilters: hasActiveChipFilters,
    total: chipTotal,
    filteredTotal: _chipFilteredTotal,
    isLoading,
    error,
    refetch,
  } = useFilteredPools(filterParams, refetchInterval);

  // Build search fields for client-only filtering (description, quota, capacity)
  const searchFields = useMemo(() => createPoolSearchFields(sharingGroups), [sharingGroups]);

  // Apply client-only chips via match functions in search field definitions
  const chipFilteredPools = useMemo(() => {
    if (clientOnlyChips.length === 0) return shimFilteredPools;
    return filterByChips(shimFilteredPools, clientOnlyChips, searchFields);
  }, [shimFilteredPools, clientOnlyChips, searchFields]);

  // When showAllPools is false, further filter to only accessible pools
  const accessibleSet = useMemo(
    () => (accessiblePoolNames ? new Set(accessiblePoolNames) : null),
    [accessiblePoolNames],
  );

  const pools = useMemo(() => {
    if (!showOnlyMyPools || !accessibleSet) return chipFilteredPools;
    return chipFilteredPools.filter((p) => accessibleSet.has(p.name));
  }, [chipFilteredPools, showOnlyMyPools, accessibleSet]);

  const total = useMemo(() => {
    if (!showOnlyMyPools || !accessibleSet) return chipTotal;
    return allPools.filter((p) => accessibleSet.has(p.name)).length;
  }, [showOnlyMyPools, accessibleSet, chipTotal, allPools]);

  const filteredTotal = pools.length;
  // Chip filters (shim + client-only) count as "active filters" for the "X of Y" display.
  // The my/all pools toggle changes scope silently (consistent with workflows/datasets).
  const hasActiveFilters = hasActiveChipFilters || clientOnlyChips.length > 0;

  return {
    pools,
    allPools,
    sharingGroups,
    metadata,
    hasActiveFilters,
    total,
    filteredTotal,
    isLoading,
    error: error as Error | null,
    refetch,
  };
}
