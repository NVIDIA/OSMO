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

import { naturalCompare } from "@/lib/utils";

/**
 * Pools Filtering Shim - Client-side filtering for pools.
 *
 * =============================================================================
 * IDEAL BACKEND API (what we're coding toward):
 * =============================================================================
 *
 * GET /api/pools?status=online,maintenance&platform=dgx&search=ml-team
 *
 * Response:
 * {
 *   "pools": [...filtered pools...],
 *   "metadata": {
 *     "status_counts": { "online": 15, "maintenance": 3, "offline": 2 },
 *     "platforms": ["dgx", "base", "cpu"],
 *     "backends": ["slurm", "kubernetes"]
 *   },
 *   "sharing_groups": [["pool-a", "pool-b"], ...],
 *   "total": 20,
 *   "filtered_total": 18
 * }
 *
 * =============================================================================
 * CURRENT SHIM (what this file does):
 * =============================================================================
 *
 * 1. Fetches ALL pools from backend
 * 2. Applies filters client-side
 * 3. Returns filtered results with computed metadata
 *
 * WHEN BACKEND IS UPDATED:
 * 1. Delete this file entirely
 * 2. Update useFilteredPools in hooks.ts to include filters in query key
 *    and pass them to the API
 * 3. No changes needed in usePoolsData or UI components
 *
 * See: BACKEND_TODOS.md#12 for detailed backend requirements.
 */

import type { Pool } from "@/lib/api/adapter/types";
import { PoolStatus } from "@/lib/api/generated";

/**
 * Map status category names to raw PoolStatus values.
 * This bridges the gap between UI-friendly names and API values.
 */
const STATUS_CATEGORY_TO_RAW: Record<string, string> = {
  online: PoolStatus.ONLINE,
  maintenance: PoolStatus.MAINTENANCE,
  offline: PoolStatus.OFFLINE,
};

// =============================================================================
// Types
// =============================================================================

/**
 * Filter parameters for pools.
 * These map to FilterBar chip fields.
 */
export interface PoolFilterParams {
  /** Filter by status (online, maintenance, offline) */
  statuses?: string[];
  /** Filter by platform */
  platforms?: string[];
  /** Filter by backend */
  backends?: string[];
  /** Text search across pool name, description */
  search?: string;
  /** Filter by shared pool group (pools sharing capacity with this pool) */
  sharedWith?: string;
}

/**
 * Metadata computed from pools (will come from server when ready).
 */
export interface PoolMetadata {
  /** Count of pools per status */
  statusCounts: Record<string, number>;
  /** Available platforms for filtering */
  platforms: string[];
  /** Available backends for filtering */
  backends: string[];
}

/**
 * Result from applyPoolFiltersSync.
 */
export interface FilteredPoolsResult {
  /** Filtered pools */
  pools: Pool[];
  /** All pools (for suggestions) */
  allPools: Pool[];
  /** Sharing groups */
  sharingGroups: string[][];
  /** Metadata for filter options */
  metadata: PoolMetadata;
  /** Total before filtering */
  total: number;
  /** Total after filtering */
  filteredTotal: number;
}

// =============================================================================
// SHIM: Client-side filtering (to be removed when backend supports filtering)
// =============================================================================

/**
 * SHIM: Apply client-side filters to pools.
 *
 * This function handles all filtering that should ideally be done server-side.
 * When backend supports filtering, this function can be removed and filters
 * passed directly to the API.
 *
 * @internal
 */
function applyPoolFilters(pools: Pool[], params: PoolFilterParams, sharingGroups: string[][]): Pool[] {
  let result = pools;

  // SHIM: Filter by status (should be server-side)
  // Status filter accepts category names (online, maintenance, offline)
  // and maps them to raw PoolStatus values (ONLINE, MAINTENANCE, OFFLINE)
  if (params.statuses && params.statuses.length > 0) {
    const rawStatuses = params.statuses.map((s) => STATUS_CATEGORY_TO_RAW[s.toLowerCase()] ?? s);
    const statusSet = new Set(rawStatuses);
    result = result.filter((pool) => statusSet.has(pool.status));
  }

  // SHIM: Filter by platform (should be server-side)
  if (params.platforms && params.platforms.length > 0) {
    const platformSet = new Set(params.platforms);
    result = result.filter((pool) => pool.platforms.some((platform) => platformSet.has(platform)));
  }

  // SHIM: Filter by backend (should be server-side)
  if (params.backends && params.backends.length > 0) {
    const backendSet = new Set(params.backends);
    result = result.filter((pool) => backendSet.has(pool.backend));
  }

  // SHIM: Filter by shared pool group (should be server-side)
  if (params.sharedWith) {
    const sharedWithValue = params.sharedWith;
    const sharedGroup = sharingGroups.find((g) => g.includes(sharedWithValue));
    if (sharedGroup) {
      const sharedSet = new Set(sharedGroup);
      result = result.filter((pool) => sharedSet.has(pool.name));
    } else {
      result = []; // No matching group
    }
  }

  // SHIM: Filter by search (should be server-side)
  if (params.search && params.search.trim()) {
    const searchLower = params.search.toLowerCase();
    result = result.filter(
      (pool) =>
        pool.name.toLowerCase().includes(searchLower) ||
        (pool.description?.toLowerCase().includes(searchLower) ?? false),
    );
  }

  return result;
}

/**
 * SHIM: Compute metadata from pools.
 *
 * When backend supports filtering, this metadata will come from the API response.
 *
 * @internal
 */
function computePoolMetadata(pools: Pool[]): PoolMetadata {
  const statusCounts: Record<string, number> = {};
  const platforms = new Set<string>();
  const backends = new Set<string>();

  for (const pool of pools) {
    statusCounts[pool.status] = (statusCounts[pool.status] ?? 0) + 1;
    pool.platforms.forEach((platform) => platforms.add(platform));
    backends.add(pool.backend);
  }

  return {
    statusCounts,
    platforms: Array.from(platforms).sort(naturalCompare),
    backends: Array.from(backends).sort(naturalCompare),
  };
}

// =============================================================================
// Main Export
// =============================================================================

/**
 * SHIM: Apply filters synchronously to cached pool data.
 *
 * This is designed for use in useMemo with React Query's cached data.
 * The hook fetches once with a stable query key, then filters are applied
 * client-side from the cache, preventing duplicate API calls.
 *
 * When backend supports filtering:
 * 1. Query key will include filter params
 * 2. This function becomes unnecessary
 * 3. Filtered data comes directly from API
 *
 * @param allPools - All pools from cache
 * @param params - Filter parameters
 * @param sharingGroups - Sharing groups from cache
 */
export function applyPoolFiltersSync(
  allPools: Pool[],
  params: PoolFilterParams,
  sharingGroups: string[][],
): FilteredPoolsResult {
  // SHIM: Apply filters client-side
  const filteredPools = applyPoolFilters(allPools, params, sharingGroups);

  // SHIM: Compute metadata from all pools (server will provide when ready)
  const metadata = computePoolMetadata(allPools);

  return {
    pools: filteredPools,
    allPools,
    sharingGroups,
    metadata,
    total: allPools.length,
    filteredTotal: filteredPools.length,
  };
}

/**
 * Check if any filters are active.
 * Useful for UI to show "filtered" state.
 */
export function hasActiveFilters(params: PoolFilterParams): boolean {
  return Boolean(
    (params.statuses && params.statuses.length > 0) ||
    (params.platforms && params.platforms.length > 0) ||
    (params.backends && params.backends.length > 0) ||
    params.sharedWith ||
    (params.search && params.search.trim()),
  );
}
