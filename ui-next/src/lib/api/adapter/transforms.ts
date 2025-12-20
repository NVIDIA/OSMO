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

import type {
  PoolResponse,
  PoolResourceUsage,
  ResourcesResponse,
  ResourcesEntry,
} from "../generated";

import type {
  Pool,
  PoolsResponse,
  PoolStatus,
  Quota,
  Node,
  PoolResourcesResponse,
  ResourceType,
  ResourceCapacity,
  Version,
} from "./types";

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

function getFieldValue(
  fields: Record<string, unknown> | undefined,
  key: string
): number {
  if (!fields) return 0;
  const value = fields[key];
  if (typeof value === "number") return Math.floor(value);
  if (typeof value === "string") return Math.floor(parseFloat(value)) || 0;
  return 0;
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
 * Transform backend PoolResourceUsage to ideal Pool type.
 */
function transformPool(backendPool: PoolResourceUsage): Pool {
  return {
    name: backendPool.name ?? "",
    description: backendPool.description ?? "",
    status: (backendPool.status ?? "ONLINE") as PoolStatus,
    quota: transformQuota(backendPool.resource_usage),
    platforms: Object.keys(backendPool.platforms ?? {}),
    backend: backendPool.backend ?? "",
  };
}

/**
 * Transform backend PoolResponse to ideal PoolsResponse.
 * 
 * WORKAROUND: Backend response is typed as `unknown` in OpenAPI.
 * Issue: backend_todo.md#1-incorrect-response-types-for-poolresource-apis
 * 
 * @param rawResponse - The raw API response (typed as unknown by orval)
 */
export function transformPoolsResponse(rawResponse: unknown): PoolsResponse {
  // Cast to actual type (backend returns this, but OpenAPI types it wrong)
  const response = rawResponse as PoolResponse | undefined;
  
  if (!response?.node_sets) {
    return { pools: [] };
  }

  const pools = response.node_sets.flatMap((nodeSet) =>
    (nodeSet.pools ?? []).map(transformPool)
  );

  return { pools };
}

/**
 * Extract a single pool from the response.
 */
export function transformPoolDetail(
  rawResponse: unknown,
  poolName: string
): Pool | null {
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
// Resource/Node Transforms
// =============================================================================

/**
 * Extract resource capacity from backend ResourcesEntry.
 * 
 * WORKAROUND: allocatable_fields and usage_fields are untyped dictionaries.
 * Issue: backend_todo.md#5-resource-fields-use-untyped-dictionaries
 */
function extractCapacity(
  resource: ResourcesEntry,
  key: string
): ResourceCapacity {
  const allocatable = resource.allocatable_fields as Record<string, unknown> | undefined;
  const usage = resource.usage_fields as Record<string, unknown> | undefined;
  
  return {
    total: getFieldValue(allocatable, key),
    used: getFieldValue(usage, key),
  };
}

/**
 * Transform backend ResourcesEntry to ideal Node type.
 */
function transformNode(
  resource: ResourcesEntry,
  nodeName: string,
  platform: string
): Node {
  return {
    hostname: resource.hostname ?? "",
    nodeName,
    platform,
    resourceType: (resource.resource_type ?? "SHARED") as ResourceType,
    backend: resource.backend ?? "",
    gpu: extractCapacity(resource, "gpu"),
    cpu: extractCapacity(resource, "cpu"),
    memory: extractCapacity(resource, "memory"),
    storage: extractCapacity(resource, "storage"),
    conditions: resource.conditions ?? [],
  };
}

/**
 * Transform backend ResourcesResponse to ideal PoolResourcesResponse.
 * 
 * WORKAROUND: Backend response is typed as `unknown` in OpenAPI.
 * Issue: backend_todo.md#1-incorrect-response-types-for-poolresource-apis
 */
export function transformResourcesResponse(
  rawResponse: unknown,
  poolName: string
): PoolResourcesResponse {
  // Cast to actual type (backend returns this, but OpenAPI types it wrong)
  const response = rawResponse as ResourcesResponse | undefined;
  
  if (!response?.resources) {
    return { nodes: [], platforms: [] };
  }

  const platformSet = new Set<string>();
  const nodes: Node[] = [];

  for (const resource of response.resources) {
    const exposedFields = resource.exposed_fields ?? {};
    const nodeName = String(exposedFields.node ?? resource.hostname ?? "");
    const poolPlatforms = (exposedFields["pool/platform"] ?? []) as string[];

    // Filter to only this pool's platforms
    const relevantPlatforms = poolPlatforms
      .filter((pp) => pp.startsWith(`${poolName}/`))
      .map((pp) => pp.split("/")[1] ?? "");

    for (const platform of relevantPlatforms) {
      platformSet.add(platform);
      nodes.push(transformNode(resource, nodeName, platform));
    }
  }

  return {
    nodes,
    platforms: Array.from(platformSet).sort(),
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
