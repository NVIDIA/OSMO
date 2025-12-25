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
 * 1. Fetches ALL resources on first page request
 * 2. Caches them client-side (60s TTL)
 * 3. Returns paginated slices from cache
 * 4. Simulates cursor-based pagination
 *
 * WHEN BACKEND IS UPDATED:
 * 1. Update fetchPaginatedResources to pass params directly to API
 * 2. Remove client-side cache
 * 3. Parse pagination from response
 * 4. UI components work unchanged
 *
 * See: BACKEND_TODOS.md#11 for detailed backend requirements.
 */

import type { PaginatedResponse, PaginationParams } from "@/lib/pagination";
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
 * SHIM: Paginate all resources with client-side cursor simulation.
 *
 * When backend supports real pagination, this function can be updated
 * to pass params directly without the client-side cache.
 *
 * @param params - Query params including pagination
 * @param fetchFn - Function to fetch all resources from API
 */
export async function fetchPaginatedResources(
  params: {
    pools?: string[];
    platforms?: string[];
    all_pools?: boolean;
  } & PaginationParams,
  fetchFn: () => Promise<unknown>,
): Promise<PaginatedResourcesResult> {
  // Determine if this is the first page request
  const isFirstPage = !params.cursor && (params.offset === undefined || params.offset === 0);

  // If we have a valid cache and this is NOT the first page, use cache
  if (!isFirstPage && isCacheValid(resourcesCache)) {
    // Parse cursor (which is just the offset encoded)
    const startIndex = params.cursor ? decodeCursor(params.cursor) : (params.offset ?? 0);

    const endIndex = startIndex + params.limit;
    const pageItems = resourcesCache.allItems.slice(startIndex, endIndex);
    const hasMore = endIndex < resourcesCache.allItems.length;

    return {
      items: pageItems,
      nextCursor: hasMore ? encodeCursor(endIndex) : null,
      hasMore,
      total: resourcesCache.allItems.length,
      pools: resourcesCache.pools,
      platforms: resourcesCache.platforms,
    };
  }

  // Fetch all resources
  const rawResponse = await fetchFn();
  const transformed = transformAllResourcesResponse(rawResponse);

  // Update cache
  resourcesCache = {
    allItems: transformed.resources,
    pools: transformed.pools,
    platforms: transformed.platforms,
    fetchedAt: Date.now(),
  };

  // Return first page
  const startIndex = params.offset ?? 0;
  const endIndex = startIndex + params.limit;
  const pageItems = transformed.resources.slice(startIndex, endIndex);
  const hasMore = endIndex < transformed.resources.length;

  return {
    items: pageItems,
    nextCursor: hasMore ? encodeCursor(endIndex) : null,
    hasMore,
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
