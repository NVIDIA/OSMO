// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Transformed types - the shape of data after backend quirks are fixed.
 *
 * These interfaces define what transforms.ts produces.
 * For enums that backend returns correctly, import from generated.ts directly.
 *
 * Some types (like workflow types) are re-exported unchanged from generated.ts
 * because the UI should import all types from adapter, not generated.ts.
 */

import type { PoolStatus, BackendResourceType } from "@/lib/api/generated";

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
} from "@/lib/api/generated";

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
  free: number;
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

// =============================================================================
// Profile Types
// =============================================================================

/**
 * User profile information.
 */
export interface UserProfile {
  // Note: User's name and email come from JWT token via useUser() hook, not from profile settings
  notifications: {
    email: boolean;
    slack: boolean;
  };
  bucket: {
    default: string;
    accessible: string[]; // List of bucket names user has access to
  };
  pool: {
    default: string;
    accessible: string[]; // List of pool names user has access to
  };
}

/**
 * Profile update request payload.
 */
export interface ProfileUpdate {
  notifications?: {
    email?: boolean;
    slack?: boolean;
  };
  bucket?: {
    default?: string;
  };
  pool?: {
    default?: string;
  };
}

// =============================================================================
// Bucket Types
// =============================================================================

/**
 * Bucket information with dataset path and metadata.
 */
export interface Bucket {
  name: string; // Bucket identifier
  path: string; // Full dataset path (e.g., "s3://my-bucket/datasets")
  description: string; // Bucket description
  mode: string; // Access mode
  defaultCredential: boolean; // Whether it uses default credentials
}

// =============================================================================
// Credential Types
// =============================================================================

/**
 * A credential entry (matches production format).
 * Supports multiple credential types: registry, data, and generic.
 */
export interface Credential {
  cred_name: string;
  cred_type: "REGISTRY" | "DATA" | "GENERIC";
  profile: string | null; // URL/endpoint for registry/data, null for generic
}

/**
 * Payload for creating a new credential.
 * Maps to backend's CredentialOptions structure.
 * The cred_name is used as the URL path parameter, the rest goes in the body.
 */
export interface CredentialCreate {
  cred_name: string;
  registry_credential?: {
    registry?: string;
    username?: string;
    auth: string;
  };
  data_credential?: {
    endpoint: string;
    region?: string;
    access_key_id: string;
    access_key: string;
  };
  generic_credential?: {
    credential: Record<string, string>;
  };
}
