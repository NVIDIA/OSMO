// React Query hooks with transformation to ideal types. Use these instead of generated hooks.

import { useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useGetPoolQuotasApiPoolQuotaGet,
  useGetResourcesApiResourcesGet,
  useGetVersionApiVersionGet,
  getResourcesApiResourcesGet,
  getPoolQuotasApiPoolQuotaGet,
} from "../generated";
import { QUERY_STALE_TIME_EXPENSIVE_MS, QUERY_STALE_TIME } from "@/lib/config";
import { naturalCompare } from "@/lib/utils";

import {
  transformPoolsResponse,
  transformPoolDetail,
  transformResourcesResponse,
  transformAllResourcesResponse,
  transformVersionResponse,
} from "./transforms";

import type { PoolResourcesResponse, AllResourcesResponse } from "./types";
import {
  fetchPaginatedResources,
  invalidateResourcesCache,
  getResourceFilterOptions,
  type ResourceFilterParams,
} from "./resources-shim";
import {
  applyPoolFiltersSync,
  hasActiveFilters,
  type PoolFilterParams,
  type FilteredPoolsResult,
  type PoolMetadata,
} from "./pools-shim";
import type { PaginationParams } from "@/lib/api/pagination";
import { normalizeWorkflowTimestamps } from "./utils";

export function usePools() {
  const { data, isLoading, error, refetch } = useGetPoolQuotasApiPoolQuotaGet(
    { all_pools: true },
    {
      query: {
        select: useCallback((rawData: unknown) => {
          if (!rawData) return { pools: [], sharingGroups: [] };
          return transformPoolsResponse(rawData);
        }, []),
      },
    },
  );

  return {
    pools: data?.pools ?? [],
    sharingGroups: data?.sharingGroups ?? [],
    isLoading,
    error,
    refetch,
  };
}

// SHIM: Client-side filtering until backend supports it (Issue: BACKEND_TODOS.md#12)
export function useFilteredPools(params: PoolFilterParams = {}) {
  // SHIM: Use stable query key without filter params
  // This ensures we don't refetch when filters change - filtering is client-side
  // FUTURE: When backend supports filtering, include params in query key
  const query = useQuery({
    queryKey: ["pools", "all"],
    queryFn: async () => {
      const rawResponse = await getPoolQuotasApiPoolQuotaGet({ all_pools: true });
      return transformPoolsResponse(rawResponse);
    },
    staleTime: QUERY_STALE_TIME_EXPENSIVE_MS,
  });

  // SHIM: Apply filters client-side from cached data
  // FUTURE: When backend supports filtering, this becomes a passthrough
  const filteredResult = useMemo((): FilteredPoolsResult | null => {
    if (!query.data) return null;
    return applyPoolFiltersSync(query.data.pools, params, query.data.sharingGroups);
  }, [query.data, params]);

  return {
    pools: filteredResult?.pools ?? [],
    allPools: filteredResult?.allPools ?? [],
    sharingGroups: filteredResult?.sharingGroups ?? [],
    metadata: filteredResult?.metadata ?? null,
    total: filteredResult?.total ?? 0,
    filteredTotal: filteredResult?.filteredTotal ?? 0,
    hasActiveFilters: hasActiveFilters(params),
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export type { PoolFilterParams, FilteredPoolsResult, PoolMetadata };

export function usePool(poolName: string) {
  const { data, isLoading, error, refetch } = useGetPoolQuotasApiPoolQuotaGet(
    {
      pools: [poolName],
      all_pools: false,
    },
    {
      query: {
        select: useCallback(
          (rawData: unknown) => {
            if (!rawData) return null;
            return transformPoolDetail(rawData, poolName);
          },
          [poolName],
        ),
      },
    },
  );

  return {
    pool: data ?? null,
    isLoading,
    error,
    refetch,
  };
}

export function usePoolResources(poolName: string) {
  const { data, isLoading, error, refetch } = useGetResourcesApiResourcesGet(
    {
      pools: [poolName],
      all_pools: false,
    },
    {
      query: {
        select: useCallback(
          (rawData: unknown): PoolResourcesResponse => {
            if (!rawData) return { resources: [], platforms: [] };
            return transformResourcesResponse(rawData, poolName);
          },
          [poolName],
        ),
      },
    },
  );

  return {
    resources: data?.resources ?? [],
    platforms: data?.platforms ?? [],
    isLoading,
    error,
    refetch,
  };
}

export function useAllResources() {
  const { data, isLoading, error, refetch } = useGetResourcesApiResourcesGet(
    { all_pools: true },
    {
      query: {
        select: useCallback((rawData: unknown): AllResourcesResponse => {
          if (!rawData) return { resources: [], pools: [], platforms: [] };
          return transformAllResourcesResponse(rawData);
        }, []),
      },
    },
  );

  return {
    resources: data?.resources ?? [],
    pools: data?.pools ?? [],
    platforms: data?.platforms ?? [],
    isLoading,
    error,
    refetch,
  };
}

// SSR: Version is prefetched at dashboard layout level
export function useVersion() {
  const { data, isLoading, error } = useGetVersionApiVersionGet({
    query: {
      // Version rarely changes - use STATIC stale time
      staleTime: QUERY_STALE_TIME.STATIC,
      select: useCallback((rawData: unknown) => {
        if (!rawData) return null;
        return transformVersionResponse(rawData);
      }, []),
    },
  });

  return {
    version: data ?? null,
    isLoading,
    error,
  };
}

import type { PoolMembership, Resource, TaskConfig, Pool } from "./types";
import type { ResourcesResponse } from "../generated";
import type { PaginatedResourcesResult } from "./resources-shim";

// SHIM: Client-side pagination until backend supports it (Issue: BACKEND_TODOS.md#11)
export async function fetchResources(
  params: Omit<ResourceFilterParams, "all_pools"> & PaginationParams,
): Promise<PaginatedResourcesResult> {
  // Pass all filter params to the adapter shim - it handles client-side filtering
  return fetchPaginatedResources({ ...params, all_pools: true }, () =>
    getResourcesApiResourcesGet({ all_pools: true }).then((res) => res as unknown),
  );
}

export { invalidateResourcesCache };
export { getResourceFilterOptions };

// WORKAROUND: Must query all_pools=true to get full memberships (Issue: BACKEND_TODOS.md#7)
function extractPoolMemberships(data: unknown, resourceName: string): PoolMembership[] {
  let backendResources: ResourcesResponse["resources"] = [];
  try {
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    backendResources = (parsed as ResourcesResponse)?.resources ?? [];
  } catch {
    return [];
  }

  const backendResource = backendResources.find((r) => {
    const nameField = (r.exposed_fields as Record<string, unknown>)?.node;
    return r.hostname === resourceName || nameField === resourceName;
  });

  if (!backendResource) return [];

  const poolPlatformLabels = backendResource.pool_platform_labels ?? {};
  const memberships: PoolMembership[] = [];

  for (const [pool, platforms] of Object.entries(poolPlatformLabels)) {
    for (const platform of platforms) {
      memberships.push({ pool, platform });
    }
  }

  return memberships;
}

// IDEAL: Backend provides /api/resources/{name} (Issue: BACKEND_TODOS.md#9)
export function useResourceDetail(
  resource: Resource | null,
  /** Pool context - used to determine initial selected pool */
  contextPool?: string,
) {
  // Fetch pool memberships for consistent UI across all entry points
  const resourcesQuery = useGetResourcesApiResourcesGet(
    { all_pools: true },
    {
      query: {
        enabled: !!resource?.name,
        staleTime: QUERY_STALE_TIME_EXPENSIVE_MS,
      },
    },
  );

  // Fetch all pools to get platform configs for task configuration display
  const poolsQuery = useGetPoolQuotasApiPoolQuotaGet(
    { all_pools: true },
    {
      query: {
        enabled: !!resource?.name,
        staleTime: QUERY_STALE_TIME_EXPENSIVE_MS,
      },
    },
  );

  const result = useMemo(() => {
    if (!resource) {
      return {
        pools: [] as string[],
        initialPool: null as string | null,
        taskConfigByPool: {} as Record<string, TaskConfig>,
      };
    }

    // Get pool memberships - prefer fetched data over resource's initial data
    let memberships = resource.poolMemberships;
    if (resourcesQuery.data) {
      const fetched = extractPoolMemberships(resourcesQuery.data, resource.name);
      if (fetched.length > 0) {
        memberships = fetched;
      }
    }

    // Get unique pool names, always sorted using natural/alphanumeric order
    const pools = [...new Set(memberships.map((m) => m.pool))].sort((a, b) => naturalCompare(a, b));

    // Initial pool: if context pool exists and is valid, use it; otherwise first alphabetically
    const initialPool = contextPool && pools.includes(contextPool) ? contextPool : (pools[0] ?? null);

    // Build task config for each pool
    const taskConfigByPool: Record<string, TaskConfig> = {};

    if (poolsQuery.data) {
      const allPools = transformPoolsResponse(poolsQuery.data).pools;
      const poolsMap = new Map(allPools.map((p: Pool) => [p.name, p]));

      for (const poolName of pools) {
        const pool = poolsMap.get(poolName);
        if (pool) {
          const platformConfig = pool.platformConfigs[resource.platform];
          if (platformConfig) {
            taskConfigByPool[poolName] = {
              hostNetworkAllowed: platformConfig.hostNetworkAllowed,
              privilegedAllowed: platformConfig.privilegedAllowed,
              allowedMounts: platformConfig.allowedMounts,
              defaultMounts: platformConfig.defaultMounts,
            };
          }
        }
      }
    }

    return { pools, initialPool, taskConfigByPool };
  }, [resource, resourcesQuery.data, poolsQuery.data, contextPool]);

  return {
    pools: result.pools,
    initialPool: result.initialPool,
    taskConfigByPool: result.taskConfigByPool,
    isLoadingPools: resourcesQuery.isLoading || poolsQuery.isLoading,
    error: resourcesQuery.error || poolsQuery.error,
    refetch: () => {
      resourcesQuery.refetch();
      poolsQuery.refetch();
    },
  };
}

import { useGetWorkflowApiWorkflowNameGet, type WorkflowQueryResponse } from "../generated";

interface UseWorkflowParams {
  name: string;
  verbose?: boolean;
}

interface UseWorkflowReturn {
  workflow: WorkflowQueryResponse | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  isNotFound: boolean;
}

// WORKAROUND: Timestamps need normalization (Issue: BACKEND_TODOS.md#16) and string parsing (Issue: BACKEND_TODOS.md#1)
//
// This hook uses TanStack Query's built-in structural sharing to prevent infinite re-renders
// when the backend returns semantically identical data with new object references.
// The `select` option with `structuralSharing: true` (enabled globally) performs automatic
// deep equality checks and preserves references when data is semantically identical.
export function useWorkflow({ name, verbose = true }: UseWorkflowParams): UseWorkflowReturn {
  // Parse and transform the workflow response using TanStack Query's select option
  // WORKAROUND: API returns string that needs parsing (BACKEND_TODOS.md#1)
  // WORKAROUND: Timestamps may lack timezone suffix (BACKEND_TODOS.md#16)
  const { data, isLoading, error, refetch } = useGetWorkflowApiWorkflowNameGet(
    name,
    { verbose },
    {
      query: {
        // Transform at query level - structural sharing prevents re-renders on identical data
        select: useCallback((rawData: string) => {
          if (!rawData) return null;
          try {
            const parsed = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
            // Normalize timestamps at the API boundary so UI gets clean data
            return normalizeWorkflowTimestamps(parsed) as WorkflowQueryResponse;
          } catch {
            console.error("Failed to parse workflow response:", rawData);
            return null;
          }
        }, []),
        // Note: structuralSharing is already enabled globally in query-client.ts
        // This performs automatic deep equality checks and preserves references
        // when data is semantically identical, preventing unnecessary re-renders
      },
    },
  );

  // Check if workflow was not found (404 error)
  const isNotFound = useMemo(() => {
    if (!error) return false;
    const status = (error as { status?: number })?.status;
    return status === 404;
  }, [error]);

  return {
    workflow: data ?? null,
    isLoading,
    error: error as Error | null,
    refetch,
    isNotFound,
  };
}
