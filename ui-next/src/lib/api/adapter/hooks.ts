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
// Single Resource Hook
// =============================================================================

import type { PoolMembership } from "./types";
import type { ResourcesResponse } from "../generated";

/**
 * Extract pool memberships from a ResourcesResponse for a specific resource.
 * 
 * WORKAROUND: When querying /api/resources with specific pools, the response's
 * `pool_platform_labels` only contains memberships for those pools. To get ALL
 * memberships for a resource, we must query with `all_pools=true`.
 * 
 * Issue: backend_todo.md#7-pool-platform-labels-filtered-by-query
 */
function extractPoolMemberships(
  data: unknown,
  resourceName: string
): PoolMembership[] {
  // Parse the response (typed as string in OpenAPI but actually JSON object)
  let resources: ResourcesResponse["resources"] = [];
  try {
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    resources = (parsed as ResourcesResponse)?.resources ?? [];
  } catch {
    return [];
  }

  // Find the specific resource by hostname or node name
  const resource = resources.find((r) => {
    const nodeField = (r.exposed_fields as Record<string, unknown>)?.node;
    return r.hostname === resourceName || nodeField === resourceName;
  });

  if (!resource) return [];

  // Extract all pool memberships from pool_platform_labels
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
 * Fetch full pool memberships for a specific resource.
 * 
 * This hook queries all pools to get complete membership information.
 * The result is cached for 5 minutes since this is an expensive query.
 * 
 * Note: Do NOT use `concise=true` as it returns aggregated pool stats
 * instead of individual resource entries.
 */
export function useResourceInfo(resourceName: string | null) {
  // Query all pools to get full membership info
  // Note: concise=true returns different structure (aggregated pools, not resources)
  const query = useGetResourcesApiResourcesGet(
    { all_pools: true },
    {
      query: {
        enabled: !!resourceName,
        // Cache aggressively since querying all pools is expensive
        staleTime: 5 * 60 * 1000, // 5 minutes
      },
    }
  );

  const poolMemberships = useMemo(() => {
    if (!query.data || !resourceName) return [];
    return extractPoolMemberships(query.data, resourceName);
  }, [query.data, resourceName]);

  return {
    poolMemberships,
    isLoading: query.isLoading,
    error: query.error,
  };
}
