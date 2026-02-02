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
import { getGetWorkflowApiWorkflowNameGetQueryKey } from "../generated";
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
  /** Filter by pool (deprecated: use pools array) */
  pool?: string;
  /** Filter by pools (can specify multiple) */
  pools?: string[];
  /** Filter by users (can specify multiple) */
  users?: string[];
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
 * CLEAN PATH: Uses generated client → customFetch (no MSW imports)
 *
 * @param params - Query parameters for filtering
 * @param options - Fetch options - DEPRECATED: Not used with adapter
 * @returns Workflows list response
 */
export const fetchWorkflows = cache(async (params: WorkflowsQueryParams = {}): Promise<WorkflowsListResponse> => {
  // Import generated client for clean path
  const { listWorkflowApiWorkflowGet } = await import("../generated");

  // Map params to generated API format
  const apiParams = {
    statuses: params.status,
    priority: params.priority ? [params.priority] : undefined,
    pools: params.pools || (params.pool ? [params.pool] : undefined),
    users: params.users,
    name: params.search,
    limit: params.limit,
    offset: params.offset,
  };

  const rawData = await listWorkflowApiWorkflowGet(apiParams);

  // Parse string response if needed (backend quirk)
  const parsed = typeof rawData === "string" ? JSON.parse(rawData) : rawData;

  return parsed as WorkflowsListResponse;
});

/**
 * Fetch a single workflow by name.
 *
 * CLEAN PATH: Uses adapter → generated client → customFetch (no MSW imports)
 *
 * @param name - Workflow name
 * @param verbose - Whether to include full task details
 * @param options - Fetch options - DEPRECATED: Not used with adapter
 * @returns Workflow data or null if not found
 */
export const fetchWorkflowByName = cache(
  async (name: string, verbose = true): Promise<WorkflowQueryResponse | null> => {
    // Import adapter for clean path
    const { fetchWorkflowByName: adapterFetch } = await import("../adapter/hooks");

    return adapterFetch(name, verbose) as Promise<WorkflowQueryResponse | null>;
  },
);

/**
 * Fetch raw workflow response for prefetching (without timestamp normalization).
 * The client hook will normalize timestamps after hydration.
 *
 * CLEAN PATH: Uses generated client → customFetch (no MSW imports)
 */
const fetchWorkflowByNameRaw = cache(async (name: string, verbose = true): Promise<unknown> => {
  // Import generated client for clean path
  const { getWorkflowApiWorkflowNameGet } = await import("../generated");

  try {
    return await getWorkflowApiWorkflowNameGet(name, { verbose });
  } catch (error) {
    // Log server-side prefetch errors for debugging production issues
    // Note: In development, this helps diagnose auth/network issues
    // In production, these logs appear in server logs (not browser console)
    console.error(
      `[Server Prefetch] Failed to fetch workflow "${name}":`,
      error instanceof Error ? error.message : error,
    );

    // Re-throw the error so TanStack Query can handle it properly
    // This prevents caching null and allows client-side retry with proper error state
    throw error;
  }
});

/**
 * Prefetch a single workflow by name for hydration.
 *
 * Uses the same query key format as the generated useGetWorkflowApiWorkflowNameGet hook.
 *
 * @param queryClient - The QueryClient to prefetch into
 * @param name - Workflow name
 * @param options - Fetch options
 */
export async function prefetchWorkflowByName(queryClient: QueryClient, name: string): Promise<void> {
  // Use the generated query key helper to ensure perfect consistency with client hooks
  // This ensures a cache hit during hydration.
  const queryKey = getGetWorkflowApiWorkflowNameGetQueryKey(name, { verbose: true });

  await queryClient.prefetchQuery({
    queryKey,
    queryFn: () => fetchWorkflowByNameRaw(name, true),
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
export async function prefetchWorkflows(queryClient: QueryClient, params: WorkflowsQueryParams = {}): Promise<void> {
  await queryClient.prefetchQuery({
    queryKey: ["workflows", params],
    queryFn: () => fetchWorkflows(params),
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
export async function prefetchWorkflowsList(queryClient: QueryClient, filterChips: SearchChip[] = []): Promise<void> {
  // Build query key with chips string matching client format
  const chipsString = chipsToKeyString(filterChips);
  const queryKey = buildServerWorkflowsQueryKey(chipsString, false, "DESC");

  // Extract filter values from chips for API call
  const statusFilters = filterChips.filter((c) => c.field === "status").map((c) => c.value as WorkflowStatus);
  const poolFilters = filterChips.filter((c) => c.field === "pool").map((c) => c.value);
  const userFilters = filterChips.filter((c) => c.field === "user").map((c) => c.value);

  await queryClient.prefetchInfiniteQuery({
    queryKey,
    queryFn: async () => {
      const response = await fetchWorkflows({
        limit: 50,
        offset: 0,
        status: statusFilters.length > 0 ? statusFilters : undefined,
        pools: poolFilters.length > 0 ? poolFilters : undefined,
        users: userFilters.length > 0 ? userFilters : undefined,
      });

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
