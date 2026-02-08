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
 * Server-Side Pool Fetching
 *
 * Fetch pools data on the server for SSR/RSC.
 * Uses React's cache() for request deduplication.
 */

import { cache } from "react";
import { QueryClient } from "@tanstack/react-query";
import type { Pool, PoolsResponse } from "@/lib/api/adapter/types";

// =============================================================================
// Types
// =============================================================================

interface PoolsResult extends PoolsResponse {
  /** Raw response for hydration */
  _raw?: unknown;
}

// =============================================================================
// Fetch Functions
// =============================================================================

/**
 * Fetch all pools from the server.
 *
 * Uses React's cache() for request deduplication within a single render.
 * Multiple components calling this in the same request will share the result.
 *
 * CLEAN PATH: Uses adapter → generated client → customFetch (no MSW imports)
 *
 * @param options - Fetch options (revalidate, tags) - DEPRECATED: Not used with adapter
 * @returns Transformed pools data
 *
 * @example
 * ```tsx
 * // In a Server Component
 * export default async function PoolsPage() {
 *   const { pools, sharingGroups } = await fetchPools();
 *   return <PoolsList pools={pools} />;
 * }
 * ```
 */
export const fetchPools = cache(async (): Promise<PoolsResult> => {
  // Import adapter dynamically to use clean generated client path
  const { fetchPools: adapterFetchPools } = await import("../adapter/hooks");
  const result = await adapterFetchPools();

  return {
    ...result,
    _raw: result, // For compatibility with existing code
  };
});

/**
 * Fetch a single pool by name.
 *
 * CLEAN PATH: Uses adapter → generated client → customFetch (no MSW imports)
 *
 * @param poolName - The pool name to fetch
 * @param options - Fetch options - DEPRECATED: Not used with adapter
 * @returns Pool data or null if not found
 */
export const fetchPoolByName = cache(async (poolName: string): Promise<Pool | null> => {
  // Import generated client for clean fetch path
  const { getPoolQuotasApiPoolQuotaGet } = await import("../generated");
  const { transformPoolDetail } = await import("../adapter/transforms");

  try {
    const rawData = await getPoolQuotasApiPoolQuotaGet({
      pools: [poolName],
      all_pools: false,
    });
    return transformPoolDetail(rawData, poolName);
  } catch (_error) {
    // 404 or other errors - return null
    return null;
  }
});

// =============================================================================
// Prefetch for TanStack Query Hydration
// =============================================================================

/**
 * Prefetch pools into a QueryClient for hydration.
 *
 * Use this in Server Components to prefetch data that will be
 * hydrated into TanStack Query on the client.
 *
 * CLEAN PATH: Uses adapter → generated client → customFetch (no MSW imports)
 *
 * @param queryClient - The QueryClient to prefetch into
 * @param options - Fetch options - DEPRECATED: Not used with adapter
 *
 * @example
 * ```tsx
 * // In a Server Component
 * import { HydrationBoundary, dehydrate, QueryClient } from '@tanstack/react-query';
 *
 * export default async function PoolsPage() {
 *   const queryClient = new QueryClient();
 *   await prefetchPools(queryClient);
 *
 *   return (
 *     <HydrationBoundary state={dehydrate(queryClient)}>
 *       <PoolsContent />
 *     </HydrationBoundary>
 *   );
 * }
 * ```
 */
export async function prefetchPools(queryClient: QueryClient): Promise<void> {
  // Import adapter for clean path
  const { fetchPools: adapterFetchPools } = await import("../adapter/hooks");

  await queryClient.prefetchQuery({
    queryKey: ["pools", "all"],
    queryFn: async () => {
      const result = await adapterFetchPools();
      // Return the transformed data
      return {
        pools: result.pools,
        sharingGroups: result.sharingGroups,
      };
    },
  });
}

/**
 * Prefetch pools for Dashboard using the generated hook's query key.
 *
 * The Dashboard uses usePools() which calls the generated useGetPoolQuotasApiPoolQuotaGet hook.
 * This prefetch uses the same query key format as the generated hook.
 *
 * CLEAN PATH: Uses adapter → generated client → customFetch (no MSW imports)
 *
 * @param queryClient - The QueryClient to prefetch into
 * @param options - Fetch options - DEPRECATED: Not used with adapter
 */
export async function prefetchPoolsForDashboard(queryClient: QueryClient): Promise<void> {
  // Import generated client for clean path
  const { getPoolQuotasApiPoolQuotaGet } = await import("../generated");

  // Query key matches generated: ["/api/pool_quota", { all_pools: true }]
  await queryClient.prefetchQuery({
    queryKey: ["/api/pool_quota", { all_pools: true }],
    queryFn: async () => {
      // Return raw response format that generated hook expects
      return getPoolQuotasApiPoolQuotaGet({ all_pools: true });
    },
  });
}
