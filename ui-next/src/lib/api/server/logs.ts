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
 * Server-Side Log Fetching
 *
 * Server-side functions for prefetching log data into React Query cache.
 * Enables SSR with HydrationBoundary for instant log viewer rendering.
 *
 * Usage:
 * ```tsx
 * // In a Server Component
 * import { prefetchLogData } from '@/lib/api/server/logs';
 *
 * export async function LogViewerWithData({ workflowId }: Props) {
 *   const queryClient = new QueryClient();
 *   await prefetchLogData(queryClient, workflowId);
 *
 *   return (
 *     <HydrationBoundary state={dehydrate(queryClient)}>
 *       <LogViewerClient />
 *     </HydrationBoundary>
 *   );
 * }
 * ```
 */

import { cache } from "react";
import { QueryClient } from "@tanstack/react-query";
import { getServerApiBaseUrl, getServerFetchHeaders } from "./config";
import {
  parseLogBatch,
  computeHistogram,
  computeFacets,
  FACETABLE_FIELDS,
  LOG_QUERY_DEFAULTS,
  type LogDataResult,
} from "../log-adapter";
import { createLogDataQueryKey, type LogDataQueryKeyParams } from "../log-adapter/query-keys";

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for prefetching log data.
 */
export interface PrefetchLogDataParams {
  /** Workflow ID to fetch logs for */
  workflowId: string;
  /** Number of histogram buckets (default: 50) */
  histogramBuckets?: number;
  /** Fields to compute facets for (default: FACETABLE_FIELDS) */
  facetFields?: string[];
  /** Dev params for mock scenarios (playground only) */
  devParams?: Record<string, string>;
}

// =============================================================================
// Fetch Functions
// =============================================================================

/**
 * Fetches log data on the server.
 *
 * Uses React's cache() for request deduplication within a single render.
 * Multiple components calling this in the same request will share the result.
 *
 * @param params - Fetch parameters
 * @returns Unified log data result
 */
export const fetchLogData = cache(async (params: PrefetchLogDataParams): Promise<LogDataResult> => {
  const baseUrl = getServerApiBaseUrl();
  const headers = await getServerFetchHeaders();

  // Build URL
  let url = `${baseUrl}/api/workflow/${encodeURIComponent(params.workflowId)}/logs`;

  // Append dev params if provided
  if (params.devParams && Object.keys(params.devParams).length > 0) {
    const searchParams = new URLSearchParams(params.devParams);
    url += `?${searchParams.toString()}`;
  }

  // Fetch logs
  const response = await fetch(url, {
    headers: {
      ...headers,
      Accept: "text/plain",
    },
    // Don't cache logs on server - they change frequently
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch logs: ${response.status} ${response.statusText}`);
  }

  const logText = await response.text();

  // Parse entries
  const entries = parseLogBatch(logText, params.workflowId);

  // Compute derived data
  const histogram = computeHistogram(entries, params.histogramBuckets ?? LOG_QUERY_DEFAULTS.HISTOGRAM_BUCKETS);
  const facets = computeFacets(entries, params.facetFields ?? FACETABLE_FIELDS);

  return {
    entries,
    histogram,
    facets,
    stats: {
      totalCount: entries.length,
      filteredCount: entries.length, // No filters applied on server prefetch
    },
  };
});

// =============================================================================
// Prefetch for TanStack Query Hydration
// =============================================================================

/**
 * Prefetch log data into a QueryClient for hydration.
 *
 * Use this in Server Components to prefetch data that will be
 * hydrated into TanStack Query on the client.
 *
 * @param queryClient - The QueryClient to prefetch into
 * @param params - Prefetch parameters
 *
 * @example
 * ```tsx
 * // In a Server Component
 * import { HydrationBoundary, dehydrate, QueryClient } from '@tanstack/react-query';
 * import { prefetchLogData } from '@/lib/api/server/logs';
 *
 * export async function LogViewerWithData({ workflowId }: Props) {
 *   const queryClient = new QueryClient();
 *   await prefetchLogData(queryClient, { workflowId });
 *
 *   return (
 *     <HydrationBoundary state={dehydrate(queryClient)}>
 *       <LogViewerClient workflowId={workflowId} />
 *     </HydrationBoundary>
 *   );
 * }
 * ```
 */
export async function prefetchLogData(queryClient: QueryClient, params: PrefetchLogDataParams): Promise<void> {
  // Build the same query key that useLogData will use
  const keyParams: LogDataQueryKeyParams = {
    workflowId: params.workflowId,
    histogramBuckets: params.histogramBuckets,
    facetFields: params.facetFields,
    devParams: params.devParams,
  };

  const queryKey = createLogDataQueryKey(keyParams);

  await queryClient.prefetchQuery({
    queryKey,
    queryFn: () => fetchLogData(params),
  });
}
