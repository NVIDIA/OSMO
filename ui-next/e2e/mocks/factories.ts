// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Type-safe mock data factories.
 *
 * These factories use the generated types from the OpenAPI spec,
 * ensuring mock data stays in sync with the backend API contract.
 *
 * When the OpenAPI spec changes:
 * 1. Run `pnpm generate-api`
 * 2. TypeScript will show errors if factories are out of sync
 * 3. Fix the factories to match new types
 */

import {
  // Enums - use these instead of string literals
  BackendResourceType,
  PoolStatus,
  // Types - ensure mock data matches actual API contract
  type PoolResourceUsage,
  type ResourcesEntry,
  type PoolResponse,
  type ResourcesResponse,
  type ResourceUsage,
  type LoginInfo,
} from "@/lib/api/generated";

// Version type from adapter (not in generated - backend returns unknown)
import type { Version } from "@/lib/api/adapter/types";

// =============================================================================
// Constants for realistic data (using real-world units)
// =============================================================================

const GiB_IN_KiB = 1024 * 1024;
const TiB_IN_BYTES = 1024 * 1024 * 1024 * 1024;

// =============================================================================
// Helper: Complete ResourceUsage
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
// Auth Factories (using generated LoginInfo type)
// =============================================================================

/**
 * Create a LoginInfo response for auth scenarios.
 * Note: auth_enabled is added by our backend, not in base OpenAPI spec.
 */
export function createLoginInfo(
  overrides: Partial<LoginInfo & { auth_enabled?: boolean }> = {}
): LoginInfo & { auth_enabled: boolean } {
  return {
    auth_enabled: false,
    device_endpoint: "http://localhost:8080/device",
    device_client_id: "osmo-device-flow",
    browser_endpoint: "http://localhost:8080/auth",
    browser_client_id: "osmo-browser-flow",
    token_endpoint: "http://localhost:8080/token",
    logout_endpoint: "http://localhost:8080/logout",
    ...overrides,
  };
}

// =============================================================================
// Version Factory (Version type from adapter)
// =============================================================================

/**
 * Create a Version response.
 */
export function createVersion(overrides: Partial<Version> = {}): Version {
  return {
    major: "2",
    minor: "5",
    revision: "1",
    hash: "a1b2c3d4",
    ...overrides,
  };
}

// =============================================================================
// Pool Factories (using generated types and PoolStatus enum)
// =============================================================================

/**
 * Create a type-safe pool resource usage object.
 * Uses PoolStatus enum from generated code.
 */
export function createPoolResourceUsage(
  overrides: Partial<PoolResourceUsage> = {}
): PoolResourceUsage {
  const defaults: PoolResourceUsage = {
    name: "test-pool",
    description: "Test pool for E2E testing",
    status: PoolStatus.ONLINE, // Use generated enum
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

  // Merge resource_usage properly
  const merged = { ...defaults, ...overrides };
  if (overrides.resource_usage) {
    merged.resource_usage = createResourceUsage(overrides.resource_usage);
  }
  return merged;
}

/**
 * Create a complete pool response with multiple pools.
 * Uses PoolStatus enum from generated code.
 */
export function createPoolResponse(
  pools: Partial<PoolResourceUsage>[] = []
): PoolResponse {
  const defaultPools = pools.length > 0
    ? pools.map((p, i) => createPoolResourceUsage({ name: `pool-${i + 1}`, ...p }))
    : [
        createPoolResourceUsage({ name: "production", status: PoolStatus.ONLINE }),
        createPoolResourceUsage({ name: "development", status: PoolStatus.ONLINE }),
        createPoolResourceUsage({ name: "staging", status: PoolStatus.OFFLINE }),
      ];

  // Calculate aggregate resource_sum
  const resourceSum = createResourceUsage({
    quota_used: String(defaultPools.reduce((sum, p) => sum + parseInt(p.resource_usage?.quota_used ?? "0"), 0)),
    quota_free: String(defaultPools.reduce((sum, p) => sum + parseInt(p.resource_usage?.quota_free ?? "0"), 0)),
    quota_limit: String(defaultPools.reduce((sum, p) => sum + parseInt(p.resource_usage?.quota_limit ?? "0"), 0)),
    total_usage: String(defaultPools.reduce((sum, p) => sum + parseInt(p.resource_usage?.total_usage ?? "0"), 0)),
    total_capacity: String(defaultPools.reduce((sum, p) => sum + parseInt(p.resource_usage?.total_capacity ?? "0"), 0)),
    total_free: String(defaultPools.reduce((sum, p) => sum + parseInt(p.resource_usage?.total_free ?? "0"), 0)),
  });

  return {
    node_sets: [{ pools: defaultPools }],
    resource_sum: resourceSum,
  };
}

// =============================================================================
// Resource Factories (using generated types and BackendResourceType enum)
// =============================================================================

/**
 * Create a type-safe resource entry.
 * Uses BackendResourceType enum from generated code.
 */
export function createResourceEntry(
  overrides: Partial<ResourcesEntry> = {}
): ResourcesEntry {
  const nodeName = overrides.hostname?.split(".")[0] || "test-node-001";

  const defaults: ResourcesEntry = {
    hostname: `${nodeName}.cluster.local`,
    resource_type: BackendResourceType.SHARED, // Use generated enum
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
 * Create a complete resources response with multiple resources.
 * Uses BackendResourceType enum from generated code.
 */
export function createResourcesResponse(
  resources: Partial<ResourcesEntry>[] = []
): ResourcesResponse {
  const defaultResources = resources.length > 0
    ? resources.map((r, i) => createResourceEntry({
        hostname: `node-${String(i + 1).padStart(3, "0")}.cluster.local`,
        ...r,
      }))
    : [
        createResourceEntry({ hostname: "dgx-001.cluster.local", resource_type: BackendResourceType.SHARED }),
        createResourceEntry({ hostname: "dgx-002.cluster.local", resource_type: BackendResourceType.RESERVED }),
        createResourceEntry({ hostname: "dgx-003.cluster.local", resource_type: BackendResourceType.SHARED }),
      ];

  return { resources: defaultResources };
}

// =============================================================================
// Scenario Factories - Pre-built realistic scenarios
// Uses all generated enums for type safety
// =============================================================================

/**
 * Create a production-like pool response with varied data.
 * Uses PoolStatus and BackendResourceType from generated code.
 */
export function createProductionScenario() {
  return {
    pools: createPoolResponse([
      {
        name: "production",
        description: "Production GPU cluster",
        status: PoolStatus.ONLINE,
        resource_usage: {
          quota_used: "45",
          quota_free: "55",
          quota_limit: "100",
          total_usage: "128",
          total_capacity: "256",
          total_free: "128",
        },
        platforms: {
          dgx: { description: "DGX A100 nodes", host_network_allowed: true },
          dgx_h100: { description: "DGX H100 nodes", host_network_allowed: true },
        },
      },
      {
        name: "development",
        description: "Development environment",
        status: PoolStatus.ONLINE,
        resource_usage: {
          quota_used: "12",
          quota_free: "38",
          quota_limit: "50",
          total_usage: "24",
          total_capacity: "64",
          total_free: "40",
        },
        platforms: {
          base: { description: "Standard nodes" },
          gpu: { description: "GPU nodes" },
        },
      },
      {
        name: "maintenance",
        description: "Under maintenance",
        status: PoolStatus.MAINTENANCE, // Use MAINTENANCE status
        resource_usage: {
          quota_used: "0",
          quota_free: "0",
          quota_limit: "20",
          total_usage: "0",
          total_capacity: "0",
          total_free: "0",
        },
        platforms: {},
      },
    ]),
    resources: createResourcesResponse([
      // Production DGX nodes
      {
        hostname: "dgx-a100-001.prod.nvidia.com",
        resource_type: BackendResourceType.SHARED,
        exposed_fields: {
          node: "dgx-a100-001",
          "pool/platform": ["production/dgx", "development/gpu"],
        },
        allocatable_fields: { gpu: 8, cpu: 128, memory: 512 * GiB_IN_KiB, storage: 2 * TiB_IN_BYTES },
        usage_fields: { gpu: 6, cpu: 96, memory: 384 * GiB_IN_KiB, storage: 1.2 * TiB_IN_BYTES },
        pool_platform_labels: { production: ["dgx"], development: ["gpu"] },
      },
      {
        hostname: "dgx-a100-002.prod.nvidia.com",
        resource_type: BackendResourceType.RESERVED,
        exposed_fields: {
          node: "dgx-a100-002",
          "pool/platform": ["production/dgx"],
        },
        allocatable_fields: { gpu: 8, cpu: 128, memory: 512 * GiB_IN_KiB, storage: 2 * TiB_IN_BYTES },
        usage_fields: { gpu: 8, cpu: 128, memory: 480 * GiB_IN_KiB, storage: 1.8 * TiB_IN_BYTES },
        pool_platform_labels: { production: ["dgx"] },
      },
      {
        hostname: "dgx-h100-001.prod.nvidia.com",
        resource_type: BackendResourceType.RESERVED,
        exposed_fields: {
          node: "dgx-h100-001",
          "pool/platform": ["production/dgx_h100"],
        },
        allocatable_fields: { gpu: 8, cpu: 256, memory: 1024 * GiB_IN_KiB, storage: 4 * TiB_IN_BYTES },
        usage_fields: { gpu: 8, cpu: 256, memory: 1000 * GiB_IN_KiB, storage: 3.5 * TiB_IN_BYTES },
        pool_platform_labels: { production: ["dgx_h100"] },
      },
      // Development nodes
      {
        hostname: "dev-gpu-001.dev.nvidia.com",
        resource_type: BackendResourceType.SHARED,
        exposed_fields: {
          node: "dev-gpu-001",
          "pool/platform": ["development/gpu", "development/base"],
        },
        allocatable_fields: { gpu: 4, cpu: 64, memory: 256 * GiB_IN_KiB, storage: 1 * TiB_IN_BYTES },
        usage_fields: { gpu: 2, cpu: 32, memory: 128 * GiB_IN_KiB, storage: 0.3 * TiB_IN_BYTES },
        pool_platform_labels: { development: ["gpu", "base"] },
      },
      // Node with issues
      {
        hostname: "dgx-a100-003.prod.nvidia.com",
        resource_type: BackendResourceType.SHARED,
        conditions: ["Ready", "SchedulingDisabled", "MemoryPressure"],
        exposed_fields: {
          node: "dgx-a100-003",
          "pool/platform": ["production/dgx"],
        },
        allocatable_fields: { gpu: 8, cpu: 128, memory: 512 * GiB_IN_KiB, storage: 2 * TiB_IN_BYTES },
        usage_fields: { gpu: 8, cpu: 128, memory: 510 * GiB_IN_KiB, storage: 1.9 * TiB_IN_BYTES },
        pool_platform_labels: { production: ["dgx"] },
      },
    ]),
    version: createVersion(),
    loginInfo: createLoginInfo({ auth_enabled: false }),
  };
}

/**
 * Create an empty state scenario (no resources).
 * Uses PoolStatus enum from generated code.
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
    version: createVersion(),
    loginInfo: createLoginInfo({ auth_enabled: false }),
  };
}

/**
 * Create a high utilization scenario.
 * Uses PoolStatus and BackendResourceType from generated code.
 */
export function createHighUtilizationScenario() {
  return {
    pools: createPoolResponse([
      {
        name: "overloaded",
        description: "Fully utilized pool",
        status: PoolStatus.ONLINE,
        resource_usage: {
          quota_used: "95",
          quota_free: "5",
          quota_limit: "100",
          total_usage: "190",
          total_capacity: "200",
          total_free: "10",
        },
      },
    ]),
    resources: createResourcesResponse([
      {
        hostname: "overloaded-001.cluster.local",
        resource_type: BackendResourceType.SHARED,
        conditions: ["Ready", "SchedulingEnabled", "MemoryPressure"],
        allocatable_fields: { gpu: 8, cpu: 128, memory: 512 * GiB_IN_KiB, storage: 2 * TiB_IN_BYTES },
        usage_fields: { gpu: 8, cpu: 126, memory: 500 * GiB_IN_KiB, storage: 1.9 * TiB_IN_BYTES },
      },
    ]),
    version: createVersion(),
    loginInfo: createLoginInfo({ auth_enabled: false }),
  };
}

// =============================================================================
// Re-export generated enums for test files to use
// =============================================================================

export { BackendResourceType, PoolStatus } from "@/lib/api/generated";
