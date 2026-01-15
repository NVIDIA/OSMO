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
