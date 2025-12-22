/**
 * React Query hooks with automatic transformation to ideal types.
 *
 * UI components should use these hooks instead of the generated ones.
 * These hooks:
 * - Call the generated API hooks
 * - Transform responses to ideal types
 * - Return clean, well-typed data
 */

import { useMemo } from "react";
import {
  useGetPoolQuotasApiPoolQuotaGet,
  useGetResourcesApiResourcesGet,
  useGetVersionApiVersionGet,
} from "../generated";
import { QUERY_STALE_TIME_EXPENSIVE_MS } from "@/lib/config";
import { BackendResourceType } from "../generated";

import {
  transformPoolsResponse,
  transformPoolDetail,
  transformResourcesResponse,
  transformAllResourcesResponse,
  transformVersionResponse,
} from "./transforms";

import type { PoolResourcesResponse, AllResourcesResponse } from "./types";

// =============================================================================
// Pool Hooks
// =============================================================================

/**
 * Fetch all pools.
 * Returns ideal Pool[] type with proper numbers and typed fields.
 */
export function usePools() {
  const query = useGetPoolQuotasApiPoolQuotaGet({ all_pools: true });

  const pools = useMemo(() => {
    if (!query.data) return [];
    return transformPoolsResponse(query.data).pools;
  }, [query.data]);

  return {
    pools,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Fetch a single pool by name.
 * Returns ideal Pool type or null if not found.
 */
export function usePool(poolName: string) {
  const query = useGetPoolQuotasApiPoolQuotaGet({
    pools: [poolName],
    all_pools: false,
  });

  const pool = useMemo(() => {
    if (!query.data) return null;
    return transformPoolDetail(query.data, poolName);
  }, [query.data, poolName]);

  return {
    pool,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

// =============================================================================
// Resource Hooks
// =============================================================================

/**
 * Fetch resources for a specific pool.
 * Returns ideal Resource[] with proper capacity types.
 */
export function usePoolResources(poolName: string) {
  const query = useGetResourcesApiResourcesGet({
    pools: [poolName],
    all_pools: false,
  });

  const result = useMemo((): PoolResourcesResponse => {
    if (!query.data) return { resources: [], platforms: [] };
    return transformResourcesResponse(query.data, poolName);
  }, [query.data, poolName]);

  return {
    resources: result.resources,
    platforms: result.platforms,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Fetch all resources across all pools.
 * Returns ideal Resource[] with proper capacity types.
 */
export function useAllResources() {
  const query = useGetResourcesApiResourcesGet({
    all_pools: true,
  });

  const result = useMemo((): AllResourcesResponse => {
    if (!query.data) return { resources: [], pools: [], platforms: [] };
    return transformAllResourcesResponse(query.data);
  }, [query.data]);

  return {
    resources: result.resources,
    pools: result.pools,
    platforms: result.platforms,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

// =============================================================================
// Version Hook
// =============================================================================

/**
 * Fetch OSMO version information.
 * Returns ideal Version type.
 */
export function useVersion() {
  const query = useGetVersionApiVersionGet();

  const version = useMemo(() => {
    if (!query.data) return null;
    return transformVersionResponse(query.data);
  }, [query.data]);

  return {
    version,
    isLoading: query.isLoading,
    error: query.error,
  };
}

// =============================================================================
// Resource Detail Hook
// =============================================================================

import type { PoolMembership, Resource, PlatformConfig, TaskConfig, Pool } from "./types";
import type { ResourcesResponse } from "../generated";

/**
 * Extract pool memberships from a ResourcesResponse for a specific resource.
 * 
 * WORKAROUND: When querying /api/resources with specific pools, the response's
 * `pool_platform_labels` only contains memberships for those pools. To get ALL
 * memberships for a resource, we must query with `all_pools=true`.
 * 
 * Issue: BACKEND_TODOS.md#7
 */
function extractPoolMemberships(
  data: unknown,
  resourceName: string
): PoolMembership[] {
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

/**
 * Hook for resource detail panel.
 * 
 * Encapsulates all business logic for displaying resource details:
 * - Fetches full pool memberships for all resources
 * - Fetches all pools to get platform configs
 * - Computes unique pool names for display
 * - Extracts task config for each pool the resource belongs to
 * 
 * IDEAL: Backend provides single `/api/resources/{name}` endpoint with all data.
 * Issue: BACKEND_TODOS.md#9
 */
export function useResourceDetail(
  resource: Resource | null,
  /** @deprecated - no longer used, platform configs are fetched from pools */
  _platformConfigs: Record<string, PlatformConfig> = {},
  /** Pool context - used to determine initial selected pool */
  contextPool?: string
) {
  // Fetch pool memberships for consistent UI across all entry points
  const resourcesQuery = useGetResourcesApiResourcesGet(
    { all_pools: true },
    {
      query: {
        enabled: !!resource?.name,
        staleTime: QUERY_STALE_TIME_EXPENSIVE_MS,
      },
    }
  );

  // Fetch all pools to get platform configs for task configuration display
  const poolsQuery = useGetPoolQuotasApiPoolQuotaGet(
    { all_pools: true },
    {
      query: {
        enabled: !!resource?.name,
        staleTime: QUERY_STALE_TIME_EXPENSIVE_MS,
      },
    }
  );

  const result = useMemo(() => {
    if (!resource) {
      return {
        pools: [] as string[],
        initialPool: null as string | null,
        taskConfigByPool: {} as Record<string, TaskConfig>,
        // Legacy support
        primaryPool: null as string | null,
        taskConfig: null as TaskConfig | null,
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
    
    // Get unique pool names, always sorted alphabetically
    const pools = [...new Set(memberships.map((m) => m.pool))].sort((a, b) =>
      a.localeCompare(b)
    );

    // Initial pool: if context pool exists and is valid, use it; otherwise first alphabetically
    const initialPool = contextPool && pools.includes(contextPool)
      ? contextPool
      : pools[0] ?? null;

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

    // Legacy support: primaryPool and taskConfig for backward compatibility
    const primaryPool = contextPool && pools.includes(contextPool)
      ? contextPool
      : null;
    const taskConfig = initialPool ? taskConfigByPool[initialPool] ?? null : null;

    return { pools, initialPool, taskConfigByPool, primaryPool, taskConfig };
  }, [resource, resourcesQuery.data, poolsQuery.data, contextPool]);

  return {
    pools: result.pools,
    initialPool: result.initialPool,
    taskConfigByPool: result.taskConfigByPool,
    isLoadingPools: resourcesQuery.isLoading || poolsQuery.isLoading,
    // Legacy support
    primaryPool: result.primaryPool,
    taskConfig: result.taskConfig,
  };
}
