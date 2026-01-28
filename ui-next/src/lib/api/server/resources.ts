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
 * Server-Side Resource Fetching
 *
 * Fetch resources data on the server for SSR/RSC.
 * Uses React's cache() for request deduplication.
 */

import { cache } from "react";
import { QueryClient } from "@tanstack/react-query";
import {
  getServerApiBaseUrl,
  getServerFetchHeaders,
  handleResponse,
  EXPENSIVE_REVALIDATE,
  type ServerFetchOptions,
} from "./config";
import { transformAllResourcesResponse, transformResourcesResponse } from "../adapter/transforms";
import type { AllResourcesResponse, PoolResourcesResponse } from "../adapter/types";

// =============================================================================
// Fetch Functions
// =============================================================================

/**
 * Fetch all resources across all pools.
 *
 * Uses React's cache() for request deduplication within a single render.
 *
 * @param options - Fetch options (revalidate, tags)
 * @returns Transformed resources data
 */
export const fetchResources = cache(async (options: ServerFetchOptions = {}): Promise<AllResourcesResponse> => {
  const { revalidate = EXPENSIVE_REVALIDATE, tags = ["resources"] } = options;

  const baseUrl = getServerApiBaseUrl();
  const headers = await getServerFetchHeaders();
  const url = `${baseUrl}/api/resources?all_pools=true`;

  const response = await fetch(url, {
    headers,
    next: {
      revalidate,
      tags,
    },
  });

  const rawData = await handleResponse<unknown>(response, url);
  return transformAllResourcesResponse(rawData);
});

/**
 * Fetch resources for a specific pool.
 *
 * @param poolName - The pool to fetch resources for
 * @param options - Fetch options
 * @returns Resources for the pool
 */
export const fetchResourcesByPool = cache(
  async (poolName: string, options: ServerFetchOptions = {}): Promise<PoolResourcesResponse> => {
    const { revalidate = EXPENSIVE_REVALIDATE, tags = ["resources", `resources-${poolName}`] } = options;

    const baseUrl = getServerApiBaseUrl();
    const headers = await getServerFetchHeaders();
    const url = `${baseUrl}/api/resources?pools=${encodeURIComponent(poolName)}&all_pools=false`;

    const response = await fetch(url, {
      headers,
      next: {
        revalidate,
        tags,
      },
    });

    const rawData = await handleResponse<unknown>(response, url);
    return transformResourcesResponse(rawData, poolName);
  },
);

// =============================================================================
// Prefetch for TanStack Query Hydration
// =============================================================================

/**
 * Prefetch resources into a QueryClient for hydration.
 *
 * @param queryClient - The QueryClient to prefetch into
 * @param options - Fetch options
 */
export async function prefetchResources(queryClient: QueryClient, options: ServerFetchOptions = {}): Promise<void> {
  await queryClient.prefetchQuery({
    queryKey: ["resources", "all"],
    queryFn: () => fetchResources(options),
  });
}

// Re-export SearchChip type for server use
import type { SearchChip } from "@/stores";

/**
 * Build query key for resources list (matches client-side useResourcesData).
 *
 * This must match the key format in use-resources-data.ts to enable hydration.
 * Exported for use in resources-with-data.tsx to extract prefetched aggregates.
 *
 * @param chips - Filter chips from URL
 */
export function buildResourcesQueryKey(chips: SearchChip[] = []): readonly unknown[] {
  // Extract filter values matching client-side chipsToParams format
  const pools = chips
    .filter((c) => c.field === "pool")
    .map((c) => c.value)
    .sort()
    .join(",");
  const platforms = chips
    .filter((c) => c.field === "platform")
    .map((c) => c.value)
    .sort()
    .join(",");
  const resourceTypes = chips
    .filter((c) => c.field === "type")
    .map((c) => c.value)
    .sort()
    .join(",");
  const backends = chips
    .filter((c) => c.field === "backend")
    .map((c) => c.value)
    .sort()
    .join(",");
  const search = chips.find((c) => c.field === "name")?.value ?? "";
  const hostname = chips.find((c) => c.field === "hostname")?.value ?? "";

  // Client-only chips (numeric filters) - empty for server prefetch
  const clientFilters = "";

  return [
    "resources",
    "filtered",
    {
      pools,
      platforms,
      resourceTypes,
      backends,
      search,
      hostname,
      clientFilters,
    },
  ] as const;
}

/**
 * Prefetch the first page of resources for infinite query hydration.
 *
 * Uses prefetchInfiniteQuery to match the client's useInfiniteQuery.
 * Only prefetches the first page - subsequent pages are fetched on demand.
 *
 * SHIM NOTE:
 * - Uses adapter's fetchPaginatedResources which handles client-side filtering
 * - Returns aggregates computed from the full filtered dataset
 * - When backend supports filtering/aggregation, adapter will pass through to server
 *
 * nuqs Compatibility:
 * - Accepts filter chips parsed from URL searchParams
 * - Builds query key matching what client will use
 * - Ensures cache hit even with URL filters
 *
 * @param queryClient - The QueryClient to prefetch into
 * @param filterChips - Filter chips from URL (optional, for nuqs compatibility)
 */
export async function prefetchResourcesList(queryClient: QueryClient, filterChips: SearchChip[] = []): Promise<void> {
  const queryKey = buildResourcesQueryKey(filterChips);

  // Import adapter function (uses resources-shim with aggregates)
  const { fetchResources: fetchResourcesWithAggregates } = await import("../adapter/hooks");

  // Convert chips to filter params (matching client-side logic)
  const pools = filterChips.filter((c) => c.field === "pool").map((c) => c.value);
  const platforms = filterChips.filter((c) => c.field === "platform").map((c) => c.value);
  const resourceTypes = filterChips.filter((c) => c.field === "type").map((c) => c.value);
  const backends = filterChips.filter((c) => c.field === "backend").map((c) => c.value);
  const search = filterChips.find((c) => c.field === "name")?.value;
  const hostname = filterChips.find((c) => c.field === "hostname")?.value;

  await queryClient.prefetchInfiniteQuery({
    queryKey,
    queryFn: async () => {
      // Use adapter which goes through shim - returns with aggregates
      return fetchResourcesWithAggregates({
        pools: pools.length > 0 ? pools : undefined,
        platforms: platforms.length > 0 ? platforms : undefined,
        resourceTypes: resourceTypes.length > 0 ? resourceTypes : undefined,
        backends: backends.length > 0 ? backends : undefined,
        search,
        hostname,
        limit: 50,
        offset: 0,
      });
    },
    initialPageParam: { cursor: undefined, offset: 0 },
  });
}
