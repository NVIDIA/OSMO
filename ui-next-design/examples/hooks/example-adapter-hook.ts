/**
 * EXAMPLE: Adapter Hook Pattern
 * 
 * Adapter hooks wrap generated API hooks and transform responses
 * to ideal types for the UI.
 */

import { useMemo } from "react";
import {
  useGetPoolQuotasApiPoolQuotaGet,
  useGetResourcesApiResourcesGet,
} from "../generated";
import { transformPoolsResponse, transformResourcesResponse } from "./transforms";
import type { Pool, PoolResourcesResponse } from "./types";

// =============================================================================
// Pool Hooks
// =============================================================================

/**
 * Fetch all pools.
 * Returns ideal Pool[] type with proper numbers and typed fields.
 */
export function usePools() {
  // Call generated hook
  const query = useGetPoolQuotasApiPoolQuotaGet({ all_pools: true });

  // Transform response to ideal types (memoized)
  const pools = useMemo(() => {
    if (!query.data) return [];
    return transformPoolsResponse(query.data).pools;
  }, [query.data]);

  // Return clean interface
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

  const pool = useMemo((): Pool | null => {
    if (!query.data) return null;
    const pools = transformPoolsResponse(query.data).pools;
    return pools.find((p) => p.name === poolName) ?? null;
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
 */
export function useAllResources() {
  const query = useGetResourcesApiResourcesGet({
    all_pools: true,
  });

  const result = useMemo(() => {
    if (!query.data) return { resources: [], pools: [], platforms: [] };
    // transformAllResourcesResponse extracts unique pools and platforms
    return transformResourcesResponse(query.data);
  }, [query.data]);

  return {
    resources: result.resources,
    pools: result.pools ?? [],
    platforms: result.platforms,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
