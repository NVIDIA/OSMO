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
 * Server-Side Workflow Fetching
 *
 * Fetch workflows data on the server for SSR/RSC.
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
import { normalizeWorkflowTimestamps } from "../adapter/utils";
import type {
  WorkflowQueryResponse,
  SrcServiceCoreWorkflowObjectsListResponse,
  WorkflowPriority,
  WorkflowStatus,
} from "../generated";

/** Type alias for better readability */
type WorkflowsListResponse = SrcServiceCoreWorkflowObjectsListResponse;

// =============================================================================
// Types
// =============================================================================

export interface WorkflowsQueryParams {
  /** Filter by status (can specify multiple) */
  status?: WorkflowStatus[];
  /** Filter by priority */
  priority?: WorkflowPriority;
  /** Filter by pool */
  pool?: string;
  /** Search term for workflow name */
  search?: string;
  /** Max results to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

// =============================================================================
// Fetch Functions
// =============================================================================

/**
 * Fetch workflows list from the server.
 *
 * Uses React's cache() for request deduplication within a single render.
 *
 * @param params - Query parameters for filtering
 * @param options - Fetch options (revalidate, tags)
 * @returns Workflows list response
 */
export const fetchWorkflows = cache(
  async (params: WorkflowsQueryParams = {}, options: ServerFetchOptions = {}): Promise<WorkflowsListResponse> => {
    const { revalidate = DEFAULT_REVALIDATE, tags = ["workflows"] } = options;

    const baseUrl = getServerApiBaseUrl();
    const headers = await getServerFetchHeaders();

    // Build query string
    const queryParams = new URLSearchParams();
    if (params.status) {
      params.status.forEach((s) => queryParams.append("status", s));
    }
    if (params.priority) {
      queryParams.append("priority", params.priority);
    }
    if (params.pool) {
      queryParams.append("pool", params.pool);
    }
    if (params.search) {
      queryParams.append("search", params.search);
    }
    if (params.limit !== undefined) {
      queryParams.append("limit", String(params.limit));
    }
    if (params.offset !== undefined) {
      queryParams.append("offset", String(params.offset));
    }

    const queryString = queryParams.toString();
    const url = `${baseUrl}/api/workflow${queryString ? `?${queryString}` : ""}`;

    const response = await fetch(url, {
      headers,
      next: {
        revalidate,
        tags,
      },
    });

    const rawData = await handleResponse<unknown>(response, url);

    // Parse string response if needed (backend quirk)
    const parsed = typeof rawData === "string" ? JSON.parse(rawData) : rawData;

    return parsed as WorkflowsListResponse;
  },
);

/**
 * Fetch a single workflow by name.
 *
 * @param name - Workflow name
 * @param verbose - Whether to include full task details
 * @param options - Fetch options
 * @returns Workflow data or null if not found
 */
export const fetchWorkflowByName = cache(
  async (name: string, verbose = true, options: ServerFetchOptions = {}): Promise<WorkflowQueryResponse | null> => {
    const { revalidate = DEFAULT_REVALIDATE, tags = ["workflows", `workflow-${name}`] } = options;

    const baseUrl = getServerApiBaseUrl();
    const headers = await getServerFetchHeaders();
    const url = `${baseUrl}/api/workflow/${encodeURIComponent(name)}?verbose=${verbose}`;

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

    // Parse string response if needed (backend quirk)
    const parsed = typeof rawData === "string" ? JSON.parse(rawData) : rawData;

    // Normalize timestamps at the API boundary
    return normalizeWorkflowTimestamps(parsed) as WorkflowQueryResponse;
  },
);

/**
 * Fetch raw workflow response for prefetching (without timestamp normalization).
 * The client hook will normalize timestamps after hydration.
 */
const fetchWorkflowByNameRaw = cache(
  async (name: string, verbose = true, options: ServerFetchOptions = {}): Promise<unknown> => {
    const { revalidate = DEFAULT_REVALIDATE, tags = ["workflows", `workflow-${name}`] } = options;

    const baseUrl = getServerApiBaseUrl();
    const headers = await getServerFetchHeaders();
    const url = `${baseUrl}/api/workflow/${encodeURIComponent(name)}?verbose=${verbose}`;

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

    return handleResponse<unknown>(response, url);
  },
);

/**
 * Prefetch a single workflow by name for hydration.
 *
 * Uses the same query key format as the generated useGetWorkflowApiWorkflowNameGet hook.
 *
 * @param queryClient - The QueryClient to prefetch into
 * @param name - Workflow name
 * @param options - Fetch options
 */
export async function prefetchWorkflowByName(
  queryClient: QueryClient,
  name: string,
  options: ServerFetchOptions = {},
): Promise<void> {
  // Query key matches generated: ["/api/workflow/${name}", { verbose: true }]
  await queryClient.prefetchQuery({
    queryKey: [`/api/workflow/${name}`, { verbose: true }],
    queryFn: () => fetchWorkflowByNameRaw(name, true, options),
  });
}

// =============================================================================
// Prefetch for TanStack Query Hydration
// =============================================================================

/**
 * Prefetch workflows into a QueryClient for hydration.
 *
 * @param queryClient - The QueryClient to prefetch into
 * @param params - Query parameters
 * @param options - Fetch options
 */
export async function prefetchWorkflows(
  queryClient: QueryClient,
  params: WorkflowsQueryParams = {},
  options: ServerFetchOptions = {},
): Promise<void> {
  await queryClient.prefetchQuery({
    queryKey: ["workflows", params],
    queryFn: () => fetchWorkflows(params, options),
  });
}

/**
 * Build query key for workflows list (matches client-side buildWorkflowsQueryKey).
 *
 * This must match the key format in workflows-shim.ts to enable hydration.
 *
 * @param chipsString - Sorted, comma-joined chip string (from chipsToKeyString)
 * @param showAllUsers - Whether showing all users' workflows
 * @param sortDirection - Sort direction
 */
export function buildServerWorkflowsQueryKey(
  chipsString = "",
  showAllUsers = false,
  sortDirection = "DESC",
): readonly unknown[] {
  return [
    "workflows",
    "paginated",
    {
      chips: chipsString,
      showAllUsers,
      sortDirection,
    },
  ] as const;
}

// Re-export SearchChip type for server use
import type { SearchChip } from "@/stores";
import { chipsToKeyString } from "@/lib/url-utils";

/**
 * Prefetch the first page of workflows for infinite query hydration.
 *
 * Uses prefetchInfiniteQuery to match the client's useInfiniteQuery.
 * Only prefetches the first page - subsequent pages are fetched on demand.
 *
 * nuqs Compatibility:
 * - Accepts filter chips parsed from URL searchParams
 * - Builds query key matching what client will use
 * - Ensures cache hit even with URL filters
 *
 * @param queryClient - The QueryClient to prefetch into
 * @param filterChips - Filter chips from URL (optional, for nuqs compatibility)
 * @param options - Fetch options
 */
export async function prefetchWorkflowsList(
  queryClient: QueryClient,
  filterChips: SearchChip[] = [],
  options: ServerFetchOptions = {},
): Promise<void> {
  // Build query key with chips string matching client format
  const chipsString = chipsToKeyString(filterChips);
  const queryKey = buildServerWorkflowsQueryKey(chipsString, false, "DESC");

  // Extract filter values from chips for API call
  // Note: Only status is used currently; others reserved for future backend support
  const statusFilters = filterChips.filter((c) => c.field === "status").map((c) => c.value as WorkflowStatus);
  const _userFilters = filterChips.filter((c) => c.field === "user").map((c) => c.value);
  const _poolFilters = filterChips.filter((c) => c.field === "pool").map((c) => c.value);

  await queryClient.prefetchInfiniteQuery({
    queryKey,
    queryFn: async () => {
      const response = await fetchWorkflows(
        {
          limit: 50,
          offset: 0,
          status: statusFilters.length > 0 ? statusFilters : undefined,
          // Note: Backend API may not support all filter types
          // For now, we at least match the query key so cache hits work
        },
        options,
      );

      // Parse the response (backend returns string)
      const workflows = response?.workflows ?? [];

      // Return in PaginatedResponse format expected by usePaginatedData
      return {
        items: workflows,
        hasMore: workflows.length === 50,
        nextOffset: workflows.length === 50 ? 50 : undefined,
        total: undefined,
        filteredTotal: undefined,
      };
    },
    initialPageParam: { cursor: undefined, offset: 0 },
  });
}
