/**
 * Transformed types - the shape of data after backend quirks are fixed.
 *
 * These interfaces define what transforms.ts produces.
 * For enums that backend returns correctly, import from generated.ts directly.
 *
 * Some types (like workflow types) are re-exported unchanged from generated.ts
 * because the UI should import all types from adapter, not generated.ts.
 */

import type { PoolStatus, BackendResourceType } from "../generated";

// =============================================================================
// Re-exported Types (unchanged from generated, but exposed via adapter for stability)
// =============================================================================

// Workflow types - re-exported for stable API
// These don't need transformation but UI should import from adapter
export type {
  WorkflowQueryResponse,
  GroupQueryResponse,
  TaskQueryResponse,
  SrcServiceCoreWorkflowObjectsListEntry as WorkflowListEntry,
} from "../generated";

// =============================================================================
// Pool Types
// =============================================================================

/**
 * Quota/usage information with proper numeric types.
 */
export interface Quota {
  used: number;
  free: number;
  limit: number;
  totalUsage: number;
  totalCapacity: number;
  totalFree: number;
}

/**
 * Platform configuration within a pool.
 * Contains task configuration settings.
 */
export interface PlatformConfig {
  description?: string;
  hostNetworkAllowed: boolean;
  privilegedAllowed: boolean;
  allowedMounts: string[];
  defaultMounts: string[];
}

/**
 * GPU scheduling resources for a pool.
 * Used by schedulers that support resource allocation.
 */
export interface GpuResources {
  /** Guaranteed number of GPUs (-1 means no limit) */
  guarantee: number | null;
  /** Maximum number of GPUs (-1 means no limit) */
  maximum: number | null;
  /** Scheduling weight for fair-share scheduling */
  weight: number | null;
}

/**
 * Timeout configuration for a pool.
 */
export interface TimeoutConfig {
  /** Default execution timeout (e.g., "24h") */
  defaultExec: string | null;
  /** Maximum execution timeout */
  maxExec: string | null;
  /** Default queue timeout */
  defaultQueue: string | null;
  /** Maximum queue timeout */
  maxQueue: string | null;
}

/**
 * A pool with all the information the UI needs to display it.
 */
export interface Pool {
  name: string;
  description: string;
  status: PoolStatus; // From generated.ts
  quota: Quota;
  platforms: string[];
  /** Platform configurations keyed by platform name */
  platformConfigs: Record<string, PlatformConfig>;
  backend: string;
  /** Default platform for this pool */
  defaultPlatform: string | null;
  /** GPU scheduling resources */
  gpuResources: GpuResources;
  /** Timeout configuration */
  timeouts: TimeoutConfig;
  /** Default exit actions (e.g., { "error": "retry", "oom": "fail" }) */
  defaultExitActions: Record<string, string>;
}

/**
 * Response from the pools list endpoint.
 */
export interface PoolsResponse {
  pools: Pool[];
  /**
   * Groups of pool names that share physical GPU capacity.
   * Pools in the same node_set share totalCapacity/totalFree.
   * Example: [["pool-a", "pool-b"], ["pool-c", "pool-d"]]
   */
  sharingGroups: string[][];
}

// =============================================================================
// Resource Types
// =============================================================================

/**
 * Resource capacity for a specific resource type (gpu, cpu, etc).
 */
export interface ResourceCapacity {
  used: number;
  total: number;
}

/**
 * Pool membership for a resource (which pools/platforms a resource belongs to).
 */
export interface PoolMembership {
  pool: string;
  platform: string;
}

/**
 * Task configuration from the platform.
 * This comes from the pool's platform configuration.
 */
export interface TaskConfig {
  hostNetworkAllowed: boolean;
  privilegedAllowed: boolean;
  allowedMounts: string[];
  defaultMounts: string[];
}

/**
 * A resource entry with all relevant information.
 * Represents a compute resource (machine) that can run workflows.
 */
export interface Resource {
  hostname: string;
  /** Resource name (corresponds to Kubernetes node name) */
  name: string;
  platform: string;
  resourceType: BackendResourceType; // From generated.ts
  backend: string;
  gpu: ResourceCapacity;
  cpu: ResourceCapacity;
  memory: ResourceCapacity;
  storage: ResourceCapacity;
  conditions: string[];
  /** All pools/platforms this resource is a member of */
  poolMemberships: PoolMembership[];
}

/**
 * Response from the resources endpoint for a specific pool.
 */
export interface PoolResourcesResponse {
  resources: Resource[];
  platforms: string[];
}

/**
 * Response from the resources endpoint when querying all pools.
 */
export interface AllResourcesResponse {
  resources: Resource[];
  pools: string[];
  platforms: string[];
}

// =============================================================================
// Version Types
// =============================================================================

/**
 * OSMO version information.
 */
export interface Version {
  major: string;
  minor: string;
  revision: string;
  hash?: string;
}
