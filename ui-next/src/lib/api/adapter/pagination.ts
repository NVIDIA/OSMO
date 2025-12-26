/**
 * SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.
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
 * Pagination Adapter - Shim for backend pagination support.
 *
 * =============================================================================
 * IDEAL BACKEND API (what we're coding toward):
 * =============================================================================
 *
 * GET /api/resources?limit=50&cursor=abc123&search=dgx&resource_types=SHARED
 *
 * Response:
 * {
 *   "resources": [...50 items...],
 *   "pagination": {
 *     "cursor": "xyz789",      // Opaque cursor for next page
 *     "has_more": true,        // Whether more pages exist
 *     "total": 1234,           // Total matching filters
 *     "filtered_total": 456    // Total after search/filter (if different)
 *   },
 *   "metadata": {
 *     "pools": ["pool-1", "pool-2"],      // Available for filtering
 *     "platforms": ["dgx", "base"]         // Available for filtering
 *   }
 * }
 *
 * =============================================================================
 * CURRENT SHIM (what this file does):
 * =============================================================================
 *
 * 1. Fetches ALL resources when cache is empty or expired
 * 2. Caches them client-side (60s TTL)
 * 3. Applies filters client-side to cached data
 * 4. Returns paginated slices from filtered cache
 * 5. Filter changes use cache (no refetch within TTL)
 *
 * WHEN BACKEND IS UPDATED:
 * 1. Delete this file entirely
 * 2. Query backend directly with filter params
 * 3. TanStack Query handles caching per filter combination
 *
 * See: BACKEND_TODOS.md#11 for detailed backend requirements.
 */

import type { PaginatedResponse, PaginationParams } from "@/lib/pagination";
import { matchesSearch } from "@/lib/utils";
import type { Resource } from "./types";
import { transformAllResourcesResponse } from "./transforms";

/**
 * Cache structure for client-side pagination shim.
 */
interface ClientPaginationCache<T> {
  allItems: T[];
  pools: string[];
  platforms: string[];
  fetchedAt: number;
}

// In-memory cache for client-side pagination shim
let resourcesCache: ClientPaginationCache<Resource> | null = null;
const CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Check if cache is valid.
 */
function isCacheValid<T>(cache: ClientPaginationCache<T> | null): cache is ClientPaginationCache<T> {
  if (!cache) return false;
  return Date.now() - cache.fetchedAt < CACHE_TTL_MS;
}

/**
 * Encode a cursor from an offset value.
 * Uses base64 encoding for opacity.
 */
function encodeCursor(offset: number): string {
  return btoa(String(offset));
}

/**
 * Decode a cursor to an offset value.
 */
function decodeCursor(cursor: string): number {
  try {
    return parseInt(atob(cursor), 10);
  } catch {
    return 0;
  }
}

/**
 * Extended paginated response with metadata.
 */
export interface PaginatedResourcesResult extends PaginatedResponse<Resource> {
  /** Available pools for filtering */
  pools: string[];
  /** Available platforms for filtering */
  platforms: string[];
}

/**
 * Filter parameters for client-side filtering shim.
 * SHIM: These are applied client-side until backend supports server-side filtering.
 */
export interface ResourceFilterParams {
  pools?: string[];
  platforms?: string[];
  resourceTypes?: string[];
  search?: string;
  all_pools?: boolean;
}

/**
 * SHIM: Apply client-side filters to resources.
 *
 * This function handles all filtering that should ideally be done server-side.
 * When backend supports filtering, this function can be removed and filters
 * passed directly to the API.
 *
 * @internal
 */
function applyClientSideFilters(resources: Resource[], params: ResourceFilterParams): Resource[] {
  let result = resources;

  // SHIM: Filter by pool (should be server-side)
  if (params.pools && params.pools.length > 0) {
    const poolSet = new Set(params.pools);
    result = result.filter((resource) => resource.poolMemberships.some((m) => poolSet.has(m.pool)));
  }

  // SHIM: Filter by platform (should be server-side)
  if (params.platforms && params.platforms.length > 0) {
    const platformSet = new Set(params.platforms);
    result = result.filter((resource) => platformSet.has(resource.platform));
  }

  // SHIM: Filter by resource type (should be server-side)
  if (params.resourceTypes && params.resourceTypes.length > 0) {
    const typeSet = new Set(params.resourceTypes);
    result = result.filter((resource) => typeSet.has(resource.resourceType));
  }

  // SHIM: Filter by search (should be server-side)
  if (params.search && params.search.trim()) {
    result = result.filter((resource) =>
      matchesSearch(resource, params.search!, (r) => [
        r.name,
        r.platform,
        r.resourceType,
        ...r.poolMemberships.map((m) => m.pool),
      ]),
    );
  }

  return result;
}

/**
 * SHIM: Paginate all resources with client-side cursor simulation and filtering.
 *
 * When backend supports real pagination and filtering, this function can be
 * updated to pass params directly without the client-side cache or filters.
 *
 * @param params - Query params including pagination and filters
 * @param fetchFn - Function to fetch all resources from API
 */
export async function fetchPaginatedResources(
  params: ResourceFilterParams & PaginationParams,
  fetchFn: () => Promise<unknown>,
): Promise<PaginatedResourcesResult> {
  // SHIM: Use cache for ALL requests (including filter changes)
  // This prevents refetching when filters change within the cache TTL.
  // When backend supports filtering, remove this cache entirely.
  if (isCacheValid(resourcesCache)) {
    const filteredItems = applyClientSideFilters(resourcesCache.allItems, params);
    const startIndex = params.cursor ? decodeCursor(params.cursor) : (params.offset ?? 0);
    const endIndex = startIndex + params.limit;
    const pageItems = filteredItems.slice(startIndex, endIndex);
    const hasMore = endIndex < filteredItems.length;

    return {
      items: pageItems,
      nextCursor: hasMore ? encodeCursor(endIndex) : null,
      hasMore,
      filteredTotal: filteredItems.length,
      total: resourcesCache.allItems.length,
      pools: resourcesCache.pools,
      platforms: resourcesCache.platforms,
    };
  }

  // Cache invalid or missing - fetch fresh data
  const rawResponse = await fetchFn();
  const transformed = transformAllResourcesResponse(rawResponse);

  // Update cache with unfiltered data
  resourcesCache = {
    allItems: transformed.resources,
    pools: transformed.pools,
    platforms: transformed.platforms,
    fetchedAt: Date.now(),
  };

  // Apply filters and return first page
  const filteredItems = applyClientSideFilters(transformed.resources, params);
  const startIndex = params.offset ?? 0;
  const endIndex = startIndex + params.limit;
  const pageItems = filteredItems.slice(startIndex, endIndex);
  const hasMore = endIndex < filteredItems.length;

  return {
    items: pageItems,
    nextCursor: hasMore ? encodeCursor(endIndex) : null,
    hasMore,
    filteredTotal: filteredItems.length,
    total: transformed.resources.length,
    pools: transformed.pools,
    platforms: transformed.platforms,
  };
}

/**
 * Invalidate the resources cache.
 * Call this when resources may have changed (after mutations).
 */
export function invalidateResourcesCache(): void {
  resourcesCache = null;
}

/**
 * SHIM: Get available filter options from the cached (unfiltered) resources.
 *
 * This returns pools and platforms from the full dataset, not filtered results.
 * Used to populate filter dropdowns that shouldn't disappear when filtering.
 *
 * @returns Filter options if cache is valid, null otherwise
 */
export function getResourceFilterOptions(): {
  pools: string[];
  platforms: string[];
} | null {
  if (!isCacheValid(resourcesCache)) {
    return null;
  }
  return {
    pools: resourcesCache.pools,
    platforms: resourcesCache.platforms,
  };
}

/**
 * Get the current cache state (for testing).
 * @internal
 */
export function _getCacheState(): {
  isValid: boolean;
  itemCount: number;
  age: number | null;
} {
  if (!resourcesCache) {
    return { isValid: false, itemCount: 0, age: null };
  }
  return {
    isValid: isCacheValid(resourcesCache),
    itemCount: resourcesCache.allItems.length,
    age: Date.now() - resourcesCache.fetchedAt,
  };
}

/**
 * Set the cache TTL (for testing).
 * @internal
 */
let _cacheTtlOverride: number | null = null;
export function _setCacheTtl(ttl: number | null): void {
  _cacheTtlOverride = ttl;
}
