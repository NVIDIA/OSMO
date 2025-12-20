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

import {
  transformPoolsResponse,
  transformPoolDetail,
  transformResourcesResponse,
  transformVersionResponse,
} from "./transforms";

import type { PoolResourcesResponse } from "./types";

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
// Resource/Node Hooks
// =============================================================================

/**
 * Fetch resources/nodes for a specific pool.
 * Returns ideal Node[] with proper capacity types.
 */
export function usePoolResources(poolName: string) {
  const query = useGetResourcesApiResourcesGet({
    pools: [poolName],
    all_pools: false,
  });

  const result = useMemo((): PoolResourcesResponse => {
    if (!query.data) return { nodes: [], platforms: [] };
    return transformResourcesResponse(query.data, poolName);
  }, [query.data, poolName]);

  return {
    nodes: result.nodes,
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
// Node Detail Hook
// =============================================================================

import type { PoolMembership, Node, PlatformConfig, TaskConfig } from "./types";
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
  let resources: ResourcesResponse["resources"] = [];
  try {
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    resources = (parsed as ResourcesResponse)?.resources ?? [];
  } catch {
    return [];
  }

  const resource = resources.find((r) => {
    const nodeField = (r.exposed_fields as Record<string, unknown>)?.node;
    return r.hostname === resourceName || nodeField === resourceName;
  });

  if (!resource) return [];

  const poolPlatformLabels = resource.pool_platform_labels ?? {};
  const memberships: PoolMembership[] = [];

  for (const [pool, platforms] of Object.entries(poolPlatformLabels)) {
    for (const platform of platforms) {
      memberships.push({ pool, platform });
    }
  }

  return memberships;
}

/**
 * Hook for node detail panel.
 * 
 * Encapsulates all business logic for displaying node details:
 * - Fetches full pool memberships (only for SHARED resources)
 * - Computes unique pool names for display
 * - Extracts task config from platform configs
 * 
 * IDEAL: Backend provides single `/api/resources/{name}` endpoint with all data.
 * Issue: BACKEND_TODOS.md#9
 */
export function useNodeDetail(
  node: Node | null,
  platformConfigs: Record<string, PlatformConfig>
) {
  // Business logic: Only SHARED resources can belong to multiple pools
  // RESERVED resources belong to a single pool (shown in header), no need to display
  const isShared = node?.resourceType === "SHARED";
  
  const query = useGetResourcesApiResourcesGet(
    { all_pools: true },
    {
      query: {
        enabled: isShared && !!node?.nodeName,
        staleTime: 5 * 60 * 1000, // Cache 5 minutes (expensive query)
      },
    }
  );

  const result = useMemo(() => {
    if (!node) {
      return {
        pools: [] as string[],
        showPoolMembership: false,
        taskConfig: null as TaskConfig | null,
      };
    }

    // Only show pool membership for SHARED resources
    let pools: string[] = [];
    if (isShared) {
      let memberships = node.poolMemberships;
      if (query.data) {
        const fetched = extractPoolMemberships(query.data, node.nodeName);
        if (fetched.length > 0) {
          memberships = fetched;
        }
      }
      pools = [...new Set(memberships.map((m) => m.pool))];
    }

    // Get task config for current platform
    const platformConfig = platformConfigs[node.platform];
    const taskConfig: TaskConfig | null = platformConfig
      ? {
          hostNetworkAllowed: platformConfig.hostNetworkAllowed,
          privilegedAllowed: platformConfig.privilegedAllowed,
          allowedMounts: platformConfig.allowedMounts,
          defaultMounts: platformConfig.defaultMounts,
        }
      : null;

    return { pools, showPoolMembership: isShared, taskConfig };
  }, [node, query.data, isShared, platformConfigs]);

  return {
    pools: result.pools,
    showPoolMembership: result.showPoolMembership,
    taskConfig: result.taskConfig,
    isLoadingMemberships: isShared && query.isLoading,
  };
}
