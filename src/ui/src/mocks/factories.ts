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
 * Type-safe mock data factories for E2E and unit tests.
 *
 * Uses generated types from the OpenAPI spec so mock data stays in sync
 * with the backend API contract. Run `pnpm generate-api` after spec changes.
 */

import {
  BackendResourceType,
  DatasetType,
  PoolStatus,
  WorkflowStatus,
  type DataListEntry,
  type DataListResponse,
  type PoolResourceUsage,
  type ResourcesEntry,
  type PoolResponse,
  type ResourcesResponse,
  type ResourceUsage,
  type LoginInfo,
  type SrcServiceCoreWorkflowObjectsListEntry,
  type SrcServiceCoreWorkflowObjectsListResponse,
} from "@/lib/api/generated";
import type { Version } from "@/lib/api/adapter/types";

const GiB_IN_KiB = 1024 * 1024;
const TiB_IN_BYTES = 1024 * 1024 * 1024 * 1024;

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

// auth_enabled is added by our backend, not in the base OpenAPI spec
export function createLoginInfo(
  overrides: Partial<LoginInfo & { auth_enabled?: boolean }> = {},
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

export function createVersion(overrides: Partial<Version> = {}): Version {
  return {
    major: "2",
    minor: "5",
    revision: "1",
    hash: "a1b2c3d4",
    ...overrides,
  };
}

export function createPoolResourceUsage(overrides: Partial<PoolResourceUsage> = {}): PoolResourceUsage {
  const defaults: PoolResourceUsage = {
    name: "test-pool",
    description: "Test pool for E2E testing",
    status: PoolStatus.ONLINE,
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

export function createPoolResponse(pools: Partial<PoolResourceUsage>[] = []): PoolResponse {
  const defaultPools =
    pools.length > 0
      ? pools.map((p, i) => createPoolResourceUsage({ name: `pool-${i + 1}`, ...p }))
      : [
          createPoolResourceUsage({ name: "production", status: PoolStatus.ONLINE }),
          createPoolResourceUsage({ name: "development", status: PoolStatus.ONLINE }),
          createPoolResourceUsage({ name: "staging", status: PoolStatus.OFFLINE }),
        ];

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

export function createResourceEntry(overrides: Partial<ResourcesEntry> = {}): ResourcesEntry {
  const nodeName = overrides.hostname?.split(".")[0] || "test-node-001";

  const defaults: ResourcesEntry = {
    hostname: `${nodeName}.cluster.local`,
    resource_type: BackendResourceType.SHARED,
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

export function createResourcesResponse(resources: Partial<ResourcesEntry>[] = []): ResourcesResponse {
  const defaultResources =
    resources.length > 0
      ? resources.map((r, i) =>
          createResourceEntry({
            hostname: `node-${String(i + 1).padStart(3, "0")}.cluster.local`,
            ...r,
          }),
        )
      : [
          createResourceEntry({ hostname: "dgx-001.cluster.local", resource_type: BackendResourceType.SHARED }),
          createResourceEntry({ hostname: "dgx-002.cluster.local", resource_type: BackendResourceType.RESERVED }),
          createResourceEntry({ hostname: "dgx-003.cluster.local", resource_type: BackendResourceType.SHARED }),
        ];

  return { resources: defaultResources };
}

// =============================================================================
// Workflow factories
// =============================================================================

export function createWorkflowEntry(
  overrides: Partial<SrcServiceCoreWorkflowObjectsListEntry> = {},
): SrcServiceCoreWorkflowObjectsListEntry {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  return {
    user: "test-user",
    name: `workflow-${Math.random().toString(36).slice(2, 8)}`,
    workflow_uuid: crypto.randomUUID(),
    submit_time: oneHourAgo.toISOString(),
    start_time: oneHourAgo.toISOString(),
    end_time: null,
    queued_time: 5,
    duration: 3600,
    status: WorkflowStatus.RUNNING,
    overview: "/api/workflow/test/overview",
    logs: "/api/workflow/test/logs",
    error_logs: null,
    grafana_url: null,
    dashboard_url: null,
    pool: "test-pool",
    app_owner: null,
    app_name: null,
    app_version: null,
    priority: "NORMAL",
    ...overrides,
  };
}

export function createWorkflowsResponse(
  workflows: Partial<SrcServiceCoreWorkflowObjectsListEntry>[] = [],
  moreEntries = false,
): SrcServiceCoreWorkflowObjectsListResponse {
  const defaultWorkflows =
    workflows.length > 0 ? workflows.map((w, i) => createWorkflowEntry({ name: `workflow-${i + 1}`, ...w })) : [];

  return {
    workflows: defaultWorkflows,
    more_entries: moreEntries,
  };
}

// =============================================================================
// Dataset factories
// =============================================================================

export function createDatasetEntry(overrides: Partial<DataListEntry> = {}): DataListEntry {
  const now = new Date();
  return {
    name: overrides.name ?? `dataset-${Math.random().toString(36).slice(2, 8)}`,
    id: overrides.id ?? crypto.randomUUID(),
    bucket: overrides.bucket ?? "default-bucket",
    create_time: overrides.create_time ?? now.toISOString(),
    last_created: overrides.last_created ?? now.toISOString(),
    hash_location: overrides.hash_location ?? null,
    hash_location_size: overrides.hash_location_size ?? null,
    version_id: overrides.version_id ?? null,
    type: overrides.type ?? DatasetType.DATASET,
    ...overrides,
  };
}

export function createDatasetsResponse(datasets: Partial<DataListEntry>[] = []): DataListResponse {
  const defaultDatasets =
    datasets.length > 0 ? datasets.map((d, i) => createDatasetEntry({ name: `dataset-${i + 1}`, ...d })) : [];

  return { datasets: defaultDatasets };
}

// Re-export generated enums so E2E tests can import from one place
export { BackendResourceType, DatasetType, PoolStatus, WorkflowStatus } from "@/lib/api/generated";
