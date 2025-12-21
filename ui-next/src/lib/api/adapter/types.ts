/**
 * Ideal types that the UI expects from the backend.
 *
 * These represent what a "perfect" backend API would return.
 * The adapter layer transforms actual backend responses into these types.
 *
 * When backend is fixed, these can be replaced with generated types directly.
 */

// =============================================================================
// Pool Types
// =============================================================================

/**
 * Status of a pool.
 * Uses uppercase to match backend enum values.
 */
export type PoolStatus = "ONLINE" | "OFFLINE" | "MAINTENANCE";

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
 * A pool with all the information the UI needs to display it.
 */
export interface Pool {
  name: string;
  description: string;
  status: PoolStatus;
  quota: Quota;
  platforms: string[];
  /** Platform configurations keyed by platform name */
  platformConfigs: Record<string, PlatformConfig>;
  backend: string;
}

/**
 * Response from the pools list endpoint.
 */
export interface PoolsResponse {
  pools: Pool[];
}

// =============================================================================
// Resource Types
// =============================================================================

/**
 * Type of resource allocation.
 */
export type ResourceType = "RESERVED" | "SHARED" | "UNUSED";

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
  resourceType: ResourceType;
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
 * Response from the resources endpoint for fleet-wide queries (all pools).
 */
export interface FleetResourcesResponse {
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
