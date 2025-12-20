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
 * A pool with all the information the UI needs to display it.
 */
export interface Pool {
  name: string;
  description: string;
  status: PoolStatus;
  quota: Quota;
  platforms: string[];
  backend: string;
}

/**
 * Response from the pools list endpoint.
 */
export interface PoolsResponse {
  pools: Pool[];
}

// =============================================================================
// Resource/Node Types
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
 * A node/resource entry with all relevant information.
 */
export interface Node {
  hostname: string;
  nodeName: string;
  platform: string;
  resourceType: ResourceType;
  backend: string;
  gpu: ResourceCapacity;
  cpu: ResourceCapacity;
  memory: ResourceCapacity;
  storage: ResourceCapacity;
  conditions: string[];
}

/**
 * Response from the resources endpoint for a specific pool.
 */
export interface PoolResourcesResponse {
  nodes: Node[];
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
