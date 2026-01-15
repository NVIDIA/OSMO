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
import {
  getServerApiBaseUrl,
  getServerFetchHeaders,
  handleResponse,
  DEFAULT_REVALIDATE,
  type ServerFetchOptions,
} from "./config";
import { transformPoolsResponse, transformPoolDetail } from "../adapter/transforms";
import type { Pool, PoolsResponse } from "../adapter/types";

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
 * @param options - Fetch options (revalidate, tags)
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
export const fetchPools = cache(async (options: ServerFetchOptions = {}): Promise<PoolsResult> => {
  const { revalidate = DEFAULT_REVALIDATE, tags = ["pools"] } = options;

  const baseUrl = getServerApiBaseUrl();
  const headers = await getServerFetchHeaders();
  const url = `${baseUrl}/api/pool_quota?all_pools=true`;

  const response = await fetch(url, {
    headers,
    next: {
      revalidate,
      tags,
    },
  });

  const rawData = await handleResponse<unknown>(response, url);
  const transformed = transformPoolsResponse(rawData);

  return {
    ...transformed,
    _raw: rawData,
  };
});

/**
 * Fetch a single pool by name.
 *
 * @param poolName - The pool name to fetch
 * @param options - Fetch options
 * @returns Pool data or null if not found
 */
export const fetchPoolByName = cache(
  async (poolName: string, options: ServerFetchOptions = {}): Promise<Pool | null> => {
    const { revalidate = DEFAULT_REVALIDATE, tags = ["pools", `pool-${poolName}`] } = options;

    const baseUrl = getServerApiBaseUrl();
    const headers = await getServerFetchHeaders();
    const url = `${baseUrl}/api/pool_quota?pools=${encodeURIComponent(poolName)}&all_pools=false`;

    const response = await fetch(url, {
      headers,
      next: {
        revalidate,
        tags,
      },
    });

    if (response.status === 404) {
      return null;
    }

    const rawData = await handleResponse<unknown>(response, url);
    return transformPoolDetail(rawData, poolName);
  },
);

// =============================================================================
// Prefetch for TanStack Query Hydration
// =============================================================================

/**
 * Prefetch pools into a QueryClient for hydration.
 *
 * Use this in Server Components to prefetch data that will be
 * hydrated into TanStack Query on the client.
 *
 * @param queryClient - The QueryClient to prefetch into
 * @param options - Fetch options
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
export async function prefetchPools(queryClient: QueryClient, options: ServerFetchOptions = {}): Promise<void> {
  await queryClient.prefetchQuery({
    queryKey: ["pools", "all"],
    queryFn: async () => {
      const result = await fetchPools(options);
      // Return the transformed data (without _raw for cleaner cache)
      return {
        pools: result.pools,
        sharingGroups: result.sharingGroups,
      };
    },
  });
}
