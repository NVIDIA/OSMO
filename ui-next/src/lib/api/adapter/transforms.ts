/**
 * Transform functions that convert backend responses to ideal types.
 *
 * ============================================================================
 * ⚠️  ALL BACKEND WORKAROUNDS ARE QUARANTINED HERE
 * ============================================================================
 *
 * This file contains all the shims, type casts, and workarounds needed
 * because the backend API doesn't match what the UI wants.
 *
 * Each transform function documents:
 * - What backend issue it works around
 * - What the ideal backend behavior would be
 * - Link to backend_todo.md issue
 *
 * When backend is fixed, these transforms can be simplified or removed.
 */

import {
  PoolStatus,
  BackendResourceType,
  type PoolResponse,
  type PoolResourceUsage,
  type ResourcesResponse,
  type ResourcesEntry,
} from "@/lib/api/generated";

import type {
  Pool,
  PoolsResponse,
  Quota,
  PlatformConfig,
  GpuResources,
  TimeoutConfig,
  Resource,
  PoolResourcesResponse,
  AllResourcesResponse,
  ResourceCapacity,
  PoolMembership,
  Version,
} from "@/lib/api/adapter/types";
import { naturalCompare } from "@/lib/utils";

// =============================================================================
// WORKAROUND: String to Number parsing
// Issue: backend_todo.md#2-resourceusage-fields-are-strings-instead-of-numbers
// Ideal: Backend returns numbers directly
// =============================================================================

function parseNumber(value: string | number | undefined | null): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === "number") return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

// =============================================================================
// WORKAROUND: Extract value from untyped dictionary
// Issue: backend_todo.md#5-resource-fields-use-untyped-dictionaries
// Ideal: Backend returns typed resource fields
// =============================================================================

function getFieldValue(fields: Record<string, unknown> | undefined, key: string): number {
  if (!fields) return 0;
  const value = fields[key];
  if (typeof value === "number") return Math.floor(value);
  if (typeof value === "string") return Math.floor(parseFloat(value)) || 0;
  return 0;
}

// =============================================================================
// WORKAROUND: Unit conversion for memory/storage
// Issue: backend_todo.md#6-memory-and-storage-values-need-conversion
// Ideal: Backend returns values in GiB consistently
// =============================================================================

const KIB_PER_GIB = 1024 * 1024; // Memory is in KiB
const BYTES_PER_GIB = 1024 * 1024 * 1024; // Storage is in bytes

/**
 * Convert KiB to GiB (memory is stored in KiB in Kubernetes).
 */
function kibToGiB(kib: number): number {
  if (kib === 0) return 0;
  return Math.round(kib / KIB_PER_GIB);
}

/**
 * Convert bytes to GiB (storage is stored in bytes).
 */
function bytesToGiB(bytes: number): number {
  if (bytes === 0) return 0;
  return Math.round(bytes / BYTES_PER_GIB);
}

// =============================================================================
// Pool Transforms
// =============================================================================

/**
 * Transform backend ResourceUsage to ideal Quota type.
 *
 * WORKAROUND: Backend returns all quota values as strings.
 * Issue: backend_todo.md#2-resourceusage-fields-are-strings-instead-of-numbers
 */
function transformQuota(usage: PoolResourceUsage["resource_usage"] | undefined): Quota {
  return {
    used: parseNumber(usage?.quota_used),
    free: parseNumber(usage?.quota_free),
    limit: parseNumber(usage?.quota_limit),
    totalUsage: parseNumber(usage?.total_usage),
    totalCapacity: parseNumber(usage?.total_capacity),
    totalFree: parseNumber(usage?.total_free),
  };
}

/**
 * Transform backend PlatformMinimal to ideal PlatformConfig.
 */
function transformPlatformConfig(
  platformName: string,
  platform: {
    description?: string;
    host_network_allowed?: boolean;
    privileged_allowed?: boolean;
    allowed_mounts?: string[];
    default_mounts?: string[];
  },
): PlatformConfig {
  return {
    description: platform.description,
    hostNetworkAllowed: platform.host_network_allowed ?? false,
    privilegedAllowed: platform.privileged_allowed ?? false,
    allowedMounts: platform.allowed_mounts ?? [],
    defaultMounts: platform.default_mounts ?? [],
  };
}

/**
 * Transform backend GPU resources to ideal GpuResources type.
 * Backend uses -1 to indicate "no limit", we convert to null for clarity.
 */
function transformGpuResources(resources: PoolResourceUsage["resources"]): GpuResources {
  const gpu = resources?.gpu;
  return {
    guarantee: gpu?.guarantee !== undefined && gpu.guarantee !== -1 ? gpu.guarantee : null,
    maximum: gpu?.maximum !== undefined && gpu.maximum !== -1 ? gpu.maximum : null,
    weight: gpu?.weight ?? null,
  };
}

/**
 * Transform backend timeout strings to ideal TimeoutConfig type.
 */
function transformTimeouts(backendPool: PoolResourceUsage): TimeoutConfig {
  return {
    defaultExec: backendPool.default_exec_timeout ?? null,
    maxExec: backendPool.max_exec_timeout ?? null,
    defaultQueue: backendPool.default_queue_timeout ?? null,
    maxQueue: backendPool.max_queue_timeout ?? null,
  };
}

/**
 * Transform backend PoolResourceUsage to ideal Pool type.
 */
function transformPool(backendPool: PoolResourceUsage): Pool {
  const platformConfigs: Record<string, PlatformConfig> = {};

  if (backendPool.platforms) {
    for (const [name, config] of Object.entries(backendPool.platforms)) {
      platformConfigs[name] = transformPlatformConfig(name, config);
    }
  }

  return {
    name: backendPool.name ?? "",
    description: backendPool.description ?? "",
    status: backendPool.status ?? PoolStatus.ONLINE,
    quota: transformQuota(backendPool.resource_usage),
    platforms: Object.keys(backendPool.platforms ?? {}),
    platformConfigs,
    backend: backendPool.backend ?? "",
    defaultPlatform: backendPool.default_platform ?? null,
    gpuResources: transformGpuResources(backendPool.resources),
    timeouts: transformTimeouts(backendPool),
    defaultExitActions: backendPool.default_exit_actions ?? {},
  };
}

/**
 * Transform backend PoolResponse to ideal PoolsResponse.
 *
 * WORKAROUND: Backend response is typed as `unknown` in OpenAPI.
 * Issue: backend_todo.md#1-incorrect-response-types-for-poolresource-apis
 *
 * Also extracts sharing groups: pools in the same node_set share physical
 * GPU capacity (totalCapacity, totalFree).
 *
 * @param rawResponse - The raw API response (typed as unknown by orval)
 */
export function transformPoolsResponse(rawResponse: unknown): PoolsResponse {
  // Cast to actual type (backend returns this, but OpenAPI types it wrong)
  const response = rawResponse as PoolResponse | undefined;

  if (!response?.node_sets) {
    return { pools: [], sharingGroups: [] };
  }

  const pools: Pool[] = [];
  const sharingGroups: string[][] = [];

  for (const nodeSet of response.node_sets) {
    const nodeSetPools = nodeSet.pools ?? [];
    const poolNames = nodeSetPools.map((p) => p.name ?? "").filter(Boolean);

    // Track sharing if multiple pools in node_set
    if (poolNames.length > 1) {
      sharingGroups.push(poolNames);
    }

    for (const backendPool of nodeSetPools) {
      pools.push(transformPool(backendPool));
    }
  }

  return { pools, sharingGroups };
}

/**
 * Get pools that share capacity with a given pool.
 *
 * @param poolName - The pool to check
 * @param sharingGroups - Sharing groups from PoolsResponse
 * @returns Array of pool names that share capacity, or null if not sharing
 */
export function getSharingInfo(poolName: string, sharingGroups: string[][]): string[] | null {
  const group = sharingGroups.find((g) => g.includes(poolName));
  if (!group || group.length <= 1) return null;
  return group.filter((name) => name !== poolName);
}

/**
 * Extract a single pool from the response.
 */
export function transformPoolDetail(rawResponse: unknown, poolName: string): Pool | null {
  const response = rawResponse as PoolResponse | undefined;

  if (!response?.node_sets) return null;

  for (const nodeSet of response.node_sets) {
    const found = nodeSet.pools?.find((p) => p.name === poolName);
    if (found) {
      return transformPool(found);
    }
  }

  return null;
}

// =============================================================================
// Resource Transforms
// =============================================================================

type UnitConversion = "none" | "kibToGiB" | "bytesToGiB";

/**
 * Extract resource capacity from backend ResourcesEntry.
 *
 * WORKAROUND: allocatable_fields and usage_fields are untyped dictionaries.
 * Issue: backend_todo.md#5-resource-fields-use-untyped-dictionaries
 *
 * WORKAROUND: Memory is in KiB, storage is in bytes.
 * Issue: backend_todo.md#6-memory-and-storage-values-need-conversion
 * We convert to GiB here so UI can display consistently.
 */
function extractCapacity(resource: ResourcesEntry, key: string, conversion: UnitConversion = "none"): ResourceCapacity {
  const allocatable = resource.allocatable_fields as Record<string, unknown> | undefined;
  const usage = resource.usage_fields as Record<string, unknown> | undefined;

  let total = getFieldValue(allocatable, key);
  let used = getFieldValue(usage, key);

  if (conversion === "kibToGiB") {
    total = kibToGiB(total);
    used = kibToGiB(used);
  } else if (conversion === "bytesToGiB") {
    total = bytesToGiB(total);
    used = bytesToGiB(used);
  }

  return { total, used };
}

/**
 * Parse pool memberships from pool_platform_labels.
 * Note: This only contains memberships for the queried pool(s).
 * For full memberships, use useResourceDetail hook which calls the single resource endpoint.
 * Format: { "pool-name": ["platform1", "platform2"], ... }
 */
function parsePoolMemberships(backendResource: ResourcesEntry): PoolMembership[] {
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
 * Transform backend ResourcesEntry to ideal Resource type.
 */
function transformResource(backendResource: ResourcesEntry, resourceName: string, platform: string): Resource {
  return {
    hostname: backendResource.hostname ?? "",
    name: resourceName,
    platform,
    resourceType: backendResource.resource_type ?? BackendResourceType.SHARED,
    backend: backendResource.backend ?? "",
    gpu: extractCapacity(backendResource, "gpu"),
    cpu: extractCapacity(backendResource, "cpu"),
    memory: extractCapacity(backendResource, "memory", "kibToGiB"), // Memory is in KiB
    storage: extractCapacity(backendResource, "storage", "bytesToGiB"), // Storage is in bytes
    conditions: backendResource.conditions ?? [],
    poolMemberships: parsePoolMemberships(backendResource),
  };
}

/**
 * Transform backend ResourcesResponse to ideal PoolResourcesResponse.
 *
 * WORKAROUND: Backend response is typed as `unknown` in OpenAPI.
 * Issue: backend_todo.md#1-incorrect-response-types-for-poolresource-apis
 */
export function transformResourcesResponse(rawResponse: unknown, poolName: string): PoolResourcesResponse {
  // Cast to actual type (backend returns this, but OpenAPI types it wrong)
  const response = rawResponse as ResourcesResponse | undefined;

  if (!response?.resources) {
    return { resources: [], platforms: [] };
  }

  const platformSet = new Set<string>();
  const resources: Resource[] = [];

  for (const backendResource of response.resources) {
    const exposedFields = backendResource.exposed_fields ?? {};
    const resourceName = String(exposedFields.node ?? backendResource.hostname ?? "");
    const poolPlatforms = (exposedFields["pool/platform"] ?? []) as string[];

    // Filter to only this pool's platforms
    const relevantPlatforms = poolPlatforms
      .filter((pp) => pp.startsWith(`${poolName}/`))
      .map((pp) => pp.split("/")[1] ?? "");

    for (const platform of relevantPlatforms) {
      platformSet.add(platform);
      resources.push(transformResource(backendResource, resourceName, platform));
    }
  }

  return {
    resources,
    platforms: Array.from(platformSet).sort(naturalCompare),
  };
}

// =============================================================================
// Version Transforms
// =============================================================================

/**
 * Transform backend version response to ideal Version type.
 *
 * WORKAROUND: Backend has no response type for version endpoint.
 * Issue: backend_todo.md#4-version-endpoint-returns-unknown-type
 */
export function transformVersionResponse(rawResponse: unknown): Version | null {
  if (!rawResponse || typeof rawResponse !== "object") return null;

  const response = rawResponse as Record<string, unknown>;

  return {
    major: String(response.major ?? "0"),
    minor: String(response.minor ?? "0"),
    revision: String(response.revision ?? "0"),
    hash: response.hash ? String(response.hash) : undefined,
  };
}

/**
 * Transform backend ResourcesResponse to cross-pool resources.
 *
 * Unlike pool-specific transform, this returns resources for ALL pools,
 * with one entry per resource (not per pool-platform combination).
 *
 * WORKAROUND: Backend response is typed as `unknown` in OpenAPI.
 * Issue: backend_todo.md#1-incorrect-response-types-for-poolresource-apis
 */
export function transformAllResourcesResponse(rawResponse: unknown): AllResourcesResponse {
  // Cast to actual type (backend returns this, but OpenAPI types it wrong)
  const response = rawResponse as ResourcesResponse | undefined;

  if (!response?.resources) {
    return { resources: [], pools: [], platforms: [] };
  }

  const poolSet = new Set<string>();
  const platformSet = new Set<string>();
  const resources: Resource[] = [];

  for (const backendResource of response.resources) {
    const exposedFields = backendResource.exposed_fields ?? {};
    const resourceName = String(exposedFields.node ?? backendResource.hostname ?? "");
    const poolPlatforms = (exposedFields["pool/platform"] ?? []) as string[];

    // Extract all pools and platforms from pool/platform list
    const memberships: PoolMembership[] = [];
    let primaryPlatform = "";

    for (const pp of poolPlatforms) {
      const [pool, platform] = pp.split("/");
      if (pool && platform) {
        poolSet.add(pool);
        platformSet.add(platform);
        memberships.push({ pool, platform });
        if (!primaryPlatform) primaryPlatform = platform;
      }
    }

    // Skip resources with no pool memberships
    if (memberships.length === 0) continue;

    // Create one resource entry (using first platform as primary)
    const resource = transformResource(backendResource, resourceName, primaryPlatform);
    resource.poolMemberships = memberships;
    resources.push(resource);
  }

  return {
    resources,
    pools: Array.from(poolSet).sort(naturalCompare),
    platforms: Array.from(platformSet).sort(naturalCompare),
  };
}
