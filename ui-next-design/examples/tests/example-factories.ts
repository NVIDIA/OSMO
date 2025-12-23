/**
 * EXAMPLE: Test Mock Factories
 * 
 * Type-safe factories for creating mock data in E2E tests.
 * Use generated enums (PoolStatus, BackendResourceType) instead of strings.
 */

import {
  BackendResourceType,
  PoolStatus,
  type PoolResourceUsage,
  type ResourcesEntry,
  type PoolResponse,
  type ResourcesResponse,
  type ResourceUsage,
} from "@/lib/api/generated";

// =============================================================================
// Constants
// =============================================================================

const GiB_IN_KiB = 1024 * 1024;
const TiB_IN_BYTES = 1024 * 1024 * 1024 * 1024;

// =============================================================================
// Helper: Resource Usage
// =============================================================================

function createResourceUsage(partial: Partial<ResourceUsage> = {}): ResourceUsage {
  return {
    quota_used: partial.quota_used ?? "25",
    quota_free: partial.quota_free ?? "75",
    quota_limit: partial.quota_limit ?? "100",
    total_usage: partial.total_usage ?? "50",
    total_capacity: partial.total_capacity ?? "200",
    total_free: partial.total_free ?? "150",
  };
}

// =============================================================================
// Pool Factories
// =============================================================================

/**
 * Create a single pool entry.
 */
export function createPoolResourceUsage(
  overrides: Partial<PoolResourceUsage> = {}
): PoolResourceUsage {
  const defaults: PoolResourceUsage = {
    name: "test-pool",
    description: "Test pool for E2E testing",
    status: PoolStatus.ONLINE, // Use generated enum!
    backend: "k8s-test",
    resource_usage: createResourceUsage(),
    platforms: {
      base: {
        description: "Base platform",
        host_network_allowed: false,
        privileged_allowed: false,
        allowed_mounts: ["/data"],
        default_mounts: [],
      },
    },
  };

  const merged = { ...defaults, ...overrides };
  if (overrides.resource_usage) {
    merged.resource_usage = createResourceUsage(overrides.resource_usage);
  }
  return merged;
}

/**
 * Create a complete pool response with multiple pools.
 * 
 * @example
 * createPoolResponse([
 *   { name: "prod", status: PoolStatus.ONLINE },
 *   { name: "dev", status: PoolStatus.OFFLINE },
 * ])
 */
export function createPoolResponse(
  pools: Partial<PoolResourceUsage>[] = []
): PoolResponse {
  const poolList = pools.length > 0
    ? pools.map((p, i) => createPoolResourceUsage({ name: `pool-${i + 1}`, ...p }))
    : [
        createPoolResourceUsage({ name: "production", status: PoolStatus.ONLINE }),
        createPoolResourceUsage({ name: "development", status: PoolStatus.ONLINE }),
      ];

  // Calculate aggregate
  const resourceSum = createResourceUsage({
    quota_used: String(poolList.reduce((sum, p) => 
      sum + parseInt(p.resource_usage?.quota_used ?? "0"), 0)),
    quota_free: String(poolList.reduce((sum, p) => 
      sum + parseInt(p.resource_usage?.quota_free ?? "0"), 0)),
  });

  return {
    node_sets: [{ pools: poolList }],
    resource_sum: resourceSum,
  };
}

// =============================================================================
// Resource Factories
// =============================================================================

/**
 * Create a single resource entry.
 */
export function createResourceEntry(
  overrides: Partial<ResourcesEntry> = {}
): ResourcesEntry {
  const nodeName = overrides.hostname?.split(".")[0] || "test-node-001";

  const defaults: ResourcesEntry = {
    hostname: `${nodeName}.cluster.local`,
    resource_type: BackendResourceType.SHARED, // Use generated enum!
    backend: "k8s-test",
    conditions: ["Ready", "SchedulingEnabled"],
    taints: [],
    non_workflow_usage_fields: {},
    exposed_fields: {
      node: nodeName,
      "pool/platform": ["test-pool/base"],
    },
    allocatable_fields: {
      gpu: 8,
      cpu: 128,
      memory: 512 * GiB_IN_KiB,
      storage: 2 * TiB_IN_BYTES,
    },
    usage_fields: {
      gpu: 4,
      cpu: 64,
      memory: 256 * GiB_IN_KiB,
      storage: 1 * TiB_IN_BYTES,
    },
    pool_platform_labels: {
      "test-pool": ["base"],
    },
  };

  return { ...defaults, ...overrides };
}

/**
 * Create a complete resources response.
 * 
 * @example
 * createResourcesResponse([
 *   { hostname: "dgx-001.cluster", resource_type: BackendResourceType.SHARED },
 *   { hostname: "dgx-002.cluster", resource_type: BackendResourceType.RESERVED },
 * ])
 */
export function createResourcesResponse(
  resources: Partial<ResourcesEntry>[] = []
): ResourcesResponse {
  const resourceList = resources.length > 0
    ? resources.map((r, i) => createResourceEntry({
        hostname: `node-${String(i + 1).padStart(3, "0")}.cluster.local`,
        ...r,
      }))
    : [
        createResourceEntry({ hostname: "dgx-001.cluster.local" }),
        createResourceEntry({ hostname: "dgx-002.cluster.local" }),
      ];

  return { resources: resourceList };
}

// =============================================================================
// Scenario Factories - Pre-built for common test cases
// =============================================================================

/**
 * Production-like scenario with multiple pools and resources.
 */
export function createProductionScenario() {
  return {
    pools: createPoolResponse([
      {
        name: "production",
        description: "Production GPU cluster",
        status: PoolStatus.ONLINE,
        platforms: {
          dgx: { description: "DGX A100 nodes" },
          dgx_h100: { description: "DGX H100 nodes" },
        },
      },
      {
        name: "development",
        description: "Development environment",
        status: PoolStatus.ONLINE,
      },
      {
        name: "maintenance",
        description: "Under maintenance",
        status: PoolStatus.MAINTENANCE,
      },
    ]),
    resources: createResourcesResponse([
      {
        hostname: "dgx-a100-001.prod.nvidia.com",
        resource_type: BackendResourceType.SHARED,
        exposed_fields: { node: "dgx-a100-001", "pool/platform": ["production/dgx"] },
        pool_platform_labels: { production: ["dgx"] },
      },
      {
        hostname: "dgx-a100-002.prod.nvidia.com",
        resource_type: BackendResourceType.RESERVED,
        exposed_fields: { node: "dgx-a100-002", "pool/platform": ["production/dgx"] },
        pool_platform_labels: { production: ["dgx"] },
      },
    ]),
  };
}

/**
 * Empty state scenario.
 */
export function createEmptyScenario() {
  return {
    pools: createPoolResponse([
      {
        name: "empty-pool",
        description: "Pool with no resources",
        status: PoolStatus.ONLINE,
        resource_usage: {
          quota_used: "0",
          quota_free: "100",
          quota_limit: "100",
          total_usage: "0",
          total_capacity: "0",
          total_free: "0",
        },
      },
    ]),
    resources: createResourcesResponse([]),
  };
}

// Re-export enums for convenience
export { BackendResourceType, PoolStatus } from "@/lib/api/generated";
